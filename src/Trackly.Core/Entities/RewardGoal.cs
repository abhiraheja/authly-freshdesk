namespace Trackly.Core.Entities;

/// <summary>
/// A target an agent can hit, and what hitting it is worth.
///
/// **The workspace defines these, Trackly does not.** What counts as good work is
/// a management decision that differs between a two-person IT desk and a
/// fifty-agent support floor — "50 tickets a month" is heroic in one and lazy in
/// the other. Shipping a fixed set of badges would mean shipping somebody else's
/// opinion of the team's job.
///
/// Every metric is computed from data Trackly already records for its own reasons
/// (tickets, SLA stamps, CSAT ratings, tasks). Nothing here asks an agent to log
/// anything extra, because a scoreboard that needs feeding is a scoreboard that
/// stops being true within a fortnight.
/// </summary>
public class RewardGoal
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>What the badge is called — "Gold resolver", "Zero misses".</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>One line an agent reads to know how to earn it. Optional.</summary>
    public string? Description { get; set; }

    /// <summary>One of <see cref="RewardMetric"/>.</summary>
    public string Metric { get; set; } = RewardMetric.TicketsResolved;

    /// <summary>
    /// The number to reach. A count for count metrics, a whole percentage (0–100)
    /// for the rate ones — see <see cref="RewardMetric.IsPercentage"/>.
    /// </summary>
    public int Target { get; set; }

    /// <summary>One of <see cref="RewardPeriod"/> — the window the target applies to.</summary>
    public string Period { get; set; } = RewardPeriod.Month;

    /// <summary>
    /// Points banked when it is earned.
    ///
    /// Snapshotted onto the award, so raising a goal's value later does not
    /// retroactively rewrite what somebody was given last quarter.
    /// </summary>
    public int Points { get; set; }

    /// <summary>
    /// One of <see cref="RewardTier"/>. Decides the badge's colour only.
    ///
    /// Deliberately not derived from <see cref="Points"/>: a workspace may run a
    /// single gold award worth 10 points and a bronze worth 50, and a UI that
    /// second-guessed them would be arguing with the person who configured it.
    /// </summary>
    public string Tier { get; set; } = RewardTier.Bronze;

    /// <summary>
    /// The **minimum sample** before the goal can be earned at all.
    ///
    /// Only meaningful for the rate metrics, and it is what stops the scoreboard
    /// being nonsense: an agent who answered one ticket inside SLA has 100%
    /// attainment, and without a floor they would out-rank somebody who held 96%
    /// across two hundred. Zero means no floor.
    /// </summary>
    public int MinimumSample { get; set; }

    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One goal, earned by one agent, for one period.
///
/// **A record, not a cache.** Awards are written once and never recomputed: the
/// numbers behind them keep moving — a ticket gets reopened, a CSAT rating arrives
/// late, an agent is reassigned — and a badge that could be taken away by
/// yesterday's data changing is not something anybody would be pleased to be given.
/// The current period's progress is computed live; a finished period's award is
/// history.
/// </summary>
public class AgentRewardAward
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public Guid GoalId { get; set; }
    public RewardGoal? Goal { get; set; }

    public Guid AgentId { get; set; }
    public User? Agent { get; set; }

    /// <summary>
    /// Which window this is for — <c>2026-08</c>, <c>2026-W32</c>, <c>2026-Q3</c>,
    /// or <c>all</c>.
    ///
    /// A string rather than a date range because it is an **identity**: it is what
    /// the unique index uses to make awarding idempotent, so a worker that ticks
    /// every hour cannot hand out August's gold thirty times.
    /// </summary>
    public string PeriodKey { get; set; } = string.Empty;

    /// <summary>What they actually reached — 61 against a target of 50.</summary>
    public int Value { get; set; }

    /// <summary>The goal's points as they stood when this was earned.</summary>
    public int Points { get; set; }

    public DateTime AwardedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// What a goal can measure.
///
/// Every one of these is already recorded for another reason. That constraint is
/// the point: the moment a metric needs its own bookkeeping, the scoreboard starts
/// disagreeing with the tickets.
/// </summary>
public static class RewardMetric
{
    /// <summary>Tickets the agent was assigned and that reached a terminal status in the window.</summary>
    public const string TicketsResolved = "tickets_resolved";

