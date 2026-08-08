using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules;

namespace Trackly.Api.Controllers;

/// <summary>
/// What the sign-in page should offer. Anonymous, because it is read before
/// anyone has signed in.
///
/// Reveals only which methods are switched on and the SSO provider's display
/// name — nothing about who has an account here. It replaces the login page's
/// old habit of asking about SSO separately, so the screen renders in one round
/// trip instead of guessing and then correcting itself.
/// </summary>
[ApiController]
public class PublicLoginController(TracklyDbContext db) : ControllerBase
{
    [HttpGet("api/public/login-methods")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Methods([FromQuery] string? workspace, CancellationToken ct)
    {
        var ws = await db.ResolveWorkspaceAsync(workspace, ct);
        if (ws is null)
            return Ok(new { needsSetup = true, passwordLoginEnabled = false, emailLoginEnabled = false, sso = (object?)null });

        var connection = await db.SsoConnections
            .Where(c => c.WorkspaceId == ws.Id && c.Status != SsoStatus.Error)
            .Select(c => new { c.ProviderName, c.Protocol })
            .FirstOrDefaultAsync(ct);

        return Ok(new
        {
            needsSetup = false,
            passwordLoginEnabled = ws.PasswordLoginEnabled,
            emailLoginEnabled = ws.EmailLoginEnabled,
            sso = connection is null
                ? null
                : new
                {
                    providerName = connection.ProviderName,
                    protocol = connection.Protocol,
                    startUrl = $"/api/auth/sso?workspace={ws.Slug}",
                },
        });
    }
}
