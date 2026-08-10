using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Dashboard;

public record DailyCount(string Date, int Count);
public record LabeledCount(string Label, int Count);

/// <param name="Resolved">Finished inside the window — the throughput number.</param>
/// <param name="OpenNow">
/// What they are carrying **right now**, which is a different question from what
/// they finished. An agent can be top of the leaderboard and drowning.
/// </param>
/// <param name="OverdueNow">Open tickets of theirs whose resolve deadline has passed.</param>
/// <param name="PendingTasks">Open checklist items assigned to them, on unfinished tickets.</param>
/// <param name="RewardPoints">Banked reward points, all time. Zero when the workspace has no goals.</param>
public record AgentLeaderRow(
    /// <summary>
    /// The whole person, not three loose fields.
    ///
    /// `UserSummaryDto` is what every other list of people in the API returns, and
    /// it is where the avatar URL is built — reassembling name/email/avatar here
    /// would be a second place that has to know how a profile photo is addressed.
    /// </summary>
    UserSummaryDto Agent,
    int Resolved,
    double? AvgFirstResponseMinutes,
    double? AvgResolutionMinutes,
    double? AvgCsat,
    double? FirstResponseSlaAttainment,
    double? ResolutionSlaAttainment,
    int OpenNow,
    int OverdueNow,
    int PendingTasks,
    int RewardPoints,
    int Badges);

/// <param name="Since">
/// When the earliest still-open ticket first reported this service as affected —
/// "down since". The number that turns a red row into an escalation.
/// </param>
public record ServiceTroubleRow(
    Guid ServiceId,
    string Name,
    string? OwnerTeamName,
    string Level,
    int OpenTicketCount,
    DateTime Since);

/// <param name="Label">A bucket of ticket age: `today`, `1-3d`, `4-7d`, `8-30d`, `30d+`.</param>
public record AgingBucket(string Label, int Count);

public record AnalyticsOverview(
    int Days,
    int CreatedInWindow,
    int ResolvedInWindow,
    double? AvgFirstResponseMinutes,
    double? AvgResolutionMinutes,
    double? FirstResponseSlaAttainment,   // 0..1, null when no measurable tickets
    double? ResolutionSlaAttainment,
    double? AvgCsat,                       // 1..5, null when no ratings
    int CsatResponses,
    IReadOnlyList<DailyCount> Volume,      // tickets created per day
    IReadOnlyList<LabeledCount> ByChannel,
    IReadOnlyList<LabeledCount> ByStatus,
    IReadOnlyList<AgentLeaderRow> Leaderboard,

    // ── The state of the desk right now ─────────────────────────────────────
    // Everything above is a trailing window; everything below is this moment.
    // Both belong on one screen because the questions an admin actually has —
    // "are we keeping up?" and "what is on fire?" — are one of each, and making
    // them two screens means nobody puts them side by side.
    /// <summary>Unfinished tickets, whatever the window.</summary>
    int OpenNow,
    int UnassignedNow,
    /// <summary>Open tickets whose resolve deadline has already passed.</summary>
    int OverdueNow,
    /// <summary>Open tickets that have never had a reply.</summary>
    int AwaitingFirstReply,
    /// <summary>Age of the oldest unfinished ticket, in days. Null when nothing is open.</summary>
    int? OldestOpenDays,
    IReadOnlyList<AgingBucket> Aging,
    IReadOnlyList<LabeledCount> ByPriority,
    IReadOnlyList<LabeledCount> ByTeam,
    /// <summary>Services with an open ticket against them, worst and oldest first.</summary>
    IReadOnlyList<ServiceTroubleRow> ServicesInTrouble,
    /// <summary>Open checklist items across the workspace, and how many are late.</summary>
    int OpenTasks,
    int OverdueTasks);

