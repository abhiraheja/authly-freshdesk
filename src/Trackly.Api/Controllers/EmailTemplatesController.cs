using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Email;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Text;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

/// <summary>
/// The subject and body of every email Trackly sends.
///
/// **A missing row is the built-in.** Nothing is seeded: `GET` merges the
/// catalogue with whatever rows exist, `PUT` creates or updates one, and
/// `DELETE` is Reset. So `source` is a null check and a fresh install has
/// nothing to migrate.
///
/// Bodies are admin-authored HTML and are sanitised on write by
/// <see cref="EmailHtml"/> — a wider allowlist than <see cref="RichText"/>,
/// which forbids the tables and inline styles an email layout is made of.
/// </summary>
[ApiController]
[Route("api/admin/email/templates")]
[Authorize(Policy = "Admin")]
public class EmailTemplatesController(
    TracklyDbContext db,
    EmailTemplateService templates) : ControllerBase
{
    public record SaveTemplateRequest(string? Subject, string? BodyHtml, bool? Standalone, bool? IsActive);

    public record PreviewRequest(string? Subject, string? BodyHtml, bool? Standalone);

    public record TestRequest(string? To, string? Subject, string? BodyHtml, bool? Standalone);

    // ---- Read ----------------------------------------------------------------

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var rows = await Rows(ct).ToListAsync(ct);

        return Ok(EmailTemplateCatalog.All.Select(descriptor =>
        {
            var row = rows.SingleOrDefault(r => r.Key == descriptor.Key);
            return new
            {
                key = descriptor.Key,
                name = descriptor.Name,
                description = descriptor.Description,
                isLayout = descriptor.IsLayout,
                locale = EmailTemplateCatalog.DefaultLocale,
                // The mockup's built-in/custom badge, which is exactly "does a
                // row exist" — see the class comment.
                source = row is null ? "built-in" : "custom",
                subject = row?.Subject ?? descriptor.Subject,
                isActive = row?.IsActive ?? true,
                standalone = row?.Standalone ?? false,
                updatedAt = row?.UpdatedAt,
            };
        }));
    }

    [HttpGet("{key}")]
    public async Task<IActionResult> Get(string key, CancellationToken ct)
    {
        if (EmailTemplateCatalog.Find(key) is not { } descriptor)
            return NotFound(new { error = "No such email template." });

        var row = await Rows(ct).SingleOrDefaultAsync(r => r.Key == key, ct);

        return Ok(new
        {
            key = descriptor.Key,
            name = descriptor.Name,
            description = descriptor.Description,
            isLayout = descriptor.IsLayout,
            locale = EmailTemplateCatalog.DefaultLocale,
            source = row is null ? "built-in" : "custom",

            subject = row?.Subject ?? descriptor.Subject,
            bodyHtml = row is null || !HasBody(row) ? descriptor.BodyHtml : row.BodyHtml,
            standalone = row?.Standalone ?? false,
            isActive = row?.IsActive ?? true,
            updatedAt = row?.UpdatedAt,

            // The editor shows what a template may use, and refuses to save
            // without what it must. Sent together so the panel and the error
            // message cannot disagree about which is which.
            variables = descriptor.Variables,
            globalVariables = EmailTemplateCatalog.GlobalVariables,
            required = descriptor.Required,

            // So Reset can be offered without a round trip, and so an admin can
            // see what they are resetting to before they commit.
            builtInSubject = descriptor.Subject,
            builtInBodyHtml = descriptor.BodyHtml,
        });
    }

    // ---- Write ---------------------------------------------------------------

    [HttpPut("{key}")]
    public async Task<IActionResult> Save(string key, [FromBody] SaveTemplateRequest request, CancellationToken ct)
    {
        if (EmailTemplateCatalog.Find(key) is not { } descriptor)
            return NotFound(new { error = "No such email template." });

        var body = request.BodyHtml ?? string.Empty;
        if (Validate(descriptor, request.Subject, body) is { } error)
            return BadRequest(new { error });

        string clean;
        try
        {
            clean = EmailHtml.Sanitize(body);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }

        // Sanitising can remove a placeholder along with the tag it was sitting
        // in, so the contract is re-checked against what will actually be
        // stored. Validating only the submitted body would let a required
        // variable disappear between the check and the write.
        if (Validate(descriptor, request.Subject, clean) is { } afterClean)
            return BadRequest(new { error = afterClean });

        var workspaceId = User.GetWorkspaceId();
        var row = await db.EmailTemplates.SingleOrDefaultAsync(
            t => t.WorkspaceId == workspaceId && t.Key == key
                 && t.Locale == EmailTemplateCatalog.DefaultLocale, ct);

        if (row is null)
        {
            row = new EmailTemplate
            {
                WorkspaceId = workspaceId,
                Key = key,
                Locale = EmailTemplateCatalog.DefaultLocale,
            };
            db.EmailTemplates.Add(row);
        }

        // The layout has no subject of its own; storing one would be a field the
        // renderer never reads.
        row.Subject = descriptor.IsLayout ? null : request.Subject?.Trim();
        row.BodyHtml = clean;
        row.Standalone = !descriptor.IsLayout && (request.Standalone ?? row.Standalone);
        row.IsActive = request.IsActive ?? row.IsActive;
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedById = User.GetUserId();

        await db.SaveChangesAsync(ct);
        return Ok(new { key, source = "custom", updatedAt = row.UpdatedAt });
    }

    /// <summary>Reset to built-in — deleting the customisation, not blanking it.</summary>
    [HttpDelete("{key}")]
    public async Task<IActionResult> Reset(string key, CancellationToken ct)
    {
        if (EmailTemplateCatalog.Find(key) is null)
            return NotFound(new { error = "No such email template." });

        var row = await Rows(ct).SingleOrDefaultAsync(r => r.Key == key, ct);
        if (row is not null)
        {
            db.EmailTemplates.Remove(row);
            await db.SaveChangesAsync(ct);
        }

        return Ok(new { key, source = "built-in" });
    }

    // ---- Preview + test ------------------------------------------------------

    /// <summary>
    /// Renders unsaved content with sample data. Nothing is written and nothing
    /// is sent.
    ///
    /// Server-side because the renderer is server-side: a JavaScript
    /// reimplementation in the SPA would be a second engine that drifts from the
    /// first, and the preview would stop matching reality without saying so.
    /// </summary>
    [HttpPost("{key}/preview")]
    public async Task<IActionResult> Preview(string key, [FromBody] PreviewRequest request, CancellationToken ct)
    {
        if (EmailTemplateCatalog.Find(key) is null)
            return NotFound(new { error = "No such email template." });

        // Reported before rendering, because the renderer's answer to a template
        // it cannot parse is to fall back to the built-in — right for a sign-in
        // email at 3am, wrong here. An admin who has just broken a conditional
        // would be shown a perfectly good preview of copy they did not write.
        //
        // Parse errors only. Whether a required variable is still present is a
        // save-time contract, and refusing to preview until it is satisfied
        // would withhold the preview exactly while it is being fixed.
        if (Unparseable(request.BodyHtml, request.Subject) is { } broken)
            return Ok(new { error = broken });

        try
        {
            var rendered = await Render(key, request.Subject, request.BodyHtml, request.Standalone, ct);
            return Ok(new { subject = rendered.Subject, html = rendered.Html, text = rendered.Text });
        }
        catch (Exception ex)
        {
            // A preview of a broken template is a legitimate thing to ask for —
            // it is how an admin finds the broken part. Reported, not thrown.
            return Ok(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Sends this one template to an address, with sample data.
    ///
    /// Deliberately does **not** set `email_configs.last_verified_at`. That flag
    /// is the proof invariant 8 requires before password sign-in can be turned
    /// off, and it stays on the one endpoint whose whole purpose is to establish
    /// it. Being able to mail yourself a draft is not the same claim.
    /// </summary>
    [HttpPost("{key}/test")]
    public async Task<IActionResult> Test(
        string key,
        [FromBody] TestRequest request,
        [FromServices] IWorkspaceEmailSender sender,
        [FromServices] EmailProviderService providers,
        CancellationToken ct)
    {
        if (EmailTemplateCatalog.Find(key) is null)
            return NotFound(new { error = "No such email template." });

        var to = string.IsNullOrWhiteSpace(request.To)
            ? User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value
            : request.To.Trim();
        if (string.IsNullOrWhiteSpace(to))
            return BadRequest(new { ok = false, error = "Enter an address to send the test to." });

        var config = await db.EmailConfigs
            .SingleOrDefaultAsync(c => c.WorkspaceId == User.GetWorkspaceId(), ct);

        try
        {
            var rendered = await Render(key, request.Subject, request.BodyHtml, request.Standalone, ct);

            // Resolving is inside the try because it renews an OAuth token, and a
            // connection that cannot be renewed throws — that is a failed test,
            // not a failed request.
            var smtp = await providers.ResolveSenderAsync(User.GetWorkspaceId(), ct);

            await sender.SendAsync(smtp, new EmailMessage(
                to,
                rendered.Subject is { Length: > 0 } subject ? subject : "Trackly template test",
                rendered.Text,
                HtmlBody: rendered.Html,
                FromEmail: config?.FromEmail,
                FromName: config?.FromName), ct);
        }
        catch (Exception ex)
        {
            return Ok(new { ok = false, error = ex.Message });
        }

        return Ok(new { ok = true, sentTo = to });
    }

    // ---- Helpers -------------------------------------------------------------

    private IQueryable<EmailTemplate> Rows(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        return db.EmailTemplates.Where(t => t.WorkspaceId == workspaceId
                                            && t.Locale == EmailTemplateCatalog.DefaultLocale);
    }

    /// <summary>
    /// Renders with sample data — the posted draft when there is one, and what is
    /// actually stored when there is not.
    ///
    /// The distinction matters for the list screen, which tests a template it has
    /// never opened and so has no body to post. A draft substitutes for the
    /// stored row, so posting nothing would substitute an *empty* row and quietly
    /// send the built-in — an admin testing their own customisation would be
    /// shown someone else's copy and told it passed.
    /// </summary>
    private async Task<RenderedEmail> Render(
        string key, string? subject, string? bodyHtml, bool? standalone, CancellationToken ct)
        => subject is null && bodyHtml is null
            ? await templates.RenderAsync(User.GetWorkspaceId(), key, EmailTemplateSamples.For(key), ct)
            : await templates.RenderDraftAsync(
                User.GetWorkspaceId(), key, subject, bodyHtml, standalone ?? false,
                EmailTemplateSamples.For(key), ct);

    private static bool HasBody(EmailTemplate row) => !string.IsNullOrWhiteSpace(row.BodyHtml);

    /// <summary>The first thing that stops this rendering at all, or null.</summary>
    private static string? Unparseable(string? body, string? subject)
        => (body is not null ? TemplateRenderer.Validate(body) : null)
           ?? (subject is not null ? TemplateRenderer.Validate(subject) : null);

    /// <summary>
    /// Refuses a template that cannot render, or that has lost something it
    /// cannot work without.
    ///
    /// The required-variable rule is an invariant 8 measure, not tidiness: this
    /// is self-hosted, so an admin who deletes `{{action_url}}` while rewording
    /// the sign-in email has locked every user out of a product with no support
    /// desk and no recovery link. Enforced here rather than in the editor,
    /// because the editor is not the only thing that can call this.
    /// </summary>
    private static string? Validate(EmailTemplateDescriptor descriptor, string? subject, string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return "The body cannot be empty. Use Reset to go back to the built-in version.";

        if (TemplateRenderer.Validate(body) is { } bodyError)
            return bodyError;
        if (subject is not null && TemplateRenderer.Validate(subject) is { } subjectError)
            return subjectError;

        if (!descriptor.IsLayout && string.IsNullOrWhiteSpace(subject))
            return "The subject cannot be empty.";

        var used = TemplateRenderer.ReferencedVariables(body + " " + (subject ?? string.Empty));
        var missing = descriptor.Required.Where(name => !used.Contains(name)).ToArray();

        return missing.Length == 0
            ? null
            : $"This template still needs {string.Join(" and ", missing.Select(m => $"{{{{{m}}}}}"))} — "
              + "without it the email cannot do its job.";
    }
}
