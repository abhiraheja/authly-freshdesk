using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Dashboard;

public record DailyCount(string Date, int Count);
public record LabeledCount(string Label, int Count);

public record AgentLeaderRow(
    Guid AgentId,
    string Name,
    int Resolved,
    double? AvgFirstResponseMinutes,
    double? AvgResolutionMinutes,
    double? AvgCsat);

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
    IReadOnlyList<AgentLeaderRow> Leaderboard);

// Workspace analytics over a trailing window. Metrics are computed from a bounded
// set of tickets (created or resolved within the window) pulled once, so the
// per-ticket duration maths stays provider-agnostic. Workspace-scoped throughout.
public class AnalyticsService(TracklyDbContext db)
{
    public const int DefaultDays = 30;
    public const int MaxDays = 365;

    public async Task<AnalyticsOverview> GetOverviewAsync(Actor actor, int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, MaxDays);
        var from = DateTime.UtcNow.AddDays(-days);
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

        var agents = await db.Users
            .Where(u => u.WorkspaceId == ws && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin))
            .Select(u => new { u.Id, u.Name, u.Email })
            .ToListAsync(ct);

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
                return new AgentLeaderRow(
                    a.Id,
                    a.Name ?? a.Email ?? "Agent",
                    myResolved.Count,
                    Avg(myResponded.Select(FirstResponseMinutes)),
                    Avg(myResolved.Select(ResolutionMinutes)),
                    myCsat.Count > 0 ? myCsat.Average() : null);
            })
            .Where(r => r.Resolved > 0 || r.AvgFirstResponseMinutes != null || r.AvgCsat != null)
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
            surveys.Count > 0 ? surveys.Average(s => (double)s.Rating) : null,
            surveys.Count,
            volume,
            byChannel,
            byStatus,
            leaderboard);
    }

    private sealed record Row(
        DateTime CreatedAt, DateTime? FirstResponseAt, DateTime? ResolvedAt,
        DateTime? FirstResponseDueAt, DateTime? ResolveDueAt, string Status, string Channel, Guid? AssigneeId);

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