/// <summary>
/// One agent's own dashboard, in one call.
///
/// Deliberately not a slice of <see cref="AnalyticsOverview"/>: that one is
/// admin-only because it carries every colleague's numbers, and an agent needs
/// theirs without being handed anybody else's.
///
/// The window applies to the *achievement* figures — resolved, response times,
/// CSAT. The load figures (<paramref name="OpenNow"/> onward) are this moment
/// regardless of window, because "what is on me" has no useful trailing version.
/// </summary>
public record AgentOverview(
    int Days,
    UserSummaryDto Agent,
    int Resolved,
    double? AvgFirstResponseMinutes,
    double? AvgResolutionMinutes,
    double? FirstResponseSlaAttainment,
    double? ResolutionSlaAttainment,
    double? AvgCsat,
    int CsatResponses,
    int OpenNow,
    int OverdueNow,
    /// <summary>Their open tickets the customer is still waiting on a first reply for.</summary>
    int AwaitingFirstReply,
    int PendingTasks,
    int OverdueTasks,
    int WatchingCount,
    int MentioningMeCount,
    int RewardPoints,
    int Badges,
    IReadOnlyList<DailyCount> ResolvedPerDay,
    /// <summary>Their OPEN tickets by priority — the shape of what they are holding.</summary>
    IReadOnlyList<LabeledCount> ByPriority,
    /// <summary>Standing against every active reward goal, current period.</summary>
    IReadOnlyList<RewardProgressDto> Rewards);

// Workspace analytics over a trailing window, plus the state of the desk right
// now. Metrics are computed from a bounded set of tickets (created or resolved
// within the window) pulled once, so the per-ticket duration maths stays
// provider-agnostic. Workspace-scoped throughout.
public class AnalyticsService(TracklyDbContext db, RewardService rewards)
{
    public const int DefaultDays = 30;
    public const int MaxDays = 365;

    public async Task<AnalyticsOverview> GetOverviewAsync(Actor actor, int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, MaxDays);
        var now = DateTime.UtcNow;
        var from = now.AddDays(-days);
        var ws = actor.WorkspaceId;

        var rows = await db.Tickets
            .Where(t => t.WorkspaceId == ws && (t.CreatedAt >= from || t.ResolvedAt >= from))
            .Select(t => new Row(
                t.CreatedAt, t.FirstResponseAt, t.ResolvedAt,
                t.FirstResponseDueAt, t.ResolveDueAt, t.Status, t.Channel, t.AssigneeId))
            .ToListAsync(ct);

        var surveys = await db.CsatSurveys
            .Where(s => s.WorkspaceId == ws && s.SubmittedAt >= from && s.Rating != null)
            .Select(s => new { Rating = s.Rating!.Value, s.AgentId })
            .ToListAsync(ct);

