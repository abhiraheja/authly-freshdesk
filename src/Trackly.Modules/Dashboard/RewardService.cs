using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Dashboard;

/// <summary>
/// The workspace's reward goals, each agent's progress toward them, and the awards
/// already banked.
///
/// **Progress is computed, awards are recorded.** The current period's numbers are
/// measured live on every read, so an agent watching their own dashboard sees the
/// counter move. Once a target is met the award is *written*, and it is never
/// recomputed after that: the data underneath keeps shifting — a ticket gets
/// reopened, a CSAT rating arrives a week late, an agent is reassigned — and a
/// badge that yesterday's data could take away is not something anybody would be
/// glad to be given.
///
/// **Every metric is measured from data Trackly already keeps.** That constraint is
/// deliberate: the moment a scoreboard needs its own bookkeeping it starts
/// disagreeing with the tickets, and then nobody trusts either.
/// </summary>
public class RewardService(TracklyDbContext db)
{
    /// <summary>
    /// Agents measured per sweep. Bounded because the sweep loads each agent's
    /// tickets to do duration and attainment maths in memory; a workspace with more
    /// agents than this has outgrown a per-tick full recompute and wants a queue.
    /// </summary>
    private const int MaxAgentsPerSweep = 200;

    // ---- Goals (admin) --------------------------------------------------------

    public async Task<IReadOnlyList<RewardGoalDto>> ListGoalsAsync(
        Actor actor, bool includeInactive, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var query = db.RewardGoals.Where(g => g.WorkspaceId == actor.WorkspaceId);
        if (!includeInactive) query = query.Where(g => g.IsActive);

        var goals = await query
            .OrderBy(g => g.SortOrder).ThenBy(g => g.Name)
            .Select(g => new
            {
                g.Id, g.Name, g.Description, g.Metric, g.Target, g.Period,
                g.Points, g.Tier, g.MinimumSample, g.IsActive, g.SortOrder,
                Awarded = db.AgentRewardAwards.Count(a => a.GoalId == g.Id),
            })
            .ToListAsync(ct);

        return goals
            .Select(g => new RewardGoalDto(
                g.Id, g.Name, g.Description, g.Metric, g.Target, g.Period,
                g.Points, g.Tier, g.MinimumSample, g.IsActive, g.SortOrder, g.Awarded))
            .ToList();
    }

    public async Task<RewardGoalDto> CreateGoalAsync(
        Actor actor, SaveRewardGoalRequest request, CancellationToken ct)
    {
        RequireAdmin(actor);
        var name = Clean(request.Name, 120) ?? throw new ArgumentException("A goal needs a name.");
        Validate(request);

        var next = await db.RewardGoals
            .Where(g => g.WorkspaceId == actor.WorkspaceId)
            .Select(g => (int?)g.SortOrder).MaxAsync(ct) ?? -1;

        var goal = new RewardGoal
        {
            WorkspaceId = actor.WorkspaceId,
            Name = name,
            Description = Clean(request.Description, 500),
            Metric = request.Metric!,
            Target = request.Target!.Value,
            Period = request.Period!,
            Points = request.Points ?? 0,
            Tier = request.Tier ?? RewardTier.Bronze,
            MinimumSample = Math.Max(0, request.MinimumSample ?? 0),
            SortOrder = next + 1,
        };
        db.RewardGoals.Add(goal);
        await db.SaveChangesAsync(ct);
        return Shape(goal, 0);
    }

    public async Task<RewardGoalDto?> UpdateGoalAsync(
        Actor actor, Guid id, SaveRewardGoalRequest request, CancellationToken ct)
    {
        RequireAdmin(actor);
        var goal = await db.RewardGoals.SingleOrDefaultAsync(
            g => g.Id == id && g.WorkspaceId == actor.WorkspaceId, ct);
        if (goal is null) return null;

        // Validated only for the fields actually being changed, so a request that
        // only flips IsActive is not made to re-send a metric and a target.
        Validate(request, partial: true);

        if (Clean(request.Name, 120) is { } name) goal.Name = name;
        if (request.Description is not null) goal.Description = Clean(request.Description, 500);
        if (request.Metric is not null) goal.Metric = request.Metric;
        if (request.Target is not null) goal.Target = request.Target.Value;
        if (request.Period is not null) goal.Period = request.Period;
        if (request.Points is not null) goal.Points = request.Points.Value;
        if (request.Tier is not null) goal.Tier = request.Tier;
        if (request.MinimumSample is not null) goal.MinimumSample = Math.Max(0, request.MinimumSample.Value);
        if (request.SortOrder is not null) goal.SortOrder = request.SortOrder.Value;
        if (request.IsActive is not null) goal.IsActive = request.IsActive.Value;
        goal.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        var awarded = await db.AgentRewardAwards.CountAsync(a => a.GoalId == id, ct);
        return Shape(goal, awarded);
    }

