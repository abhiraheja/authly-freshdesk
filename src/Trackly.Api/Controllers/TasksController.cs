using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

/// <summary>
/// Tasks across every ticket — the agent's own checklist, in one place.
///
/// Its own controller rather than another route on <see cref="TicketDetailController"/>
/// because it is not scoped to a ticket: the whole point is that it crosses them.
/// The per-ticket routes stay where they are; this only reads.
///
/// Agent/admin. A task is internal work breakdown, and its title routinely says
/// things about a customer that the customer was never meant to read (invariant 5).
/// </summary>
[ApiController]
[Route("api/tasks")]
[Authorize(Policy = "AgentOrAdmin")]
public class TasksController(TicketTaskService tasks) : ControllerBase
{
    /// <summary>
    /// <c>assignee</c> takes an agent id, or the literal <c>me</c>.
    ///
    /// <c>me</c> exists so the sidebar link is a plain URL the client can build
    /// without knowing who is signed in — and so a bookmarked or shared link keeps
    /// meaning "mine" for whoever opens it rather than freezing one agent's id
    /// into it.
    ///
    /// Omit it entirely for the whole team, which is what a lead wants.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? assignee,
        [FromQuery] bool includeDone,
        [FromQuery] bool includeFinishedTickets,
        CancellationToken ct)
    {
        var actor = User.GetActor();

        Guid? assigneeId = null;
        var unassigned = false;
        if (string.Equals(assignee, "me", StringComparison.OrdinalIgnoreCase))
            assigneeId = actor.UserId;
        else if (string.Equals(assignee, "none", StringComparison.OrdinalIgnoreCase))
            unassigned = true;
        else if (Guid.TryParse(assignee, out var parsed))
            assigneeId = parsed;
        // Anything else — including an unparseable id — means "everybody". A
        // silent fallback is right here: the alternative is a 400 on a URL a
        // person typed, for a screen that has a perfectly good default.

        return Ok(await tasks.MineAsync(
            actor, assigneeId, unassigned, includeDone,
            openTicketsOnly: !includeFinishedTickets, ct));
    }
}
