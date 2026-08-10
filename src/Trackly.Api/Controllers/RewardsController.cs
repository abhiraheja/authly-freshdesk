using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Dashboard;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

/// <summary>
/// Reward goals, and how agents are doing against them.
///
/// **Agents read, admins configure.** An agent has to see the targets and their own
/// standing — a scoreboard nobody can look at is not a scoreboard — but deciding
/// what counts as good work is a management decision, so writing is admin-only.
///
/// Progress for a *specific* agent is readable by any agent. That is deliberate and
/// unlike mentions or pins: a leaderboard is public by nature, and one that each
/// person could only see their own row of would not be one.
/// </summary>
[ApiController]
[Route("api/rewards")]
[Authorize(Policy = "AgentOrAdmin")]
public class RewardsController(RewardService rewards) : ControllerBase
{
    /// <summary>The goals. `includeInactive` shows retired ones — admin screens only.</summary>
    [HttpGet("goals")]
    public async Task<IActionResult> Goals([FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await rewards.ListGoalsAsync(User.GetActor(), includeInactive, ct));

    [HttpPost("goals")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> CreateGoal(
        [FromBody] SaveRewardGoalRequest request, CancellationToken ct)
        => StatusCode(
            StatusCodes.Status201Created,
            await rewards.CreateGoalAsync(User.GetActor(), request, ct));

    [HttpPut("goals/{goalId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveGoal(
        Guid goalId, [FromBody] SaveRewardGoalRequest request, CancellationToken ct)
        => await rewards.UpdateGoalAsync(User.GetActor(), goalId, request, ct) is { } saved
            ? Ok(saved)
            : NotFound();

    /// <summary>
    /// Deletes a goal nobody has earned. Once it has handed out a badge the answer
    /// is 409 and "retire it instead" — a badge whose goal is gone is a trophy with
    /// the engraving rubbed off.
    /// </summary>
    [HttpDelete("goals/{goalId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> DeleteGoal(Guid goalId, CancellationToken ct)
        => await rewards.DeleteGoalAsync(User.GetActor(), goalId, ct) switch
        {
            AssetDeleteResult.Deleted => NoContent(),
            AssetDeleteResult.NotFound => NotFound(),
            _ => Conflict(new
            {
                error = "Agents have earned this goal. Retire it instead so their badges keep their meaning.",
            }),
        };

    /// <summary>
    /// One agent's standing against every active goal — what they have reached in
    /// the current period, and whether it is banked.
    ///
    /// `agent` takes an id or the literal `me`. Omit it for the bare goal list with
    /// no progress attached, which is what an admin reviewing the configuration
    /// wants.
    /// </summary>
    [HttpGet("progress")]
    public async Task<IActionResult> Progress([FromQuery] string? agent, CancellationToken ct)
    {
        var actor = User.GetActor();
        var agentId = ResolveAgent(agent, actor.UserId);
        return Ok(await rewards.ProgressAsync(actor, agentId, ct));
    }

    /// <summary>Badges already earned, newest first. `agent` omitted means the whole workspace.</summary>
    [HttpGet("awards")]
    public async Task<IActionResult> Awards(
        [FromQuery] string? agent, [FromQuery] int limit, CancellationToken ct)
    {
        var actor = User.GetActor();
        return Ok(await rewards.AwardsAsync(
            actor, ResolveAgent(agent, actor.UserId), limit <= 0 ? 50 : limit, ct));
    }

    /// <summary>
    /// `me` → the caller, a uuid → that agent, anything else → null (everybody).
    ///
    /// `me` exists so a client can build the URL without knowing who is signed in,
    /// and so a shared link keeps meaning "mine" for whoever opens it.
    /// </summary>
    private static Guid? ResolveAgent(string? value, Guid callerId)
    {
        if (string.Equals(value, "me", StringComparison.OrdinalIgnoreCase)) return callerId;
        return Guid.TryParse(value, out var parsed) ? parsed : null;
    }
}
