using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Problems;

namespace Trackly.Api.Controllers;

// Problems are an internal (agent/admin) grouping — customers never see them.
[ApiController]
[Route("api/problems")]
[Authorize(Policy = "AgentOrAdmin")]
public class ProblemsController(ProblemService problems) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await problems.ListAsync(User.GetActor(), ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var problem = await problems.GetAsync(User.GetActor(), id, ct);
        return problem is null ? NotFound() : Ok(problem);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateProblemRequest req, CancellationToken ct)
    {
        var problem = await problems.CreateAsync(User.GetActor(), req, ct);
        return CreatedAtAction(nameof(Get), new { id = problem.Id }, problem);
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateProblemRequest req, CancellationToken ct)
    {
        var problem = await problems.UpdateAsync(User.GetActor(), id, req, ct);
        return problem is null ? NotFound() : Ok(problem);
    }

    [HttpPost("{id:guid}/tickets")]
    public async Task<IActionResult> LinkTicket(Guid id, [FromBody] LinkTicketRequest req, CancellationToken ct)
    {
        var ok = await problems.LinkTicketAsync(User.GetActor(), id, req.TicketId, ct);
        return ok ? NoContent() : NotFound();
    }

    [HttpDelete("tickets/{ticketId:guid}")]
    public async Task<IActionResult> UnlinkTicket(Guid ticketId, CancellationToken ct)
    {
        var ok = await problems.UnlinkTicketAsync(User.GetActor(), ticketId, ct);
        return ok ? NoContent() : NotFound();
    }

    [HttpPost("{id:guid}/resolve")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveProblemRequest? req, CancellationToken ct)
    {
        var problem = await problems.ResolveAsync(User.GetActor(), id, req?.BulkResolveTickets ?? true, ct);
        return problem is null ? NotFound() : Ok(problem);
    }
}