    /// <summary>Percentage of their measurable tickets that met the first-response deadline.</summary>
    public const string FirstResponseSla = "first_response_sla";

    /// <summary>Percentage that met the resolution deadline.</summary>
    public const string ResolutionSla = "resolution_sla";

    /// <summary>Average CSAT rating, rescaled to 0–100 so every target is a whole number.</summary>
    public const string CsatScore = "csat_score";

    /// <summary>Checklist items the agent ticked off, on any ticket.</summary>
    public const string TasksCompleted = "tasks_completed";

    public static readonly string[] All =
        [TicketsResolved, FirstResponseSla, ResolutionSla, CsatScore, TasksCompleted];

    public static bool IsKnown(string metric) => All.Contains(metric);

    /// <summary>
    /// Whether the target is a percentage rather than a count.
    ///
    /// Decides three things at once: the unit shown beside the target, whether
    /// <see cref="RewardGoal.MinimumSample"/> means anything, and whether a value
    /// above 100 is a data problem.
    /// </summary>
    public static bool IsPercentage(string metric) =>
        metric is FirstResponseSla or ResolutionSla or CsatScore;
}

/// <summary>
/// The window a target applies to.
///
/// Weeks are ISO weeks and months are calendar months in **UTC**. Not the
/// workspace's time zone: an award's period key has to be stable forever, and a
/// workspace that changes time zone would otherwise re-slice every past period and
/// orphan the awards inside them.
/// </summary>
public static class RewardPeriod
{
    public const string Week = "week";
    public const string Month = "month";
    public const string Quarter = "quarter";

    /// <summary>Earned once, ever — a career milestone rather than a recurring target.</summary>
    public const string AllTime = "all_time";

    public static readonly string[] All = [Week, Month, Quarter, AllTime];

    public static bool IsKnown(string period) => All.Contains(period);

    /// <summary>
    /// The identity of the window <paramref name="moment"/> falls in.
    ///
    /// <see cref="AllTime"/> is the constant <c>all</c>, which is exactly what
    /// makes "earned once, ever" fall out of the same unique index as everything
    /// else rather than needing a rule of its own.
    /// </summary>
    public static string KeyFor(string period, DateTime moment) => period switch
    {
        Week => $"{System.Globalization.ISOWeek.GetYear(moment)}-W{System.Globalization.ISOWeek.GetWeekOfYear(moment):00}",
        Month => $"{moment:yyyy-MM}",
        Quarter => $"{moment:yyyy}-Q{(moment.Month - 1) / 3 + 1}",
        _ => "all",
    };

    /// <summary>
    /// When the window containing <paramref name="moment"/> began. Used to bound
    /// the queries that measure progress.
    ///
    /// <see cref="AllTime"/> returns <see cref="DateTime.MinValue"/> — "since the
    /// beginning", which is what the words say.
    /// </summary>
    public static DateTime StartOf(string period, DateTime moment) => period switch
    {
        // ISO weeks start on Monday; DayOfWeek puts Sunday at 0, so Sunday is six
        // days into its week rather than the start of the next one.
        Week => moment.Date.AddDays(-(((int)moment.DayOfWeek + 6) % 7)),
        Month => new DateTime(moment.Year, moment.Month, 1, 0, 0, 0, DateTimeKind.Utc),
        Quarter => new DateTime(moment.Year, (moment.Month - 1) / 3 * 3 + 1, 1, 0, 0, 0, DateTimeKind.Utc),
        _ => DateTime.SpecifyKind(DateTime.MinValue, DateTimeKind.Utc),
    };
}

/// <summary>Badge colour. Names people already understand, so nothing needs a legend.</summary>
public static class RewardTier
{
    public const string Bronze = "bronze";
    public const string Silver = "silver";
    public const string Gold = "gold";

    public static readonly string[] All = [Bronze, Silver, Gold];

    public static bool IsKnown(string tier) => All.Contains(tier);
}
