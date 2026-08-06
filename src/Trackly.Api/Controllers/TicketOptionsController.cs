using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Configurable ticket vocabularies (priority, channel).
//
// Agents READ them — the new-ticket form is built from these lists. Only admins
// change them, which is the whole point of moving them out of code.
[ApiController]
[Route("api/ticket-options")]
[Authorize(Policy = "AgentOrAdmin")]
public class TicketOptionsController(TicketOptionService options) : ControllerBase
{
    public record SaveOptionRequest(string? Label, string? Color, int? SortOrder, bool? IsActive);
    public record CreateOptionRequest(string Kind, string Label, string? Color);

    // includeInactive is for the admin screen, which has to show retired options
    // in order to bring one back. Pickers ask for the default (active only).
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string kind, [FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await options.ListAsync(User.GetWorkspaceId(), kind, includeInactive, ct));

    [HttpPost]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateOptionRequest request, CancellationToken ct)
    {
        var created = await options.CreateAsync(
            User.GetWorkspaceId(), request.Kind, request.Label, request.Color, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveOptionRequest request, CancellationToken ct)
    {
        var updated = await options.UpdateAsync(
            User.GetWorkspaceId(), id, request.Label, request.Color, request.SortOrder, request.IsActive, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    // The failure modes are spelled out rather than collapsed into one 400,
    // because each has a different fix and the UI says so.
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await options.DeleteAsync(User.GetWorkspaceId(), id, ct) switch
        {
            TicketOptionDeleteResult.Deleted => NoContent(),
            TicketOptionDeleteResult.NotFound => NotFound(),
            TicketOptionDeleteResult.SystemOption => Conflict(new
            {
                error = "This is a built-in option. Deactivate it instead — it will stop appearing in pickers.",
            }),
            TicketOptionDeleteResult.InUse => Conflict(new
            {
                error = "Tickets already use this option. Deactivate it instead so those tickets keep their label.",
            }),
            _ => Conflict(new { error = "At least one option must stay active." }),
        };
}
