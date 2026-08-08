using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Infrastructure.Data;
using Trackly.Modules;
using Trackly.Modules.Sso;

namespace Trackly.Api.Controllers;

// Tells the login page where to start SSO, or 204 when there is nothing to start.
//
// This used to key on the email's DOMAIN: prove you own acme.com by DNS TXT, and
// @acme.com logins were routed to that workspace's IdP. That only ever solved
// picking the right workspace out of many. Trackly is self-hosted — there is one
// workspace — so the email is irrelevant and the domain machinery it depended on
// is gone.
//
// A workspace may now offer several providers. This endpoint keeps its
// single-provider shape for clients built against it and reports the first one;
// anything rendering buttons should read /api/public/login-methods instead.
//
// The `email` parameter is still accepted and ignored, so links and clients built
// against the old shape keep working.
[ApiController]
public class PublicSsoController(TracklyDbContext db, SsoLoginService sso) : ControllerBase
{
    [HttpGet("api/public/sso/discover")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Discover(CancellationToken ct)
    {
        var workspace = await db.ResolveWorkspaceAsync(null, ct);
        if (workspace is null)
            return NoContent();

        var connections = await sso.ListForLoginAsync(workspace.Id, customerFacing: false, ct);
        var connection = connections.FirstOrDefault();
        if (connection is null)
            return NoContent();

        return Ok(new
        {
            workspaceSlug = workspace.Slug,
            providerName = connection.ProviderName,
            protocol = connection.Protocol,
            startUrl = PublicLoginController.StartUrl(connection, workspace.Slug),
        });
    }
}