    /// <summary>
    /// Deletes a goal, and with it the badges it handed out.
    ///
    /// Refuses once anything has been awarded, and says to retire instead. A badge
    /// whose goal is gone is a trophy with the engraving rubbed off — nobody can
    /// look up what it was for, which makes it worse than not having it.
    /// </summary>
    public async Task<AssetDeleteResult> DeleteGoalAsync(Actor actor, Guid id, CancellationToken ct)
    {
        RequireAdmin(actor);
        var goal = await db.RewardGoals.SingleOrDefaultAsync(
            g => g.Id == id && g.WorkspaceId == actor.WorkspaceId, ct);
        if (goal is null) return AssetDeleteResult.NotFound;
        if (await db.AgentRewardAwards.AnyAsync(a => a.GoalId == id, ct)) return AssetDeleteResult.InUse;

        db.RewardGoals.Remove(goal);
        await db.SaveChangesAsync(ct);
        return AssetDeleteResult.Deleted;
    }

    // ---- Progress and awards (read) -------------------------------------------

    /// <summary>
    /// Every active goal with one agent's standing against it: what they have
    /// reached in the current period, and whether it is already banked.
    ///
    /// <paramref name="agentId"/> null returns the goals with no progress attached —
    /// which is what an admin configuring them wants to see.
    /// </summary>
    public async Task<IReadOnlyList<RewardProgressDto>> ProgressAsync(
        Actor actor, Guid? agentId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var goals = await db.RewardGoals
            .Where(g => g.WorkspaceId == actor.WorkspaceId && g.IsActive)
            .OrderBy(g => g.SortOrder).ThenBy(g => g.Name)
            .ToListAsync(ct);
        if (goals.Count == 0 || agentId is null)
            return goals.Select(g => new RewardProgressDto(Shape(g, 0), 0, false, null)).ToList();

        var now = DateTime.UtcNow;
        // One measurement per distinct period, not per goal: five monthly goals
        // read the same month's tickets, and measuring each separately would load
        // them five times.
        var samples = new Dictionary<string, AgentSample>();
        foreach (var period in goals.Select(g => g.Period).Distinct())
            samples[period] = await MeasureAsync(
                actor.WorkspaceId, agentId.Value, RewardPeriod.StartOf(period, now), ct);

        var earned = await db.AgentRewardAwards
            .Where(a => a.AgentId == agentId && a.WorkspaceId == actor.WorkspaceId)
            .Select(a => new { a.GoalId, a.PeriodKey, a.AwardedAt })
            .ToListAsync(ct);

        return goals.Select(goal =>
        {
            var key = RewardPeriod.KeyFor(goal.Period, now);
            var award = earned.FirstOrDefault(a => a.GoalId == goal.Id && a.PeriodKey == key);
            var value = ValueOf(goal, samples[goal.Period]);
            return new RewardProgressDto(
                Shape(goal, 0), value ?? 0, award is not null, award?.AwardedAt);
        }).ToList();
    }

    /// <summary>Badges an agent holds, newest first.</summary>
    public async Task<IReadOnlyList<RewardAwardDto>> AwardsAsync(
        Actor actor, Guid? agentId, int limit, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var query = db.AgentRewardAwards.Where(a => a.WorkspaceId == actor.WorkspaceId);
        if (agentId is { } who) query = query.Where(a => a.AgentId == who);

        return await query
            .OrderByDescending(a => a.AwardedAt)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(a => new RewardAwardDto(
                a.Id,
                a.GoalId,
                a.Goal!.Name,
                a.Goal.Tier,
                a.Goal.Metric,
                a.Goal.Target,
                UserSummaryDto.From(a.Agent)!,
                a.PeriodKey,
                a.Value,
                a.Points,
                a.AwardedAt))
            .ToListAsync(ct);
    }

