using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Dashboard;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize(Policy = "AgentOrAdmin")]
public class DashboardController(DashboardService dashboard, AnalyticsService analytics) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken ct)
        => Ok(await dashboard.GetStatsAsync(User.GetActor(), ct));

    // Trailing-window analytics (default 30 days). Admin-only — it aggregates
    // across the whole workspace, including per-agent performance.
    [HttpGet("analytics")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Analytics([FromQuery] int days = AnalyticsService.DefaultDays, CancellationToken ct = default)
        => Ok(await analytics.GetOverviewAsync(User.GetActor(), days, ct));
}
