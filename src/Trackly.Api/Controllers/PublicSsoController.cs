using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Public SSO discovery for the login page: given an email, is its domain claimed
// by a workspace with discoverable, verified domain routing and an active SSO
// connection? If so, tell the SPA where to start SSO; otherwise it falls back to
// the magic-link flow. Returns 204 when there's nothing to route to.
[ApiController]
public class PublicSsoController(TracklyDbContext db) : ControllerBase
{
    [HttpGet("api/public/sso/discover")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Discover([FromQuery] string email, CancellationToken ct)
    {
        var at = (email ?? "").LastIndexOf('@');
        if (at < 0 || at == email!.Length - 1)
            return NoContent();
        var domain = email[(at + 1)..].Trim().ToLowerInvariant();

        var match = await db.WorkspaceDomains
            .Where(d => d.Domain == domain && d.Verified && d.Discoverable)
            .Select(d => new
            {
                d.WorkspaceId,
                Slug = d.Workspace.Slug,
                Connection = db.SsoConnections
                    .Where(c => c.WorkspaceId == d.WorkspaceId && c.Status != SsoStatus.Error)
                    .Select(c => new { c.ProviderName, c.Protocol })
                    .FirstOrDefault(),
            })
            .FirstOrDefaultAsync(ct);

        if (match?.Connection is null)
            return NoContent();

        return Ok(new
        {
            workspaceSlug = match.Slug,
            providerName = match.Connection.ProviderName,
            protocol = match.Connection.Protocol,
            startUrl = $"/api/auth/sso?workspace={match.Slug}",
        });
    }
}