    /// <summary>Points banked per agent, all time — the leaderboard column.</summary>
    public async Task<Dictionary<Guid, AgentRewardTotals>> TotalsAsync(
        Guid workspaceId, CancellationToken ct)
    {
        var rows = await db.AgentRewardAwards
            .Where(a => a.WorkspaceId == workspaceId)
            .GroupBy(a => a.AgentId)
            .Select(g => new { AgentId = g.Key, Points = g.Sum(a => a.Points), Badges = g.Count() })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.AgentId, r => new AgentRewardTotals(r.Points, r.Badges));
    }

    // ---- Awarding (the worker) ------------------------------------------------

    /// <summary>
    /// Measures every agent against every active goal for the period they are
    /// currently in, and writes an award for each target that has been reached.
    ///
    /// Safe to run as often as you like, and safe to miss: the unique index on
    /// (goal, agent, period) makes a repeat a no-op, and a missed tick is picked up
    /// by the next one because the same period is still being measured.
    ///
    /// **The last tick of a period is not special.** An award is written the moment
    /// the target is met, not when the month ends — so an agent who hits 50 on the
    /// 12th gets the badge on the 12th, which is the only version of this that
    /// feels like anything.
    /// </summary>
    public async Task<int> SweepAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var written = 0;

        var workspaces = await db.RewardGoals
            .Where(g => g.IsActive)
            .Select(g => g.WorkspaceId)
            .Distinct()
            .ToListAsync(ct);

        foreach (var workspaceId in workspaces)
        {
            var goals = await db.RewardGoals
                .Where(g => g.WorkspaceId == workspaceId && g.IsActive)
                .ToListAsync(ct);

            var agents = await db.Users
                .Where(u => u.WorkspaceId == workspaceId && u.IsActive
                            && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin))
                .Select(u => u.Id)
                .Take(MaxAgentsPerSweep)
                .ToListAsync(ct);

            // Read once for the whole workspace rather than per (agent, goal): the
            // set is small and the alternative is a query per pair.
            var existing = (await db.AgentRewardAwards
                    .Where(a => a.WorkspaceId == workspaceId)
                    .Select(a => new { a.GoalId, a.AgentId, a.PeriodKey })
                    .ToListAsync(ct))
                .Select(a => (a.GoalId, a.AgentId, a.PeriodKey))
                .ToHashSet();

            foreach (var agentId in agents)
            {
                var samples = new Dictionary<string, AgentSample>();
                foreach (var period in goals.Select(g => g.Period).Distinct())
                    samples[period] = await MeasureAsync(
                        workspaceId, agentId, RewardPeriod.StartOf(period, now), ct);

                foreach (var goal in goals)
                {
                    var key = RewardPeriod.KeyFor(goal.Period, now);
                    if (existing.Contains((goal.Id, agentId, key))) continue;

                    var value = ValueOf(goal, samples[goal.Period]);
                    if (value is null || value < goal.Target) continue;

                    db.AgentRewardAwards.Add(new AgentRewardAward
                    {
                        WorkspaceId = workspaceId,
                        GoalId = goal.Id,
                        AgentId = agentId,
                        PeriodKey = key,
                        Value = value.Value,
                        // Snapshotted, so raising a goal's value later does not
                        // retroactively rewrite what somebody was given.
                        Points = goal.Points,
                    });
                    existing.Add((goal.Id, agentId, key));
                    written++;
                }
            }
        }

        if (written > 0) await db.SaveChangesAsync(ct);
        return written;
    }

    // ---- Measuring ------------------------------------------------------------

    /// <summary>
    /// One agent's raw numbers since <paramref name="from"/>.
    ///
    /// Pulled to memory and reduced here rather than aggregated in SQL, for the same
    /// reason <see cref="AnalyticsService"/> does it: the duration and attainment
    /// maths is per-ticket and stays provider-agnostic this way.
    /// </summary>
    private async Task<AgentSample> MeasureAsync(
        Guid workspaceId, Guid agentId, DateTime from, CancellationToken ct)
    {
        var tickets = await db.Tickets
            .Where(t => t.WorkspaceId == workspaceId && t.AssigneeId == agentId
                        && (t.ResolvedAt >= from || t.FirstResponseAt >= from))
            .Select(t => new
            {
                t.CreatedAt, t.FirstResponseAt, t.ResolvedAt,
                t.FirstResponseDueAt, t.ResolveDueAt,
            })
            .ToListAsync(ct);

        var resolved = tickets.Count(t => t.ResolvedAt >= from);

        var responded = tickets.Where(t => t.FirstResponseAt >= from && t.FirstResponseDueAt != null).ToList();
        var closed = tickets.Where(t => t.ResolvedAt >= from && t.ResolveDueAt != null).ToList();

        var ratings = await db.CsatSurveys
            .Where(s => s.WorkspaceId == workspaceId && s.AgentId == agentId
                        && s.Rating != null && s.SubmittedAt >= from)
            .Select(s => s.Rating!.Value)
            .ToListAsync(ct);

        var tasksDone = await db.TicketTasks
            .CountAsync(t => t.WorkspaceId == workspaceId
                             && t.CompletedById == agentId
                             && t.CompletedAt >= from, ct);

        return new AgentSample(
            resolved,
            responded.Count,
            responded.Count(t => t.FirstResponseAt <= t.FirstResponseDueAt),
            closed.Count,
            closed.Count(t => t.ResolvedAt <= t.ResolveDueAt),
            ratings.Count,
            ratings.Count > 0 ? ratings.Average() : null,
            tasksDone);
    }

    /// <summary>
    /// The agent's figure for one goal's metric, or null when it cannot honestly be
    /// stated yet.
    ///
    /// Null rather than zero for the rate metrics below their minimum sample, and
    /// the distinction carries weight: zero would read as "failing", when the truth
    /// is "not enough has happened to say". An agent who answered one ticket inside
    /// SLA is not on 100%.
    /// </summary>
    private static int? ValueOf(RewardGoal goal, AgentSample sample) => goal.Metric switch
    {
        RewardMetric.TicketsResolved => sample.Resolved,
        RewardMetric.TasksCompleted => sample.TasksCompleted,
        RewardMetric.FirstResponseSla => Rate(sample.FirstResponseMet, sample.FirstResponseMeasurable, goal.MinimumSample),
        RewardMetric.ResolutionSla => Rate(sample.ResolutionMet, sample.ResolutionMeasurable, goal.MinimumSample),
        // Rescaled from 1–5 to 0–100 so every target in the UI is a whole number
        // and the same "percentage" affordance covers all three rate metrics.
        RewardMetric.CsatScore => sample.CsatResponses >= Math.Max(1, goal.MinimumSample) && sample.CsatAverage is { } avg
            ? (int)Math.Round(avg / 5d * 100d)
            : null,
        _ => null,
    };

    private static int? Rate(int met, int measurable, int minimumSample)
    {
        if (measurable == 0 || measurable < minimumSample) return null;
        return (int)Math.Round((double)met / measurable * 100d);
    }

    private sealed record AgentSample(
        int Resolved,
        int FirstResponseMeasurable,
        int FirstResponseMet,
        int ResolutionMeasurable,
        int ResolutionMet,
        int CsatResponses,
        double? CsatAverage,
        int TasksCompleted);

    // ---- Helpers --------------------------------------------------------------

    private static void RequireAdmin(Actor actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();
    }

    /// <param name="partial">
    /// True for an update, where a null field means "leave it alone" rather than
    /// "it was not supplied".
    /// </param>
    private static void Validate(SaveRewardGoalRequest request, bool partial = false)
    {
        if (request.Metric is { } metric && !RewardMetric.IsKnown(metric))
            throw new ArgumentException("Unknown metric.");
        if (request.Period is { } period && !RewardPeriod.IsKnown(period))
            throw new ArgumentException("Unknown period.");
        if (request.Tier is { } tier && !RewardTier.IsKnown(tier))
            throw new ArgumentException("Unknown tier.");

        if (!partial)
        {
            if (request.Metric is null) throw new ArgumentException("A goal needs a metric.");
            if (request.Period is null) throw new ArgumentException("A goal needs a period.");
            if (request.Target is null) throw new ArgumentException("A goal needs a target.");
        }

        if (request.Target is { } target)
        {
            if (target < 1) throw new ArgumentException("A target has to be at least 1.");
            // A percentage target above 100 can never be met, so the goal would sit
            // in the list looking real and awarding nothing.
            var metricForTarget = request.Metric ?? RewardMetric.TicketsResolved;
            if (RewardMetric.IsPercentage(metricForTarget) && target > 100)
                throw new ArgumentException("A percentage target cannot be above 100.");
        }

        if (request.Points is { } points and < 0)
            throw new ArgumentException("Points cannot be negative.");
    }

    private static RewardGoalDto Shape(RewardGoal g, int awarded) =>
        new(g.Id, g.Name, g.Description, g.Metric, g.Target, g.Period,
            g.Points, g.Tier, g.MinimumSample, g.IsActive, g.SortOrder, awarded);

    private static string? Clean(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}

