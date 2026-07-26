using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Canned responses: agent/admin manage and use.
[ApiController]
[Route("api/canned-responses")]
[Authorize(Policy = "AgentOrAdmin")]
public class CannedResponsesController(CannedResponseService canned) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await canned.ListAsync(User.GetActor(), ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SaveCannedResponseRequest req, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created, await canned.CreateAsync(User.GetActor(), req, ct));

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveCannedResponseRequest req, CancellationToken ct)
    {
        var result = await canned.UpdateAsync(User.GetActor(), id, req, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await canned.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();
}
