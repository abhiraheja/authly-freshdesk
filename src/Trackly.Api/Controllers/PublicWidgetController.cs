using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Modules.Widgets;

namespace Trackly.Api.Controllers;

/// <summary>
/// The embedded panel's own API. Anonymous, addressed by the widget's public
/// token, and authenticated — where it needs to be — by the visitor token in
/// <c>X-Trackly-Visitor</c>.
///
/// <para>
/// No endpoint here accepts a workspace slug or id: the workspace is whatever
/// the widget token resolves to, server-side (invariant 1). Customer-facing, so
/// everything it returns is the workspace's branding and always light
/// (invariant 6).
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/widget/{token}")]
public class PublicWidgetController(WidgetPublicService widgets) : ControllerBase
{
    /// <summary>
    /// The browser's own origin. Compared against the widget's allowlist inside
    /// the service — an embed on an unlisted site can still draw the iframe (see
    /// plan § 9.2 for why that cannot be stopped here), but it gets nothing back.
    /// </summary>
    private string? Origin => Request.Headers.Origin.ToString() is { Length: > 0 } o ? o : null;

    private string VisitorToken => Request.Headers["X-Trackly-Visitor"].ToString();

    [HttpGet("config")]
    public async Task<IActionResult> Config(string token, CancellationToken ct)
    {
        var config = await widgets.GetConfigAsync(token, Origin, ct);
        if (config is null) return NotFound(new { error = "Widget not found." });

        // Private, not public: the response depends on the caller's Origin, and a
        // shared cache keyed only on the URL would hand one site another site's
        // answer — including the 403 it was supposed to get.
        Response.Headers.CacheControl = "private, max-age=60";
        Response.Headers.Vary = "Origin";
        return Ok(config);
    }

    [HttpPost("session")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> StartSession(
        string token, [FromBody] WidgetIdentityRequest? req, CancellationToken ct)
    {
        var session = await widgets.StartSessionAsync(token, Origin, VisitorToken, req, ct);
        return session is null ? NotFound(new { error = "Widget not found." }) : Ok(session);
    }

    [HttpPatch("session")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> UpdateSession(
        string token, [FromBody] WidgetIdentityRequest req, CancellationToken ct)
    {
        var session = await widgets.UpdateSessionAsync(token, Origin, VisitorToken, req, ct);
        return session is null ? NotFound(new { error = "Session not found." }) : Ok(session);
    }

    // ---- Email verification --------------------------------------------------

    [HttpPost("session/verify-email")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SendEmailCode(
        string token, [FromBody] WidgetVerifyEmailRequest req, CancellationToken ct)
    {
        var sent = await widgets.SendEmailCodeAsync(token, Origin, VisitorToken, req.Email ?? "", ct);
        return sent ? NoContent() : NotFound(new { error = "Session not found." });
    }

    [HttpPost("session/verify-email/confirm")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ConfirmEmailCode(
        string token, [FromBody] WidgetConfirmEmailRequest req, CancellationToken ct)
    {
        var session = await widgets.ConfirmEmailCodeAsync(
            token, Origin, VisitorToken, req.Email ?? "", req.Code ?? "", ct);
        return session is null ? NotFound(new { error = "Session not found." }) : Ok(session);
    }

    // ---- Conversations -------------------------------------------------------

    [HttpPost("conversations")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> CreateConversation(
        string token, [FromBody] CreateWidgetConversationRequest req, CancellationToken ct)
    {
        var created = await widgets.CreateConversationAsync(token, Origin, VisitorToken, req, ct);
        return created is null
            ? NotFound(new { error = "Session not found." })
            : StatusCode(StatusCodes.Status201Created, created);
    }
}
