using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Dashboard;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize(Policy = "AgentOrAdmin")]
public class DashboardController(DashboardService dashboard) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken ct)
        => Ok(await dashboard.GetStatsAsync(User.GetActor(), ct));
}
