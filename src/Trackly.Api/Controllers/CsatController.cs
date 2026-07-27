using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Modules.Csat;

namespace Trackly.Api.Controllers;

// Public CSAT rating surface. Authenticated only by the single-use hashed token
// from the resolution email — never a session. The GET renders the branded form
// and does NOT consume the token; the POST records the rating exactly once.
[ApiController]
[AllowAnonymous]
public class CsatController(CsatService csat) : ControllerBase
{
    public record SubmitCsatRequest(int Rating, string? Comment);

    [HttpGet("api/public/csat/{ticketId:guid}")]
    public async Task<IActionResult> Get(Guid ticketId, [FromQuery] string? token, CancellationToken ct)
    {
        var view = await csat.GetPublicAsync(ticketId, token ?? "", ct);
        return view is null ? NotFound() : Ok(view);
    }

    [HttpPost("api/public/csat/{ticketId:guid}")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Submit(
        Guid ticketId, [FromQuery] string? token, [FromBody] SubmitCsatRequest req, CancellationToken ct)
    {
        var result = await csat.SubmitAsync(ticketId, token ?? "", req.Rating, req.Comment, ct);
        return result switch
        {
            CsatSubmit.Ok => NoContent(),
            CsatSubmit.AlreadySubmitted => Conflict(new { error = "This ticket has already been rated." }),
            CsatSubmit.BadRating => BadRequest(new { error = "Rating must be between 1 and 5." }),
            _ => NotFound(),
        };
    }
}
