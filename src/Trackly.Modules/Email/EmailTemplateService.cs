using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Email;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Text;

namespace Trackly.Modules.Email;

/// <summary>A template turned into the three things a message needs.</summary>
public record RenderedEmail(string Subject, string Html, string Text);

/// <summary>
/// Resolves a template key to its stored customisation or its built-in, renders
/// it into the shared layout, and derives the plain-text alternative.
///
/// The single render path: the admin preview, the per-template test send and
/// real production mail all come through here. A preview that rendered by some
/// other route would be a second implementation, and it would start lying
/// exactly when it mattered.
/// </summary>
public class EmailTemplateService(
    TracklyDbContext db,
    EmailBrandResolver brands,
    ILogger<EmailTemplateService> logger)
{
    public async Task<RenderedEmail> RenderAsync(
        Guid workspaceId, string key, IReadOnlyDictionary<string, string?> values, CancellationToken ct)
        => await RenderCoreAsync(workspaceId, key, values, draft: null, ct);

    /// <summary>
    /// Renders content that has not been saved — the editor's live preview, and
    /// the test send made from a template being edited.
    ///
    /// Deliberately the same method as production with one substitution, rather
    /// than a preview renderer of its own. Two paths would be two behaviours, and
    /// the preview would start lying at exactly the moment it mattered: when
    /// somebody was about to save.
    /// </summary>
    public async Task<RenderedEmail> RenderDraftAsync(
        Guid workspaceId, string key, string? subject, string? bodyHtml, bool standalone,
        IReadOnlyDictionary<string, string?> values, CancellationToken ct)
        => await RenderCoreAsync(workspaceId, key, values,
            new EmailTemplate
            {
                Key = key,
                Subject = subject,
                BodyHtml = bodyHtml ?? string.Empty,
                Standalone = standalone,
                IsActive = true,
            }, ct);

    private async Task<RenderedEmail> RenderCoreAsync(
        Guid workspaceId, string key, IReadOnlyDictionary<string, string?> values,
        EmailTemplate? draft, CancellationToken ct)
    {
        var descriptor = EmailTemplateCatalog.Find(key)
                         ?? throw new ArgumentException($"Unknown email template '{key}'.", nameof(key));

        var rows = await db.EmailTemplates
            .Where(t => t.WorkspaceId == workspaceId
                        && t.Locale == EmailTemplateCatalog.DefaultLocale
                        && (t.Key == key || t.Key == EmailTemplateCatalog.LayoutKey))
            .AsNoTracking()
            .ToListAsync(ct);

        // A draft replaces the stored row for the key being edited — including
        // when that key is the layout, so previewing a layout edit shows the
        // layout being edited rather than the one on disk.
        // A draft replaces the stored row for whichever key is being edited.
        var row = draft ?? rows.SingleOrDefault(t => t.Key == key);
        var layoutRow = rows.SingleOrDefault(t => t.Key == EmailTemplateCatalog.LayoutKey);

        var brand = await brands.ResolveAsync(workspaceId, ct);
        var variables = EmailBrandResolver.ToVariables(brand);
        foreach (var (name, value) in values)
            variables[name] = value;

        // The layout is a frame, not a message: it has no subject, and rendering
        // it as a fragment and then wrapping it would nest it inside itself. It
        // is previewed by putting sample content *through* it, which is the only
        // way to see what an edit to it actually does.
        if (descriptor.IsLayout)
        {
            var sample = Render(
                () => TemplateRenderer.RenderHtml(
                    EmailTemplateCatalog.Find("email_test")!.BodyHtml, variables),
                () => string.Empty, key, "sample content");
            var framed = RenderLayout(sample, variables, row);
            return new RenderedEmail(string.Empty, framed, EmailText.FromHtml(framed));
        }

        var subject = Render(
            () => TemplateRenderer.RenderText(Active(row?.Subject, row, descriptor.Subject), variables),
            () => TemplateRenderer.RenderText(descriptor.Subject, variables),
            key, "subject");

        var content = Render(
            () => TemplateRenderer.RenderHtml(Active(row?.BodyHtml, row, descriptor.BodyHtml), variables),
            () => TemplateRenderer.RenderHtml(descriptor.BodyHtml, variables),
            key, "body");

        var html = row?.Standalone == true && row.IsActive
            ? content
            : RenderLayout(content, variables, layoutRow);

        return new RenderedEmail(subject, html, EmailText.FromHtml(html));
    }

    private string RenderLayout(string content, Dictionary<string, string?> variables, EmailTemplate? layoutRow)
    {
        var builtIn = EmailTemplateCatalog.Find(EmailTemplateCatalog.LayoutKey)!.BodyHtml;
        // The layout's own copy of the variables, so `content` cannot leak into
        // a fragment rendered later in the same request.
        var scoped = new Dictionary<string, string?>(variables) { ["content"] = content };

        return Render(
            () => TemplateRenderer.RenderHtml(Active(layoutRow?.BodyHtml, layoutRow, builtIn), scoped),
            () => TemplateRenderer.RenderHtml(builtIn, scoped),
            EmailTemplateCatalog.LayoutKey, "layout");
    }

    /// <summary>
    /// The stored text when there is one and it is switched on, the built-in
    /// otherwise.
    ///
    /// `IsActive = false` falls back rather than suppressing: a toggle that
    /// silently stopped sending sign-in codes would be an invariant 8 lockout
    /// wearing a friendly label.
    /// </summary>
    private static string Active(string? stored, EmailTemplate? row, string builtIn) =>
        row is { IsActive: true } && !string.IsNullOrWhiteSpace(stored) ? stored : builtIn;

    /// <summary>
    /// Runs a render, and falls back to the built-in if it throws.
    ///
    /// Saving validates, so a stored template should always parse — but "should"
    /// is doing a lot of work there. A row edited directly in the database, or
    /// written by an older validator, must not be able to stop a sign-in email
    /// from going out. Degrading to the built-in keeps the mail flowing and puts
    /// the reason in the log; throwing would take the product down by way of a
    /// typo.
    /// </summary>
    private string Render(Func<string> attempt, Func<string> fallback, string key, string part)
    {
        try
        {
            return attempt();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Email template {Key} has an unusable {Part}; falling back to the built-in", key, part);
            return fallback();
        }
    }
}
