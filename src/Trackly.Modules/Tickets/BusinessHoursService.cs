using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// The workspace's open hours, and the agent SLA scorecard built on top of them.
///
/// Together because they are the same subject from two ends: the schedule is
/// what makes an SLA number a promise the team can keep, and the scorecard is
/// how well they kept it.
/// </summary>
public class BusinessHoursService(TracklyDbContext db)
{
    /// <summary>
    /// The schedule. Never null — a workspace that has never opened this screen
    /// gets the off, 24/7 answer rather than a 404 the client has to special-case.
    /// </summary>
    public async Task<BusinessHoursDto> GetAsync(Guid workspaceId, CancellationToken ct)
    {
        var hours = await db.BusinessHours
            .Include(h => h.Days)
            .Include(h => h.Holidays)
            .SingleOrDefaultAsync(h => h.WorkspaceId == workspaceId, ct);

        if (hours is null) return new BusinessHoursDto(false, "UTC", [], []);

        return new BusinessHoursDto(
            hours.IsEnabled,
            hours.TimeZone,
            hours.Days.OrderBy(d => d.DayOfWeek).ThenBy(d => d.StartMinute)
                .Select(d => new BusinessDayDto(d.DayOfWeek, d.StartMinute, d.EndMinute)).ToList(),
            hours.Holidays.OrderBy(h => h.Date)
                .Select(h => new BusinessHolidayDto(h.Id, h.Date, h.Name)).ToList());
    }

    /// <summary>
    /// Replaces the whole schedule.
    ///
    /// One call, one transaction. A screen that edits seven days at once and
    /// sends diffs would put "what changed" in the client, which is how a
    /// workspace ends up half-open on a Wednesday.
    /// </summary>
    public async Task<BusinessHoursDto> SaveAsync(
        Actor actor, bool isEnabled, string timeZone,
        IReadOnlyList<BusinessDayDto> days, CancellationToken ct)
    {
        RequireAdmin(actor);

        // Validated here rather than trusted: a zone the host cannot resolve
        // would silently fall back to UTC inside the calculator, and every
        // deadline in the workspace would be wrong by hours with nothing on
        // screen to explain it.
        if (!IsKnownTimeZone(timeZone))
            throw new ArgumentException($"\"{timeZone}\" is not a time zone this server knows.");

        var hours = await db.BusinessHours
            .Include(h => h.Days)
            .SingleOrDefaultAsync(h => h.WorkspaceId == actor.WorkspaceId, ct);

        if (hours is null)
        {
            hours = new BusinessHours { WorkspaceId = actor.WorkspaceId };
            db.BusinessHours.Add(hours);
        }

        hours.IsEnabled = isEnabled;
        hours.TimeZone = timeZone;

        // Removed through the tracker, not ExecuteDelete: that commits its own
        // transaction, so a failure while inserting the replacements would leave
        // the workspace with no open days at all — which the calculator reads as
        // "always open" and quietly undoes the whole feature.
        db.BusinessHourDays.RemoveRange(hours.Days);

        foreach (var day in days)
        {
            if (day.DayOfWeek is < 0 or > 6) continue;
            var start = Math.Clamp(day.StartMinute, 0, 1440);
            var end = Math.Clamp(day.EndMinute, 0, 1440);
            // A closed day is the ABSENCE of a window, so an empty or backwards
            // one is simply not stored — no second flag that can disagree.
            if (end <= start) continue;

            db.BusinessHourDays.Add(new BusinessHourDay
            {
                WorkspaceId = actor.WorkspaceId,
                DayOfWeek = day.DayOfWeek,
                StartMinute = start,
                EndMinute = end,
            });
        }

        await db.SaveChangesAsync(ct);
        return await GetAsync(actor.WorkspaceId, ct);
    }

    public async Task<BusinessHolidayDto> AddHolidayAsync(
        Actor actor, DateOnly date, string? name, CancellationToken ct)
    {
        RequireAdmin(actor);

        // The schedule row has to exist first — the holiday hangs off it.
        if (!await db.BusinessHours.AnyAsync(h => h.WorkspaceId == actor.WorkspaceId, ct))
        {
            db.BusinessHours.Add(new BusinessHours { WorkspaceId = actor.WorkspaceId });
            await db.SaveChangesAsync(ct);
        }

        var existing = await db.BusinessHolidays
            .SingleOrDefaultAsync(h => h.WorkspaceId == actor.WorkspaceId && h.Date == date, ct);
        if (existing is not null)
        {
            // Adding a date that is already a holiday renames it. Refusing would
            // mean deleting and re-adding to fix a typo.
            existing.Name = Clean(name);
            await db.SaveChangesAsync(ct);
            return new BusinessHolidayDto(existing.Id, existing.Date, existing.Name);
        }

        var holiday = new BusinessHoliday
        {
            WorkspaceId = actor.WorkspaceId,
            Date = date,
            Name = Clean(name),
        };
        db.BusinessHolidays.Add(holiday);
        await db.SaveChangesAsync(ct);
        return new BusinessHolidayDto(holiday.Id, holiday.Date, holiday.Name);
    }

