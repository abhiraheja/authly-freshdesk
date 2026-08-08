using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Modules.Sso;

namespace Trackly.Api.Controllers;

// Public SSO endpoints. No session auth — the flow itself authenticates the user.
// State/nonce/PKCE correlation is server-side (sso_login_states), so no
// cross-site cookie is needed during the redirect dance.
//
// One callback serves OIDC and OAuth 2.0: `state` identifies the connection, and
// the connection decides how the code is exchanged. That also keeps the redirect
// URI an admin registers at the IdP down to a single, unchanging URL.
[ApiController]
public class SsoController(SsoLoginService sso, IConfiguration configuration) : ControllerBase
{
    private string FrontendBaseUrl => configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";

    // The IdP-registered redirect URI must be byte-identical on start and callback.
    private string CallbackUri()
    {
        var apiBase = configuration.GetNonEmpty("App:ApiBaseUrl") ?? $"{Request.Scheme}://{Request.Host}";
        return $"{apiBase.TrimEnd('/')}/api/auth/sso/callback";
    }

    /// <param name="connection">
    /// Which provider to start. Omitted by links written before a workspace could
    /// have more than one, which then fall through to its first enabled provider.
    /// </param>
    [HttpGet("api/auth/sso")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Start(
        [FromQuery] string workspace, [FromQuery] Guid? connection, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(workspace))
            return BadRequest(new { error = "workspace is required." });

        var result = await sso.StartAsync(workspace, connection, CallbackUri(), ct);
        if (!result.Ok)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString(result.Error ?? "SSO unavailable")}");
        return Redirect(result.AuthorizeUrl!);
    }

    [HttpGet("api/auth/sso/callback")]
    public async Task<IActionResult> Callback(
        [FromQuery] string? state, [FromQuery] string? code,
        [FromQuery] string? error, [FromQuery(Name = "error_description")] string? errorDescription,
        CancellationToken ct)
    {
        // The IdP can bounce back with an error instead of a code.
        if (!string.IsNullOrEmpty(error))
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString(errorDescription ?? error)}");
        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(code))
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("Malformed SSO response.")}");

        var result = await sso.CompleteAsync(
            state, code, CallbackUri(),
            HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent, ct);

        if (!result.Ok)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString(result.Error!)}");

        // Trackly's own session cookie — SSO is done, the IdP is out of the loop.
        TracklySession.AppendSessionCookie(Response, result.SessionToken!);
        return Redirect($"{FrontendBaseUrl}/auth/sso/complete");
    }
}
