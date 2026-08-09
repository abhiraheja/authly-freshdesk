using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

/// <summary>
/// The back half of a mail OAuth handshake.
///
/// **The provider redirects the browser to the SPA, not to here.** The registered
/// redirect URI is a front-end route (`/oauth/callback`); that page reads the
/// `code` and `state` out of its own query string and posts them to this endpoint
/// as an ordinary same-origin request.
///
/// Doing it that way is what lets this be `[Authorize]`. The older shape — the
/// provider redirecting straight at an API route — could not be: that request is
/// a top-level navigation from the provider's own domain, so Trackly's SameSite
/// session cookie does not ride along and an authenticated admin would have been
/// 401'd. The single-use `state` row still carries the security (invariant 4);
/// the admin session and the workspace check are now belt as well as braces.
/// </summary>
[ApiController]
[Route("api/admin/email/oauth")]
[Authorize(Policy = "Admin")]
public class EmailOAuthController(EmailProviderService providers, IConfiguration configuration) : ControllerBase
{
    /// <summary>
    /// The redirect URI, which **must be byte-identical between the authorize
    /// request, the token exchange, and what the operator registered in their
    /// provider console.** Static and shared with
    /// <see cref="EmailProvidersController"/> so there is one definition rather
    /// than two that can drift by a trailing slash.
    ///
    /// Built from `App:FrontendBaseUrl` rather than the API's own origin, because
    /// the address the provider sends the browser to is the SPA's. The dev default
    /// matches the Angular dev server.
    /// </summary>
    public static string CallbackUri(IConfiguration configuration)
    {
        var frontend = configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:4200";
        return $"{frontend.TrimEnd('/')}/oauth/callback";
    }

    public record CompleteRequest(string? State, string? Code);

    /// <summary>
    /// Consumes the state, exchanges the code, stores the tokens. Returns the
    /// provider key so the callback page can name it in the success toast.
    /// </summary>
    [HttpPost("complete")]
    public async Task<IActionResult> Complete([FromBody] CompleteRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.State) || string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "The provider returned an incomplete response." });

        var (provider, error) = await providers.CompleteConnectAsync(
            User.GetWorkspaceId(), request.State, request.Code, CallbackUri(configuration), ct);

        return error is not null
            ? BadRequest(new { error })
            : Ok(new { provider });
    }
}
