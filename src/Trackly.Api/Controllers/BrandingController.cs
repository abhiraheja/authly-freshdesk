using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules;

namespace Trackly.Api.Controllers;

/// <summary>
/// The workspace's visual identity — worn by the sign-in and verify screens, the
/// portal, the knowledge base, the guest views and the header of every email.
///
/// <para>
/// <b>Every public read resolves the workspace, slug or no slug.</b> These
/// endpoints are paired: <c>/api/public/branding</c> and
/// <c>/api/public/workspaces/{slug}/branding</c> return the same body. The slug
/// forms survive because they are already in links out in the wild; the slug-less
/// forms exist because the sign-in page has no slug to offer and was therefore
/// rendering unbranded while the verify page it hands off to — reached from an
/// email that <i>does</i> carry <c>?workspace=</c> — rendered branded. Two themes,
/// one sign-in. Both now go through <see cref="WorkspaceLookup.ResolveWorkspaceAsync"/>,
/// which falls back to the installation's own workspace (invariant 1).
/// </para>
/// </summary>
[ApiController]
public partial class BrandingController(TracklyDbContext db, IWorkspaceFileStorage storage) : ControllerBase
{
    private const long MaxLogoBytes = 1024 * 1024; // 1 MB per the mockups

    /// <summary>
    /// The sign-in panel image is full-bleed artwork, not a mark in a header, so
    /// the logo's 1 MB would force admins to degrade a photograph before it ever
    /// reached a 1440px column. It is fetched by one browser on one page — never
    /// by a mail client, never once per email — so the bytes cost far less here.
    /// </summary>
    private const long MaxSignInImageBytes = 5 * 1024 * 1024;

