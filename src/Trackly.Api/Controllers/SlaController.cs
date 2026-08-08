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

/// <summary>
/// Business hours, holidays, and the SLA scorecard.
///
/// Not on <see cref="SlaController"/> because the scorecard is readable by every
/// agent — knowing how you are doing against a target is not a settings question
/// — while the schedule behind it is an admin decision.
/// </summary>
[ApiController]
[Route("api/sla")]
[Authorize(Policy = "AgentOrAdmin")]
public class BusinessHoursController(BusinessHoursService hours) : ControllerBase
{
    public record SaveHoursRequest(bool IsEnabled, string TimeZone, List<BusinessDayDto> Days);

    public record AddHolidayRequest(DateOnly Date, string? Name);

    /// <summary>
    /// Readable by agents: the ticket screen explains a deadline with it, and a
    /// countdown nobody can account for is a countdown nobody trusts.
    /// </summary>
    [HttpGet("hours")]
    public async Task<IActionResult> Hours(CancellationToken ct)
        => Ok(await hours.GetAsync(User.GetWorkspaceId(), ct));

    [HttpPut("hours")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveHours([FromBody] SaveHoursRequest request, CancellationToken ct)
        => Ok(await hours.SaveAsync(
            User.GetActor(), request.IsEnabled, request.TimeZone ?? "UTC", request.Days ?? [], ct));

    [HttpPost("holidays")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> AddHoliday([FromBody] AddHolidayRequest request, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created,
            await hours.AddHolidayAsync(User.GetActor(), request.Date, request.Name, ct));

    [HttpDelete("holidays/{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> RemoveHoliday(Guid id, CancellationToken ct)
        => await hours.RemoveHolidayAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    /// <summary>
    /// How each agent did, over the last <paramref name="days"/> days.
    ///
    /// Counted, never scored — see <see cref="BusinessHoursService.ScorecardAsync"/>
    /// for why Trackly does not invent a points number.
    /// </summary>
    [HttpGet("scorecard")]
    public async Task<IActionResult> Scorecard([FromQuery] int days, CancellationToken ct)
    {
        // Clamped: an unbounded window would scan every ticket the workspace has
        // ever resolved on a screen somebody refreshes.
        var window = Math.Clamp(days <= 0 ? 30 : days, 1, 365);
        return Ok(await hours.ScorecardAsync(User.GetActor(), DateTime.UtcNow.AddDays(-window), ct));
    }
}
