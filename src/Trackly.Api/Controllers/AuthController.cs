using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Api.Auth;
using Trackly.Modules.Auth;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AuthService authService) : ControllerBase
{
    [HttpPost("magic-link/send")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SendMagicLink(
        [FromBody] SendMagicLinkRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
            return BadRequest(new { error = "A valid email address is required." });

        var status = await authService.SendMagicLinkAsync(request, ct);
        return status switch
        {
            SendMagicLinkStatus.Sent => NoContent(),
            SendMagicLinkStatus.RateLimited => StatusCode(StatusCodes.Status429TooManyRequests,
                new { error = "Too many sign-in emails requested. Try again in a few minutes." }),
            SendMagicLinkStatus.WorkspaceNotFound => NotFound(
                new { error = "Workspace not found." }),
            SendMagicLinkStatus.EmailLoginDisabled => StatusCode(StatusCodes.Status403Forbidden,
                new { error = "Email sign-in is disabled for this workspace. Use your organisation's SSO." }),
            _ => throw new InvalidOperationException(),
        };
    }

    [HttpPost("magic-link/verify")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> VerifyMagicLink(
        [FromBody] VerifyMagicLinkRequest request, CancellationToken ct)
    {
        var result = await authService.VerifyMagicLinkAsync(
            request, HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent, ct);

        switch (result.Status)
        {
            case VerifyStatus.Success:
                TracklySession.AppendSessionCookie(Response, result.SessionToken!);
                return Ok(new
                {
                    status = "ok",
                    user = UserResponse.From(result.User!),
                });
            case VerifyStatus.NotSetUp:
                return Conflict(new { error = "This Trackly installation has not been set up yet." });
            case VerifyStatus.Locked:
                return StatusCode(StatusCodes.Status423Locked,
                    new { error = "Too many incorrect codes. Request a new sign-in email." });
            case VerifyStatus.EmailLoginDisabled:
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { error = "Email sign-in is disabled for this workspace." });
            case VerifyStatus.UserInactive:
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { error = "This account has been deactivated." });
            default:
                return BadRequest(new { error = "Invalid or expired sign-in link or code." });
        }
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        if (Request.Cookies.TryGetValue(TracklySession.CookieName, out var token) &&
            !string.IsNullOrEmpty(token))
            await authService.LogoutAsync(token, ct);
        TracklySession.DeleteSessionCookie(Response);
        return NoContent();
    }
}
