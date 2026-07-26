using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Admin-only SLA policy configuration (one target per priority).
[ApiController]
[Route("api/admin/sla")]
[Authorize(Policy = "Admin")]
public class SlaController(SlaService sla) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await sla.ListAsync(User.GetActor(), ct));

    [HttpPut]
    public async Task<IActionResult> Upsert([FromBody] SlaPolicyDto dto, CancellationToken ct)
        => Ok(await sla.UpsertAsync(User.GetActor(), dto, ct));

    [HttpDelete("{priority}")]
    public async Task<IActionResult> Delete(string priority, CancellationToken ct)
        => await sla.DeleteAsync(User.GetActor(), priority, ct) ? NoContent() : NotFound();
}
