using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Api.Auth;
using Trackly.Modules.Auth;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/signup")]
public class SignupController(AuthService authService) : ControllerBase
{
    // Onboarding steps 1–2: the email was verified via magic link / code
    // (which is re-presented here and consumed now), then this creates the
    // workspace with the caller as its admin and issues a session.
    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Signup([FromBody] SignupRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.WorkspaceName) ||
            string.IsNullOrWhiteSpace(request.WorkspaceSlug))
            return BadRequest(new { error = "Email, workspace name and workspace URL are required." });

        var result = await authService.SignupAsync(
            request, HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent, ct);

        switch (result.Status)
        {
            case SignupStatus.Success:
                TracklySession.AppendSessionCookie(Response, result.SessionToken!);
                return Ok(new { status = "ok", user = UserResponse.From(result.User!) });
            case SignupStatus.SlugTaken:
                return Conflict(new { error = "That workspace URL is already taken." });
            case SignupStatus.InvalidSlug:
                return BadRequest(new
                {
                    error = "Workspace URL must be 1–30 lowercase letters, digits or hyphens, and not a reserved word.",
                });
            case SignupStatus.Locked:
                return StatusCode(StatusCodes.Status423Locked,
                    new { error = "Too many incorrect codes. Request a new sign-in email." });
            default:
                return BadRequest(new { error = "Invalid or expired sign-in link or code. Start again." });
        }
    }
}
