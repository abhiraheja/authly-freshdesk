using Microsoft.AspNetCore.Mvc;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

/// <summary>
/// Where Google, Microsoft and Yahoo send the browser back after an admin
/// consents to a mail connection.
///
/// **No session policy, deliberately.** The request arrives as a top-level
/// navigation from the provider's own domain, and Trackly's session cookie is
/// SameSite — an `[Authorize]` here would 401 an admin who is perfectly well
/// signed in. What makes it safe is the single-use `state` row (invariant 4):
/// it is created by an authenticated admin, carries the workspace, and is
/// consumed before the code is exchanged, so a replayed callback URL does
/// nothing. Exactly the shape <see cref="SsoController.Callback"/> uses.
/// </summary>
[ApiController]
public class EmailOAuthController(EmailProviderService providers, IConfiguration configuration) : ControllerBase
{
    /// <summary>
    /// The redirect URI, which **must be byte-identical between the authorize
    /// request, this callback, and what the operator registered in their
    /// provider console.** Static and shared with
    /// <see cref="EmailProvidersController"/> so there is one definition rather
    /// than two that can drift by a trailing slash.
    /// </summary>
    public static string CallbackUri(IConfiguration configuration, HttpRequest request)
    {
        var apiBase = configuration.GetNonEmpty("App:ApiBaseUrl")
                      ?? $"{request.Scheme}://{request.Host}";
        return $"{apiBase.TrimEnd('/')}/api/email/oauth/callback";
    }

    private string FrontendBaseUrl => configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";

    /// <summary>
    /// Always a redirect back to the email settings screen, never a JSON body:
    /// there is a person looking at a browser tab at the end of this, not a
    /// client waiting on a response.
    /// </summary>
    [HttpGet("api/email/oauth/callback")]
    public async Task<IActionResult> Callback(
        [FromQuery] string? state, [FromQuery] string? code,
        [FromQuery] string? error, [FromQuery(Name = "error_description")] string? errorDescription,
        CancellationToken ct)
    {
        // The provider can bounce back with a refusal instead of a code — an
        // admin who clicked Cancel, or a consent screen that rejected the scope.
        if (!string.IsNullOrEmpty(error))
            return Failed(errorDescription ?? error);
        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(code))
            return Failed("The provider returned an incomplete response.");

        var (provider, failure) = await providers.CompleteConnectAsync(
            state, code, CallbackUri(configuration, Request), ct);

        return failure is not null
            ? Failed(failure)
            : Redirect($"{Settings}?connected={Uri.EscapeDataString(provider ?? "")}");
    }

    private string Settings => $"{FrontendBaseUrl.TrimEnd('/')}/admin/settings/email";

    private IActionResult Failed(string message) =>
        Redirect($"{Settings}?email_error={Uri.EscapeDataString(message)}");
}