        // The entities, not a projection: `UserSummaryDto.From` needs the user to
        // build the avatar URL. An agent roster is tens of rows, so this is cheap.
        var agents = await db.Users
            .Where(u => u.WorkspaceId == ws && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin))
            .ToListAsync(ct);

        // ── Right now, not in the window ──────────────────────────────────────
        // Its own query because the window filter above deliberately excludes
        // anything old and still open, which is precisely what "what is on fire"
        // needs. A ticket raised four months ago and never answered is the most
        // important row on this screen and appears in no trailing window.
        var live = await db.Tickets
            .Where(t => t.WorkspaceId == ws
                        && t.StatusCategory != TicketStatusCategory.Resolved
                        && t.StatusCategory != TicketStatusCategory.Closed)
            .Select(t => new LiveRow(
                t.CreatedAt, t.FirstResponseAt, t.ResolveDueAt, t.Priority,
                t.AssigneeId,
                t.Team != null ? t.Team.Name : null))
            .ToListAsync(ct);

        var rewardTotals = await rewards.TotalsAsync(ws, ct);

        var openTasks = await db.TicketTasks
            .Where(t => t.WorkspaceId == ws && t.CompletedAt == null
                        && t.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                        && t.Ticket.StatusCategory != TicketStatusCategory.Closed)
            .Select(t => new { t.AssigneeId, t.DueAt })
            .ToListAsync(ct);

        // Services with something open against them, plus how long it has been
        // that way. Grouped in memory off a small projection: the row count is
        // "impacts on unfinished tickets", which is incident-sized, not table-sized.
        var impacts = await db.TicketImpactedServices
            .Where(x => x.Service!.WorkspaceId == ws
                        && x.Service.IsActive
                        && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                        && x.Ticket.StatusCategory != TicketStatusCategory.Closed)
            .Select(x => new
            {
                x.ServiceId,
                ServiceName = x.Service!.Name,
                OwnerTeamName = x.Service.OwnerTeam != null ? x.Service.OwnerTeam.Name : null,
                x.Level,
                x.AddedAt,
            })
            .ToListAsync(ct);

        var servicesInTrouble = impacts
            .GroupBy(x => new { x.ServiceId, x.ServiceName, x.OwnerTeamName })
            .Select(g => new ServiceTroubleRow(
                g.Key.ServiceId,
                g.Key.ServiceName,
                g.Key.OwnerTeamName,
                // The worst report wins, for the same reason the service board
                // does it that way: four "degraded" and one "down" is down.
                g.OrderBy(x => ImpactRank(x.Level)).First().Level,
                g.Count(),
                // The EARLIEST open report, which is what "since" means. The most
                // recent one would reset the clock every time somebody else
                // reported the same outage.
                g.Min(x => x.AddedAt)))
            .OrderBy(s => ImpactRank(s.Level))
            .ThenBy(s => s.Since)
            .ToList();

        var created = rows.Where(r => r.CreatedAt >= from).ToList();
        var responded = rows.Where(r => r.FirstResponseAt >= from).ToList();
        var resolved = rows.Where(r => r.ResolvedAt >= from).ToList();

        // Volume per day (zero-filled so the chart has a continuous axis).
        var byDay = created
            .GroupBy(r => r.CreatedAt.Date)
            .ToDictionary(g => g.Key, g => g.Count());
        var volume = Enumerable.Range(0, days)
            .Select(i => DateTime.UtcNow.Date.AddDays(-(days - 1 - i)))
            .Select(d => new DailyCount(d.ToString("yyyy-MM-dd"), byDay.GetValueOrDefault(d, 0)))
            .ToList();

        var byChannel = created
            .GroupBy(r => r.Channel)
            .Select(g => new LabeledCount(g.Key, g.Count()))
            .OrderByDescending(x => x.Count)
            .ToList();
        var byStatus = created
            .GroupBy(r => r.Status)
            .Select(g => new LabeledCount(g.Key, g.Count()))
            .OrderByDescending(x => x.Count)
            .ToList();

        var leaderboard = agents
            .Select(a =>
            {
                var mine = rows.Where(r => r.AssigneeId == a.Id).ToList();
                var myResolved = mine.Where(r => r.ResolvedAt >= from).ToList();
                var myResponded = mine.Where(r => r.FirstResponseAt >= from).ToList();
                var myCsat = surveys.Where(s => s.AgentId == a.Id).Select(s => (double)s.Rating).ToList();
                var myLive = live.Where(r => r.AssigneeId == a.Id).ToList();
                var totals = rewardTotals.GetValueOrDefault(a.Id, new AgentRewardTotals(0, 0));
                return new AgentLeaderRow(
                    UserSummaryDto.From(a)!,
                    myResolved.Count,
                    Avg(myResponded.Select(FirstResponseMinutes)),
                    Avg(myResolved.Select(ResolutionMinutes)),
                    myCsat.Count > 0 ? Math.Round(myCsat.Average(), 2) : null,
                    // Per-agent attainment, so a leaderboard sorted by volume does
                    // not quietly reward somebody who resolved fifty tickets late.
                    Attainment(myResponded, r => r.FirstResponseDueAt != null, r => r.FirstResponseAt <= r.FirstResponseDueAt),
                    Attainment(myResolved, r => r.ResolveDueAt != null, r => r.ResolvedAt <= r.ResolveDueAt),
                    myLive.Count,
                    myLive.Count(r => r.ResolveDueAt != null && r.ResolveDueAt < now),
                    openTasks.Count(t => t.AssigneeId == a.Id),
                    totals.Points,
                    totals.Badges);
            })
            // Anybody carrying work stays on the list even with nothing finished:
            // an agent holding eleven open tickets and having resolved none is the
            // row a lead most needs to see, and the old filter hid exactly them.
            .Where(r => r.Resolved > 0 || r.OpenNow > 0 || r.PendingTasks > 0
                        || r.AvgFirstResponseMinutes != null || r.AvgCsat != null)
            .OrderByDescending(r => r.Resolved)
            .ThenByDescending(r => r.AvgCsat ?? 0)
            .ToList();

        return new AnalyticsOverview(
            days,
            created.Count,
            resolved.Count,
            Avg(responded.Select(FirstResponseMinutes)),
            Avg(resolved.Select(ResolutionMinutes)),
            Attainment(responded, r => r.FirstResponseDueAt != null, r => r.FirstResponseAt <= r.FirstResponseDueAt),
            Attainment(resolved, r => r.ResolveDueAt != null, r => r.ResolvedAt <= r.ResolveDueAt),
            surveys.Count > 0 ? Math.Round(surveys.Average(s => (double)s.Rating), 2) : null,
            surveys.Count,
            volume,
            byChannel,
            byStatus,
            leaderboard,
            live.Count,
            live.Count(r => r.AssigneeId == null),
            live.Count(r => r.ResolveDueAt != null && r.ResolveDueAt < now),
            live.Count(r => r.FirstResponseAt == null),
            live.Count > 0 ? (int)Math.Floor((now - live.Min(r => r.CreatedAt)).TotalDays) : null,
            Aging(live, now),
            live.GroupBy(r => r.Priority)
                .Select(g => new LabeledCount(g.Key, g.Count()))
                .OrderByDescending(x => x.Count)
                .ToList(),
            // Null team is a real bucket — "not routed anywhere" is the answer that
            // most needs acting on, and dropping it would hide it.
            live.GroupBy(r => r.TeamName ?? "")
                .Select(g => new LabeledCount(g.Key, g.Count()))
                .OrderByDescending(x => x.Count)
                .ToList(),
            servicesInTrouble,
            openTasks.Count,
            openTasks.Count(t => t.DueAt != null && t.DueAt < now));
    }

    /// <summary>
    /// One agent's own numbers — what the agent dashboard renders.
    ///
    /// **Separate from <see cref="GetOverviewAsync"/> because the permission is
    /// different.** The workspace overview is admin-only: it carries every
    /// colleague's response times and CSAT, which is management information. An
    /// agent still needs their own figures, and this is the shape that gives them
    /// those without handing them anybody else's.
    ///
    /// An admin may ask for a specific agent; an agent always gets themselves. The
    /// caller decides that, because the caller is the one holding the role — see
    /// <c>DashboardController</c>.
    /// </summary>
    public async Task<AgentOverview?> GetAgentOverviewAsync(
        Actor actor, Guid agentId, int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, MaxDays);
        var now = DateTime.UtcNow;
        var from = now.AddDays(-days);
        var ws = actor.WorkspaceId;

        var agent = await db.Users.SingleOrDefaultAsync(
            u => u.Id == agentId && u.WorkspaceId == ws, ct);
        if (agent is null) return null;

        var mine = await db.Tickets
            .Where(t => t.WorkspaceId == ws && t.AssigneeId == agentId)
            .Select(t => new MineRow(
                t.CreatedAt, t.FirstResponseAt, t.ResolvedAt,
                t.FirstResponseDueAt, t.ResolveDueAt, t.Priority, t.StatusCategory))
            .ToListAsync(ct);

        var resolved = mine.Where(t => t.ResolvedAt >= from).ToList();
        var responded = mine.Where(t => t.FirstResponseAt >= from).ToList();
        var live = mine
            .Where(t => t.StatusCategory != TicketStatusCategory.Resolved
                        && t.StatusCategory != TicketStatusCategory.Closed)
            .ToList();

        var ratings = await db.CsatSurveys
            .Where(s => s.WorkspaceId == ws && s.AgentId == agentId
                        && s.Rating != null && s.SubmittedAt >= from)
            .Select(s => s.Rating!.Value)
            .ToListAsync(ct);

        var tasks = await db.TicketTasks
            .Where(t => t.WorkspaceId == ws && t.AssigneeId == agentId && t.CompletedAt == null
                        && t.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                        && t.Ticket.StatusCategory != TicketStatusCategory.Closed)
            .Select(t => t.DueAt)
            .ToListAsync(ct);

        // Resolved per day, zero-filled so the sparkline has a continuous axis and
        // a quiet Tuesday reads as a gap rather than as missing data.
        var byDay = resolved
            .GroupBy(t => t.ResolvedAt!.Value.Date)
            .ToDictionary(g => g.Key, g => g.Count());
        var resolvedPerDay = Enumerable.Range(0, days)
            .Select(i => now.Date.AddDays(-(days - 1 - i)))
            .Select(d => new DailyCount(d.ToString("yyyy-MM-dd"), byDay.GetValueOrDefault(d, 0)))
            .ToList();

        var totals = (await rewards.TotalsAsync(ws, ct))
            .GetValueOrDefault(agentId, new AgentRewardTotals(0, 0));

        return new AgentOverview(
            days,
            UserSummaryDto.From(agent)!,
            resolved.Count,
            Avg(responded.Select(r => (r.FirstResponseAt!.Value - r.CreatedAt).TotalMinutes)),
            Avg(resolved.Select(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalMinutes)),
            MineAttainment(responded, r => r.FirstResponseDueAt != null, r => r.FirstResponseAt <= r.FirstResponseDueAt),
            MineAttainment(resolved, r => r.ResolveDueAt != null, r => r.ResolvedAt <= r.ResolveDueAt),
            ratings.Count > 0 ? Math.Round(ratings.Average(), 2) : null,
            ratings.Count,
            live.Count,
            live.Count(r => r.ResolveDueAt != null && r.ResolveDueAt < now),
            live.Count(r => r.FirstResponseAt == null),
            tasks.Count,
            tasks.Count(due => due != null && due < now),
            await db.Tickets.CountAsync(t =>
                t.WorkspaceId == ws && t.Watchers.Any(w => w.AgentId == agentId), ct),
            await db.Tickets.CountAsync(t =>
                t.WorkspaceId == ws
                && db.CommentMentions.Any(m => m.TicketId == t.Id && m.UserId == agentId), ct),
            totals.Points,
            totals.Badges,
            resolvedPerDay,
            live.GroupBy(r => r.Priority)
                .Select(g => new LabeledCount(g.Key, g.Count()))
                .OrderByDescending(x => x.Count)
                .ToList(),
            await rewards.ProgressAsync(actor, agentId, ct));
    }

    private sealed record Row(
        DateTime CreatedAt, DateTime? FirstResponseAt, DateTime? ResolvedAt,
        DateTime? FirstResponseDueAt, DateTime? ResolveDueAt, string Status, string Channel, Guid? AssigneeId);

    /// <summary>One of the caller's own tickets, at whatever age.</summary>
    private sealed record MineRow(
        DateTime CreatedAt, DateTime? FirstResponseAt, DateTime? ResolvedAt,
        DateTime? FirstResponseDueAt, DateTime? ResolveDueAt, string Priority, string StatusCategory);

    /// <summary>The same rule as <see cref="Attainment"/>, over the per-agent row shape.</summary>
    private static double? MineAttainment(
        IReadOnlyList<MineRow> rows, Func<MineRow, bool> hasDue, Func<MineRow, bool> met)
    {
        var measurable = rows.Where(hasDue).ToList();
        return measurable.Count > 0 ? Math.Round((double)measurable.Count(met) / measurable.Count, 3) : null;
    }

    /// <summary>An unfinished ticket, as the "right now" half of the screen needs it.</summary>
    private sealed record LiveRow(
        DateTime CreatedAt, DateTime? FirstResponseAt, DateTime? ResolveDueAt,
        string Priority, Guid? AssigneeId, string? TeamName);

    /// <summary>Worst first. Matches the service board so the two never disagree.</summary>
    private static int ImpactRank(string level) => level switch
    {
        ServiceImpactLevel.Down => 0,
        ServiceImpactLevel.Degraded => 1,
        _ => 2,
    };

    /// <summary>
    /// How long the open queue has been waiting, in buckets.
    ///
    /// Buckets rather than an average age, because an average hides the tail and the
    /// tail is the problem: twenty tickets from this morning and one from March
    /// average out to something reassuring, and the one from March is the only row
    /// anybody needs to know about. Always all five, zeroes included, so the shape
    /// of the chart is comparable between days.
    /// </summary>
    private static IReadOnlyList<AgingBucket> Aging(IReadOnlyList<LiveRow> live, DateTime now)
    {
        var buckets = new[] { "today", "1-3d", "4-7d", "8-30d", "30d+" };
        var counts = buckets.ToDictionary(b => b, _ => 0);
        foreach (var row in live)
        {
            var age = (now - row.CreatedAt).TotalDays;
            var key = age < 1 ? "today" : age < 4 ? "1-3d" : age < 8 ? "4-7d" : age < 31 ? "8-30d" : "30d+";
            counts[key]++;
        }
        return buckets.Select(b => new AgingBucket(b, counts[b])).ToList();
    }

    private static double FirstResponseMinutes(Row r) => (r.FirstResponseAt!.Value - r.CreatedAt).TotalMinutes;
    private static double ResolutionMinutes(Row r) => (r.ResolvedAt!.Value - r.CreatedAt).TotalMinutes;

    private static double? Avg(IEnumerable<double> values)
    {
        var list = values.ToList();
        return list.Count > 0 ? Math.Round(list.Average(), 1) : null;
    }

    // Fraction of tickets that had a due date and met it. Null when none had one.
    private static double? Attainment(IReadOnlyList<Row> rows, Func<Row, bool> hasDue, Func<Row, bool> met)
    {
        var measurable = rows.Where(hasDue).ToList();
        return measurable.Count > 0 ? Math.Round((double)measurable.Count(met) / measurable.Count, 3) : null;
    }
}
