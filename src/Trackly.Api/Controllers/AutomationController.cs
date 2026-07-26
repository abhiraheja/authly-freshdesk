using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Admin-only automation rules.
[ApiController]
[Route("api/automation-rules")]
[Authorize(Policy = "Admin")]
public class AutomationController(AutomationService automation) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await automation.ListAsync(User.GetActor(), ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SaveAutomationRuleRequest req, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created, await automation.CreateAsync(User.GetActor(), req, ct));

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveAutomationRuleRequest req, CancellationToken ct)
    {
        var result = await automation.UpdateAsync(User.GetActor(), id, req, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await automation.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();
}