    private static readonly string[] AllowedLogoTypes =
        ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];

    /// <summary>
    /// No SVG. The logo is rendered into an <c>&lt;img&gt;</c> at 32px in trusted
    /// chrome; the panel image is a full-viewport background, and an SVG is a
    /// document that can carry script. Raster only costs an admin nothing — a
    /// hero image is a photograph in practice.
    /// </summary>
    private static readonly string[] AllowedSignInImageTypes =
        ["image/png", "image/jpeg", "image/webp", "image/gif"];

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColorRegex();

    public record SaveBrandingRequest(
        string? PrimaryColor,
        string? PageTitle,
        string? WelcomeText,
        string? FooterText,
        bool? HidePoweredBy);

    // ---- Public reads --------------------------------------------------------
    // Cacheable — these drive the sign-in page, the branded submit form, the
    // portal and the widget.

    [HttpGet("api/public/branding")]
    public Task<IActionResult> GetPublicDefault(CancellationToken ct) => GetPublic(null, ct);

    [HttpGet("api/public/workspaces/{slug}/branding")]
    public async Task<IActionResult> GetPublic(string? slug, CancellationToken ct)
    {
        var workspace = await db.ResolveWorkspaceAsync(slug, ct);
        if (workspace is null)
            return NotFound();

        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspace.Id, ct);
        var categories = await db.Categories
            .Where(c => c.WorkspaceId == workspace.Id)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(ct);

        // Asset URLs are built from the resolved slug rather than echoing what the
        // caller passed, so a slug-less request still gets addresses that work.
        var assetBase = $"/api/public/workspaces/{Uri.EscapeDataString(workspace.Slug)}";

        Response.Headers.CacheControl = "public, max-age=60";
        return Ok(new
        {
            workspaceName = workspace.Name,
            slug = workspace.Slug,
            logoUrl = branding?.LogoStorageKey is null ? null : $"{assetBase}/logo",
            signInImageUrl = branding?.SignInImageStorageKey is null ? null : $"{assetBase}/sign-in-image",
            primaryColor = branding?.PrimaryColor ?? "#2563EB",
            pageTitle = branding?.PageTitle ?? $"{workspace.Name} Support",
            welcomeText = branding?.WelcomeText ?? "How can we help you?",
            footerText = branding?.FooterText,
            hidePoweredBy = branding?.HidePoweredBy ?? false,
            emailLoginEnabled = workspace.EmailLoginEnabled,
            ssoProviderName = (string?)null, // populated in Phase 5
            categories,
        });
    }

    [HttpGet("api/public/logo")]
    public Task<IActionResult> GetDefaultLogo(CancellationToken ct) => GetLogo(null, ct);

    [HttpGet("api/public/workspaces/{slug}/logo")]
    public Task<IActionResult> GetLogo(string? slug, CancellationToken ct)
        => ServeAssetAsync(slug, b => (b.LogoStorageKey, b.LogoContentType), ct);

    [HttpGet("api/public/sign-in-image")]
    public Task<IActionResult> GetDefaultSignInImage(CancellationToken ct) => GetSignInImage(null, ct);

    [HttpGet("api/public/workspaces/{slug}/sign-in-image")]
    public Task<IActionResult> GetSignInImage(string? slug, CancellationToken ct)
        => ServeAssetAsync(slug, b => (b.SignInImageStorageKey, b.SignInImageContentType), ct);

    /// <summary>
    /// Serves one public branding asset. Anonymous, so the workspace comes from
    /// the slug (or the installation's own workspace), never from a session.
    /// </summary>
    private async Task<IActionResult> ServeAssetAsync(
        string? slug,
        Func<WorkspaceBranding, (string? Key, string? ContentType)> pick,
        CancellationToken ct)
    {
        var workspace = await db.ResolveWorkspaceAsync(slug, ct);
        if (workspace is null)
            return NotFound();

        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspace.Id, ct);
        if (branding is null)
            return NotFound();

        var (key, contentType) = pick(branding);
        if (key is null)
            return NotFound();

        Response.Headers.CacheControl = "public, max-age=300";

        // A branding asset is public by definition, so a CDN in front of it is a
        // plain win. 302 rather than 301: the workspace can change provider or
        // drop the CDN, and a permanent redirect would be cached past that.
        var cdnUrl = await storage.PublicUrlAsync(workspace.Id, key, ct);
        if (cdnUrl is not null)
            return Redirect(cdnUrl);

        var stream = await storage.OpenReadAsync(workspace.Id, key, ct);
        return File(stream, contentType ?? "application/octet-stream");
    }

    // ---- Admin ---------------------------------------------------------------

    [HttpGet("api/admin/branding")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Get(CancellationToken ct)
        => Ok(ToResponse(await GetOrCreateAsync(ct)));

    [HttpPut("api/admin/branding")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update([FromBody] SaveBrandingRequest request, CancellationToken ct)
    {
        if (request.PrimaryColor is not null && !HexColorRegex().IsMatch(request.PrimaryColor))
            return BadRequest(new { error = "Primary colour must be a hex value like #2563EB." });

        var branding = await GetOrCreateAsync(ct);
        if (request.PrimaryColor is not null) branding.PrimaryColor = request.PrimaryColor;
        if (request.PageTitle is not null) branding.PageTitle = NullIfEmpty(request.PageTitle);
        if (request.WelcomeText is not null) branding.WelcomeText = NullIfEmpty(request.WelcomeText);
        if (request.FooterText is not null) branding.FooterText = NullIfEmpty(request.FooterText);
        if (request.HidePoweredBy is not null) branding.HidePoweredBy = request.HidePoweredBy.Value;
        branding.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(branding));
    }

    [HttpPost("api/admin/branding/logo")]
    [Authorize(Policy = "Admin")]
    [RequestSizeLimit(MaxLogoBytes + 1024)]
    public Task<IActionResult> UploadLogo(IFormFile file, CancellationToken ct)
        => StoreAssetAsync(
            file, MaxLogoBytes, AllowedLogoTypes, "Logos are limited to 1 MB.",
            "Logo must be PNG, SVG, JPEG or WebP.",
            b => b.LogoStorageKey,
            (b, key, type) => { b.LogoStorageKey = key; b.LogoContentType = type; },
            ct);

    [HttpDelete("api/admin/branding/logo")]
    [Authorize(Policy = "Admin")]
    public Task<IActionResult> DeleteLogo(CancellationToken ct)
        => ClearAssetAsync(
            b => b.LogoStorageKey,
            b => { b.LogoStorageKey = null; b.LogoContentType = null; },
            ct);

    [HttpPost("api/admin/branding/sign-in-image")]
    [Authorize(Policy = "Admin")]
    [RequestSizeLimit(MaxSignInImageBytes + 1024)]
    public Task<IActionResult> UploadSignInImage(IFormFile file, CancellationToken ct)
        => StoreAssetAsync(
            file, MaxSignInImageBytes, AllowedSignInImageTypes, "Sign-in images are limited to 5 MB.",
            "Sign-in image must be PNG, JPEG, WebP or GIF.",
            b => b.SignInImageStorageKey,
            (b, key, type) => { b.SignInImageStorageKey = key; b.SignInImageContentType = type; },
            ct);

    [HttpDelete("api/admin/branding/sign-in-image")]
    [Authorize(Policy = "Admin")]
    public Task<IActionResult> DeleteSignInImage(CancellationToken ct)
        => ClearAssetAsync(
            b => b.SignInImageStorageKey,
            b => { b.SignInImageStorageKey = null; b.SignInImageContentType = null; },
            ct);

    private async Task<IActionResult> StoreAssetAsync(
        IFormFile file,
        long maxBytes,
        string[] allowedTypes,
        string tooLargeMessage,
        string wrongTypeMessage,
        Func<WorkspaceBranding, string?> currentKey,
        Action<WorkspaceBranding, string, string> assign,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A file is required." });
        if (file.Length > maxBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = tooLargeMessage });
        if (!allowedTypes.Contains(file.ContentType))
            return BadRequest(new { error = wrongTypeMessage });

        var branding = await GetOrCreateAsync(ct);
        var oldKey = currentKey(branding);

        var workspaceId = User.GetWorkspaceId();
        await using var stream = file.OpenReadStream();
        // Public: branding assets are shown on the sign-in page, the portal and
        // every notification email, all read by people with no session. They are
        // the only thing Trackly writes that is not private.
        var key = await storage.SaveAsync(
            workspaceId, $"{workspaceId}/branding", file.FileName, stream, StorageVisibility.Public, ct);
        assign(branding, key, file.ContentType);
        branding.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // After the save, not before: a delete that ran first would leave the
        // workspace with no asset at all if the write then failed.
        if (oldKey is not null)
            await storage.DeleteAsync(workspaceId, oldKey, ct);
        return Ok(ToResponse(branding));
    }

    private async Task<IActionResult> ClearAssetAsync(
        Func<WorkspaceBranding, string?> currentKey,
        Action<WorkspaceBranding> clear,
        CancellationToken ct)
    {
        var branding = await GetOrCreateAsync(ct);
        var oldKey = currentKey(branding);
        clear(branding);
        branding.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (oldKey is not null)
            await storage.DeleteAsync(User.GetWorkspaceId(), oldKey, ct);
        return Ok(ToResponse(branding));
    }

    private async Task<WorkspaceBranding> GetOrCreateAsync(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);
        if (branding is null)
        {
            branding = new WorkspaceBranding { WorkspaceId = workspaceId };
            db.WorkspaceBrandings.Add(branding);
        }
        return branding;
    }

    // The admin UI builds the preview URLs from the workspace slug it already
    // knows; the flags just say whether an asset exists.
    private static object ToResponse(WorkspaceBranding b) => new
    {
        hasLogo = b.LogoStorageKey is not null,
        hasSignInImage = b.SignInImageStorageKey is not null,
        primaryColor = b.PrimaryColor,
        pageTitle = b.PageTitle,
        welcomeText = b.WelcomeText,
        footerText = b.FooterText,
        hidePoweredBy = b.HidePoweredBy,
        updatedAt = b.UpdatedAt,
    };

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
