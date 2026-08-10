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

    /// <summary>
    /// One agent's own figures — what the agent dashboard renders.
    ///
    /// **An agent always gets themselves.** `agent` is honoured for an admin only,
    /// and that check lives here rather than in the service because it is a question
    /// about the caller's role, which is exactly what a controller knows. Without it
    /// this would be a way for any agent to read a colleague's response times and
    /// CSAT by editing a query string.
    /// </summary>
    [HttpGet("me")]
    public async Task<IActionResult> Me(
        [FromQuery] Guid? agent,
        [FromQuery] int days = AnalyticsService.DefaultDays,
        CancellationToken ct = default)
    {
        var actor = User.GetActor();
        var agentId = actor.IsAdmin && agent is { } asked ? asked : actor.UserId;
        return await analytics.GetAgentOverviewAsync(actor, agentId, days, ct) is { } overview
            ? Ok(overview)
            : NotFound();
    }
}
