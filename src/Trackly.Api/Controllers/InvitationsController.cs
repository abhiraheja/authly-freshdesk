using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Api.Auth;
using Trackly.Modules.Invitations;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/invitations")]
public class InvitationsController(InvitationService invitations) : ControllerBase
{
    public record CreateInvitationRequest(string Email, string Role);
    public record AcceptInvitationRequest(string Token, string? Name);

    [HttpPost]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateInvitationRequest request, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created,
            await invitations.CreateAsync(User.GetActor(), request.Email, request.Role, ct));

    [HttpGet]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> ListPending(CancellationToken ct)
        => Ok(await invitations.ListPendingAsync(User.GetActor(), ct));

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct)
        => await invitations.RevokeAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    // Public info for the accept page — never consumes the token.
    [HttpGet("{token}")]
    public async Task<IActionResult> Info(string token, CancellationToken ct)
    {
        var info = await invitations.GetByTokenAsync(token, ct);
        return info is null ? NotFound(new { error = "Invitation not found." }) : Ok(info);
    }

    [HttpPost("accept")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Accept([FromBody] AcceptInvitationRequest request, CancellationToken ct)
    {
        var result = await invitations.AcceptAsync(
            request.Token, request.Name,
            HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent, ct);
        if (result is null)
            return BadRequest(new { error = "This invitation is invalid, expired or already used." });

        TracklySession.AppendSessionCookie(Response, result.SessionToken);
        return Ok(new { status = "ok", user = UserResponse.From(result.User) });
    }
}
