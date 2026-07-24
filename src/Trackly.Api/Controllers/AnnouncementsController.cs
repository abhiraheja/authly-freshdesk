using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Announcements;

namespace Trackly.Api.Controllers;

// Admin-only broadcast announcements.
[ApiController]
[Route("api/announcements")]
[Authorize(Policy = "Admin")]
public class AnnouncementsController(AnnouncementService announcements) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await announcements.ListAsync(User.GetActor(), ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var a = await announcements.GetAsync(User.GetActor(), id, ct);
        return a is null ? NotFound() : Ok(a);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAnnouncementRequest req, CancellationToken ct)
    {
        var a = await announcements.CreateAsync(User.GetActor(), req, ct);
        return CreatedAtAction(nameof(Get), new { id = a.Id }, a);
    }

    [HttpPost("{id:guid}/send")]
    public async Task<IActionResult> Send(Guid id, CancellationToken ct)
    {
        var a = await announcements.SendAsync(User.GetActor(), id, ct);
        return a is null ? NotFound() : Ok(a);
    }
}
