using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules;

namespace Trackly.Api.Controllers;

// Tells the login page where to start SSO, or 204 when there is nothing to start.
//
// This used to key on the email's DOMAIN: prove you own acme.com by DNS TXT, and
// @acme.com logins were routed to that workspace's IdP. That only ever solved
// picking the right workspace out of many. Trackly is self-hosted — there is one
// workspace and one connection — so the email is irrelevant and the domain
// machinery it depended on is gone.
//
// The `email` parameter is still accepted and ignored, so links and clients built
// against the old shape keep working.
[ApiController]
public class PublicSsoController(TracklyDbContext db) : ControllerBase
{
    [HttpGet("api/public/sso/discover")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Discover(CancellationToken ct)
    {
        var workspace = await db.ResolveWorkspaceAsync(null, ct);
        if (workspace is null)
            return NoContent();

        var connection = await db.SsoConnections
            .Where(c => c.WorkspaceId == workspace.Id && c.Status != SsoStatus.Error)
            .Select(c => new { c.ProviderName, c.Protocol })
            .FirstOrDefaultAsync(ct);

        if (connection is null)
            return NoContent();

        return Ok(new
        {
            workspaceSlug = workspace.Slug,
            providerName = connection.ProviderName,
            protocol = connection.Protocol,
            startUrl = $"/api/auth/sso?workspace={workspace.Slug}",
        });
    }
}