/// <param name="AwardedCount">How many badges this goal has handed out — what makes delete refuse.</param>
public record RewardGoalDto(
    Guid Id,
    string Name,
    string? Description,
    string Metric,
    int Target,
    string Period,
    int Points,
    string Tier,
    int MinimumSample,
    bool IsActive,
    int SortOrder,
    int AwardedCount);

/// <param name="Value">What the agent has reached in the CURRENT period.</param>
/// <param name="Earned">True once this period's award is banked.</param>
public record RewardProgressDto(
    RewardGoalDto Goal,
    int Value,
    bool Earned,
    DateTime? EarnedAt);

public record RewardAwardDto(
    Guid Id,
    Guid GoalId,
    string GoalName,
    string Tier,
    string Metric,
    int Target,
    UserSummaryDto Agent,
    string PeriodKey,
    int Value,
    int Points,
    DateTime AwardedAt);

public record AgentRewardTotals(int Points, int Badges);

/// <summary>
/// Every field optional so one shape serves create and update. Create rejects the
/// missing ones; update reads null as "leave it alone".
/// </summary>
public record SaveRewardGoalRequest(
    string? Name,
    string? Description,
    string? Metric,
    int? Target,
    string? Period,
    int? Points,
    string? Tier,
    int? MinimumSample,
    int? SortOrder,
    bool? IsActive);
