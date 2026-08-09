using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Email;

/// <summary>
/// What a workspace's emails look like. The one place the email pipeline reads
/// branding from.
///
/// **Why the indirection.** `WorkspaceBranding` is only half-built: the entity,
/// the admin API and the public read endpoint all work, but the Angular editor
/// at `/admin/settings/branding` is still `ComingSoon`, so how branding is
/// ultimately modelled may still move. Templates only ever *read* branding, and
/// the read shape is the settled half — but pointing thirteen templates and a
/// layout directly at the entity would make any later restructuring a rewrite of
/// all of them, including bodies admins had customised by then. Everything goes
/// through this record instead, so that change stays inside this file.
/// </summary>
public record EmailBrand(
    string BrandName,
    string WorkspaceName,
    string? LogoUrl,
    string PrimaryColor,
    string? FooterText,
    bool HidePoweredBy,
    string? SupportEmail,
    string PortalUrl);

public class EmailBrandResolver(TracklyDbContext db, IConfiguration configuration)
{
    // Matches BrandingController.GetPublic — the fallbacks have to agree, or the
    // sign-in page and the sign-in email disagree about the same workspace.
    private const string DefaultPrimaryColor = "#2563EB";

    public async Task<EmailBrand> ResolveAsync(Guid workspaceId, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);
        var branding = await db.WorkspaceBrandings
            .SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);
        var fromEmail = await db.EmailConfigs
            .Where(c => c.WorkspaceId == workspaceId)
            .Select(c => c.FromEmail)
            .SingleOrDefaultAsync(ct);

        var frontend = (configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:4200").TrimEnd('/');

        return new EmailBrand(
            // Every field falls back to something real rather than to a blank.
            // Until the branding editor is ported nobody *can* set these from
            // Angular, so an empty branding row is the common case on any
            // current install — the emails still have to look deliberate.
            BrandName: branding?.PageTitle is { Length: > 0 } title ? title : workspace.Name,
            WorkspaceName: workspace.Name,
            LogoUrl: LogoUrl(workspace.Slug, branding?.LogoStorageKey),
            PrimaryColor: branding?.PrimaryColor is { Length: > 0 } color ? color : DefaultPrimaryColor,
            FooterText: branding?.FooterText,
            HidePoweredBy: branding?.HidePoweredBy ?? false,
            SupportEmail: fromEmail,
            PortalUrl: $"{frontend}/portal");
    }

    /// <summary>
    /// An absolute URL to the public logo endpoint, or null.
    ///
    /// Absolute because a mail client has no page to resolve a relative path
    /// against. Not a `cid:` attachment: embedding would put a paperclip on
    /// every notification, and a blocked image degrades to alt text either way.
    ///
    /// Null unless **both** are true: a logo has actually been uploaded, and
    /// `App:ApiBaseUrl` is set so there is an absolute URL to point at. Either
    /// missing and `{{logo_url}}` is empty, which is what the layout's
    /// `{{#if logo_url}}` reads to fall back to the workspace name in text.
    ///
    /// The storage key has to be checked here, not left to the endpoint: it
    /// answers 404 for a workspace with no logo, so publishing the URL anyway
    /// would put a broken image at the top of every notification — worse than no
    /// logo, and on a fresh install, which has no branding row at all, it would
    /// be every email Trackly sends. `GetPublic` makes the same check before
    /// handing a `logoUrl` to the sign-in page.
    /// </summary>
    private string? LogoUrl(string slug, string? logoStorageKey)
    {
        if (logoStorageKey is null) return null;

        var apiBase = configuration.GetNonEmpty("App:ApiBaseUrl")?.TrimEnd('/');
        return apiBase is null ? null : $"{apiBase}/api/public/workspaces/{Uri.EscapeDataString(slug)}/logo";
    }

    /// <summary>The branding half of a template's variables.</summary>
    public static Dictionary<string, string?> ToVariables(EmailBrand brand) => new()
    {
        ["brand_name"] = brand.BrandName,
        ["workspace_name"] = brand.WorkspaceName,
        ["logo_url"] = brand.LogoUrl,
        ["primary_color"] = brand.PrimaryColor,
        ["footer_text"] = brand.FooterText,
        // Rendered through {{#if}}, which treats "False" as false — so the flag
        // has to stringify, not be omitted.
        ["hide_powered_by"] = brand.HidePoweredBy ? "true" : "false",
        ["support_email"] = brand.SupportEmail,
        ["portal_url"] = brand.PortalUrl,
        ["year"] = DateTime.UtcNow.Year.ToString(),
    };
}
