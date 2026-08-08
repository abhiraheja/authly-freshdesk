using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules;
using Trackly.Modules.Sso;

namespace Trackly.Api.Controllers;

/// <summary>
/// What the sign-in page should offer. Anonymous, because it is read before
/// anyone has signed in.
///
/// Reveals only which methods are switched on and the SSO providers' display
/// names — nothing about who has an account here. It replaces the login page's
/// old habit of asking about SSO separately, so the screen renders in one round
/// trip instead of guessing and then correcting itself.
///
/// **The `workspace` parameter selects the audience.** A slug is only ever in
/// the URL when the visitor arrived from a branded, customer-facing link, so
/// that is what distinguishes "show the customer providers" from "show the staff
/// ones" — the same split the login screen already uses to decide whose brand to
/// wear (invariant 6).
/// </summary>
[ApiController]
public class PublicLoginController(TracklyDbContext db, SsoLoginService sso) : ControllerBase
{
    [HttpGet("api/public/login-methods")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Methods([FromQuery] string? workspace, CancellationToken ct)
    {
        var ws = await db.ResolveWorkspaceAsync(workspace, ct);
        if (ws is null)
            return Ok(new
            {
                needsSetup = true,
                passwordLoginEnabled = false,
                emailLoginEnabled = false,
                sso = (object?)null,
                ssoProviders = Array.Empty<object>(),
            });

        var customerFacing = !string.IsNullOrWhiteSpace(workspace);
        var connections = await sso.ListForLoginAsync(ws.Id, customerFacing, ct);

        var providers = connections.Select(c => new
        {
            id = c.Id,
            provider = c.Provider,
            providerName = c.ProviderName,
            protocol = c.Protocol,
            startUrl = StartUrl(c, ws.Slug),
        }).ToList();

        return Ok(new
        {
            needsSetup = false,
            passwordLoginEnabled = ws.PasswordLoginEnabled,
            emailLoginEnabled = ws.EmailLoginEnabled,
            // Kept for clients written when a workspace had exactly one
            // connection; new callers read ssoProviders and render every button.
            sso = providers.Count == 0 ? null : providers[0],
            ssoProviders = providers,
        });
    }

    internal static string StartUrl(SsoConnection c, string slug)
    {
        var path = c.Protocol == SsoProtocol.Saml ? "/api/auth/saml" : "/api/auth/sso";
        return $"{path}?workspace={Uri.EscapeDataString(slug)}&connection={c.Id}";
    }
}
