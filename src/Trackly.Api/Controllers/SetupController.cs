using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Api.Auth;
using Trackly.Modules.Setup;

namespace Trackly.Api.Controllers;

// First run on an empty database. Anonymous by necessity — there is no account
// to authenticate against yet — and single-use: once a workspace exists this
// endpoint can only ever answer 409.
[ApiController]
[Route("api/setup")]
public class SetupController(SetupService setup) : ControllerBase
{
    // Polled by the SPA before it renders anything, so it stays cheap and says
    // nothing beyond whether the installation has been claimed.
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
        => Ok(new { needsSetup = await setup.NeedsSetupAsync(ct) });

    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Run([FromBody] SetupRequest request, CancellationToken ct)
    {
        var result = await setup.RunAsync(
            request, HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent, ct);

        switch (result.Status)
        {
            case SetupStatus.Success:
                // Signed in immediately. See SetupService for why this cannot
                // wait on an email.
                TracklySession.AppendSessionCookie(Response, result.SessionToken!);
                return Ok(new { status = "ok", user = UserResponse.From(result.User!) });
            case SetupStatus.AlreadySetUp:
                return Conflict(new { error = "This Trackly installation has already been set up. Sign in instead." });
            default:
                return BadRequest(new { error = "An organisation name and a valid email address are required." });
        }
    }
}