    public async Task<bool> RemoveHolidayAsync(Actor actor, Guid id, CancellationToken ct)
    {
        RequireAdmin(actor);
        var holiday = await db.BusinessHolidays
            .SingleOrDefaultAsync(h => h.Id == id && h.WorkspaceId == actor.WorkspaceId, ct);
        if (holiday is null) return false;
        db.BusinessHolidays.Remove(holiday);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- The scorecard ---------------------------------------------------------

    /// <summary>
    /// How each agent did against the SLA, over a window.
    ///
    /// **Counted, not scored.** Trackly does not invent a points number, because
    /// an invented formula in a support tool gets gamed within a month — agents
    /// cherry-pick easy tickets, or close and reopen to reset a clock, and the
    /// number stops measuring anything. What is here is the raw record and one
    /// derived figure that is defensible on its own terms: attainment, the share
    /// of finished tickets that met both targets they had.
    ///
    /// Only tickets that FINISHED in the window, so an agent is measured on work
    /// they completed rather than on a queue somebody else handed them.
    /// </summary>
    public async Task<IReadOnlyList<AgentSlaScoreDto>> ScorecardAsync(
        Actor actor, DateTime since, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        // Materialised before shaping. Grouping and counting conditionally in one
        // SQL projection is exactly the pattern EF refused for the facets, and
        // the row count here is one per resolved ticket in the window — small.
        var rows = await db.Tickets
            .Where(t => t.WorkspaceId == actor.WorkspaceId
                        && t.AssigneeId != null
                        && t.ResolvedAt != null
                        && t.ResolvedAt >= since)
            .Select(t => new
            {
                AgentId = t.AssigneeId!.Value,
                AgentName = t.Assignee!.Name,
                AgentEmail = t.Assignee.Email,
                t.FirstResponseDueAt,
                t.FirstResponseAt,
                t.ResolveDueAt,
                t.ResolvedAt,
            })
            .ToListAsync(ct);

        return rows
            .GroupBy(r => new { r.AgentId, r.AgentName, r.AgentEmail })
            .Select(g =>
            {
                // A leg only counts when there WAS a target. A ticket with no
                // policy is neither met nor missed, and folding it in either
                // direction would make attainment a number about coverage
                // rather than about performance.
                var frTracked = g.Where(r => r.FirstResponseDueAt is not null).ToList();
                var frMet = frTracked.Count(r => r.FirstResponseAt is not null
                                                 && r.FirstResponseAt <= r.FirstResponseDueAt);

                var resTracked = g.Where(r => r.ResolveDueAt is not null).ToList();
                var resMet = resTracked.Count(r => r.ResolvedAt <= r.ResolveDueAt);

                var tracked = frTracked.Count + resTracked.Count;
                var met = frMet + resMet;

                return new AgentSlaScoreDto(
                    g.Key.AgentId,
                    g.Key.AgentName ?? g.Key.AgentEmail ?? "",
                    g.Count(),
                    frTracked.Count, frMet,
                    resTracked.Count, resMet,
                    // Null, not zero, when nothing was measurable: "0%" reads as
                    // failure and the truth is that no target applied.
                    tracked == 0 ? null : Math.Round(met * 100.0 / tracked, 1));
            })
            .OrderByDescending(s => s.Attainment ?? -1)
            .ThenByDescending(s => s.Resolved)
            .ToList();
    }

    // ---- Helpers ----------------------------------------------------------------

    private static void RequireAdmin(Actor actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();
    }

    private static bool IsKnownTimeZone(string id)
    {
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(id);
            return true;
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return false;
        }
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null
            : value.Trim().Length <= 100 ? value.Trim() : value.Trim()[..100];
}

/// <param name="Days">Only OPEN days appear. A missing day is closed.</param>
public record BusinessHoursDto(
    bool IsEnabled,
    string TimeZone,
    IReadOnlyList<BusinessDayDto> Days,
    IReadOnlyList<BusinessHolidayDto> Holidays);

/// <param name="DayOfWeek">0 = Sunday.</param>
/// <param name="StartMinute">Minutes from midnight, local to the workspace. 540 = 09:00.</param>
public record BusinessDayDto(int DayOfWeek, int StartMinute, int EndMinute);

public record BusinessHolidayDto(Guid Id, DateOnly Date, string? Name);

/// <param name="Attainment">
/// Percent of measurable legs met. Null when no target applied to anything the
/// agent finished — which is different from zero.
/// </param>
public record AgentSlaScoreDto(
    Guid AgentId,
    string Name,
    int Resolved,
    int FirstResponseTracked,
    int FirstResponseMet,
    int ResolutionTracked,
    int ResolutionMet,
    double? Attainment);
