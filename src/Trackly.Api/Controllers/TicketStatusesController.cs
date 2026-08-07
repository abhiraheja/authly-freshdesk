using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

/// <summary>
/// The workspace's statuses and its workflow.
///
/// Agents READ them — every status picker in the app is built from this — and
/// only admins change them, which is the point of moving them out of code.
/// </summary>
[ApiController]
[Route("api/ticket-statuses")]
[Authorize(Policy = "AgentOrAdmin")]
public class TicketStatusesController(TicketStatusService statuses) : ControllerBase
{
    public record CreateStatusRequest(string Category, string Name, string? Color);

    public record SaveStatusRequest(
        string? Name, string? Category, string? Color, int? SortOrder, bool? IsActive, bool? IsDefault);

    public record SaveWorkflowRequest(List<TransitionInput> Transitions);

    /// <summary>
    /// The vocabulary. `includeInactive` is for the admin screen, which has to
    /// show retired statuses in order to bring one back.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await statuses.ListAsync(User.GetWorkspaceId(), includeInactive, ct));

    /// <summary>
    /// Where a ticket in <paramref name="from"/> may go next — what the picker
    /// on the ticket screen is built from. Includes the current status, so the
    /// picker can show what is selected.
    /// </summary>
    [HttpGet("reachable")]
    public async Task<IActionResult> Reachable([FromQuery] string? from, CancellationToken ct)
        => Ok(await statuses.ReachableAsync(User.GetWorkspaceId(), from, ct));

    /// <summary>The fixed five. Sent so the client never hard-codes them.</summary>
    [HttpGet("categories")]
    public IActionResult Categories() => Ok(TicketStatusCategory.All);

    [HttpPost]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateStatusRequest request, CancellationToken ct)
    {
        var created = await statuses.CreateAsync(
            User.GetWorkspaceId(), request.Category, request.Name, request.Color, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveStatusRequest request, CancellationToken ct)
    {
        var updated = await statuses.UpdateAsync(
            User.GetWorkspaceId(), id, request.Name, request.Category, request.Color,
            request.SortOrder, request.IsActive, request.IsDefault, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    // Each failure has a different fix, so each gets its own message rather than
    // one generic 400 the admin has to guess at.
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await statuses.DeleteAsync(User.GetWorkspaceId(), id, ct) switch
        {
            TicketStatusDeleteResult.Deleted => NoContent(),
            TicketStatusDeleteResult.NotFound => NotFound(),
            TicketStatusDeleteResult.SystemStatus => Conflict(new
            {
                error = "This is a built-in status. Deactivate it instead — it will stop appearing in pickers.",
            }),
            TicketStatusDeleteResult.InUse => Conflict(new
            {
                error = "Tickets are in this status. Deactivate it instead so those tickets keep their label.",
            }),
            _ => Conflict(new { error = "At least one status must stay active." }),
        };

    // ---- Workflow ----

    [HttpGet("workflow")]
    public async Task<IActionResult> Workflow(CancellationToken ct)
        => Ok(await statuses.TransitionsAsync(User.GetWorkspaceId(), ct));

    /// <summary>
    /// Replaces the whole workflow. A matrix screen edits every cell at once, so
    /// sending diffs would mean the client computing what changed — which is how
    /// a half-applied workflow happens.
    /// </summary>
    [HttpPut("workflow")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveWorkflow([FromBody] SaveWorkflowRequest request, CancellationToken ct)
    {
        await statuses.SetTransitionsAsync(User.GetWorkspaceId(), request.Transitions ?? [], ct);
        return NoContent();
    }
}
