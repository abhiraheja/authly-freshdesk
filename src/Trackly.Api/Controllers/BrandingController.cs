using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

[ApiController]
public partial class BrandingController(TracklyDbContext db, IFileStorage storage) : ControllerBase
{
    private const long MaxLogoBytes = 1024 * 1024; // 1 MB per the mockups
    private static readonly string[] AllowedLogoTypes =
        ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColorRegex();

    public record SaveBrandingRequest(
        string? PrimaryColor,
        string? PageTitle,
        string? WelcomeText,
        string? FooterText,
        bool? HidePoweredBy);

    // Public, cacheable — drives the branded submit form, portal and widget.
    [HttpGet("api/public/workspaces/{slug}/branding")]
    public async Task<IActionResult> GetPublic(string slug, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Slug == slug, ct);
        if (workspace is null)
            return NotFound();

        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspace.Id, ct);
        var categories = await db.Categories
            .Where(c => c.WorkspaceId == workspace.Id)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(ct);

        Response.Headers.CacheControl = "public, max-age=60";
        return Ok(new
        {
            workspaceName = workspace.Name,
            slug = workspace.Slug,
            logoUrl = branding?.LogoStorageKey is null ? null : $"/api/public/workspaces/{slug}/logo",
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

    [HttpGet("api/public/workspaces/{slug}/logo")]
    public async Task<IActionResult> GetLogo(string slug, CancellationToken ct)
    {
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.Workspace.Slug == slug, ct);
        if (branding?.LogoStorageKey is null)
            return NotFound();

        Response.Headers.CacheControl = "public, max-age=300";
        var stream = await storage.OpenReadAsync(branding.LogoStorageKey, ct);
        return File(stream, branding.LogoContentType ?? "application/octet-stream");
    }

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
    public async Task<IActionResult> UploadLogo(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A logo file is required." });
        if (file.Length > MaxLogoBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Logos are limited to 1 MB." });
        if (!AllowedLogoTypes.Contains(file.ContentType))
            return BadRequest(new { error = "Logo must be PNG, SVG, JPEG or WebP." });

        var branding = await GetOrCreateAsync(ct);
        var oldKey = branding.LogoStorageKey;

        await using var stream = file.OpenReadStream();
        branding.LogoStorageKey = await storage.SaveAsync($"{User.GetWorkspaceId()}/branding", file.FileName, stream, ct);
        branding.LogoContentType = file.ContentType;
        branding.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (oldKey is not null)
            await storage.DeleteAsync(oldKey, ct);
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

    // The admin UI builds the logo preview URL from the workspace slug it already
    // knows; hasLogo just says whether one exists.
    private static object ToResponse(WorkspaceBranding b) => new
    {
        hasLogo = b.LogoStorageKey is not null,
        primaryColor = b.PrimaryColor,
        pageTitle = b.PageTitle,
        welcomeText = b.WelcomeText,
        footerText = b.FooterText,
        hidePoweredBy = b.HidePoweredBy,
    };

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
