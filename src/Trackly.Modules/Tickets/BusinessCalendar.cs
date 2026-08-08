using Trackly.Core.Entities;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Walks a clock forward through a workspace's open hours.
///
/// Pure and immutable: built once from the workspace's schedule, then asked
/// questions. Nothing in here touches the database, which is what makes it
/// testable without one — and this is arithmetic that has to be exactly right,
/// because every SLA number in the product is downstream of it.
/// </summary>
public sealed class BusinessCalendar
{
    /// <summary>
    /// Safety stop for the forward walk.
    ///
    /// A schedule with no open days at all would otherwise loop forever looking
    /// for a minute that does not exist. Two years is far past any real SLA
    /// target, so hitting it means the schedule is broken rather than the
    /// deadline being distant.
    /// </summary>
    private const int MaxDaysToScan = 730;

    private readonly TimeZoneInfo zone;

    /// <summary>Open windows per day of week, sorted and non-overlapping.</summary>
    private readonly List<(int Start, int End)>[] windows = new List<(int, int)>[7];

    private readonly HashSet<DateOnly> holidays;

    /// <summary>True when there is nothing to walk — the clock runs continuously.</summary>
    public bool RunsContinuously { get; }

    private BusinessCalendar(
        bool runsContinuously, TimeZoneInfo zone,
        IEnumerable<BusinessHourDay> days, IEnumerable<BusinessHoliday> holidays)
    {
        RunsContinuously = runsContinuously;
        this.zone = zone;
        this.holidays = holidays.Select(h => h.Date).ToHashSet();

        for (var i = 0; i < 7; i++) windows[i] = [];
        foreach (var day in days)
        {
            if (day.DayOfWeek is < 0 or > 6) continue;
            // Clamped and skipped rather than trusted: a window ending before it
            // starts would silently subtract time from the walk below.
            var start = Math.Clamp(day.StartMinute, 0, 1440);
            var end = Math.Clamp(day.EndMinute, 0, 1440);
            if (end > start) windows[day.DayOfWeek].Add((start, end));
        }
        foreach (var list in windows) list.Sort();
    }

    /// <summary>
    /// The workspace's calendar, or a continuous one when business hours are off
    /// — or configured in a way that would never open.
    ///
    /// An empty schedule is treated as 24/7 rather than "never": a workspace that
    /// enabled the feature and saved no days would otherwise have every deadline
    /// pushed out forever, which looks exactly like the clock being broken.
    /// </summary>
    public static BusinessCalendar For(BusinessHours? hours)
    {
        if (hours is null || !hours.IsEnabled)
            return Continuous();

        var days = hours.Days.ToList();
        if (days.All(d => d.EndMinute <= d.StartMinute))
            return Continuous();

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(hours.TimeZone);
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            // A zone the host does not know is a configuration mistake, and
            // silently using the server's own zone would produce deadlines that
            // are wrong by hours with nothing on screen to explain it. UTC is at
            // least a stated, predictable answer.
            zone = TimeZoneInfo.Utc;
        }

        return new BusinessCalendar(false, zone, days, hours.Holidays);
    }

    private static BusinessCalendar Continuous() =>
        new(true, TimeZoneInfo.Utc, [], []);

    /// <summary>
    /// <paramref name="from"/> plus <paramref name="minutes"/> of OPEN time.
    ///
    /// Both in and out are UTC. When the calendar runs continuously this is
    /// plain addition, so callers never need to branch on it.
    /// </summary>
    public DateTime AddWorkingMinutes(DateTime from, int minutes)
    {
        if (RunsContinuously || minutes <= 0) return from.AddMinutes(minutes);

        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(from, DateTimeKind.Utc), zone);
        var date = DateOnly.FromDateTime(local);
        var minuteOfDay = local.Hour * 60 + local.Minute;
        var remaining = minutes;

        for (var scanned = 0; scanned < MaxDaysToScan; scanned++)
        {
            foreach (var (start, end) in OpenWindows(date))
            {
                // A window that has already passed today contributes nothing.
                if (end <= minuteOfDay) continue;

                // Starting mid-window counts from now; starting before it counts
                // from the moment it opens. This is what makes a ticket raised at
                // 07:00 due from 09:00 rather than from 07:00.
                var enters = Math.Max(start, minuteOfDay);
                var available = end - enters;

                if (available >= remaining)
                    return ToUtc(date, enters + remaining);

                remaining -= available;
            }

            date = date.AddDays(1);
            // Every day after the first begins at midnight, not at the time the
            // clock started.
            minuteOfDay = 0;
        }

        // Unreachable for any sane schedule; returning the input rather than
        // throwing keeps a broken calendar from taking a ticket save down with it.
        return from;
    }

    /// <summary>
    /// How many OPEN minutes lie between two instants. Never negative.
    ///
    /// Used to measure elapsed time against a target, which has to be counted the
    /// same way the target was set or the two numbers describe different clocks.
    /// </summary>
    public int WorkingMinutesBetween(DateTime from, DateTime to)
    {
        if (to <= from) return 0;
        if (RunsContinuously) return (int)Math.Min((to - from).TotalMinutes, int.MaxValue);

        var localFrom = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(from, DateTimeKind.Utc), zone);
        var localTo = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(to, DateTimeKind.Utc), zone);

        var date = DateOnly.FromDateTime(localFrom);
        var last = DateOnly.FromDateTime(localTo);
        var startMinute = localFrom.Hour * 60 + localFrom.Minute;
        var endMinute = localTo.Hour * 60 + localTo.Minute;
        var total = 0;

        for (var scanned = 0; date <= last && scanned < MaxDaysToScan; scanned++, date = date.AddDays(1))
        {
            var floor = scanned == 0 ? startMinute : 0;
            var ceiling = date == last ? endMinute : 1440;

            foreach (var (start, end) in OpenWindows(date))
            {
                var overlap = Math.Min(end, ceiling) - Math.Max(start, floor);
                if (overlap > 0) total += overlap;
            }
        }

        return total;
    }

    /// <summary>Whether the desk is open at this instant.</summary>
    public bool IsOpenAt(DateTime utc)
    {
        if (RunsContinuously) return true;
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        var minute = local.Hour * 60 + local.Minute;
        return OpenWindows(DateOnly.FromDateTime(local)).Any(w => minute >= w.Start && minute < w.End);
    }

    /// <summary>A holiday has no open windows, whatever the weekly pattern says.</summary>
    private List<(int Start, int End)> OpenWindows(DateOnly date) =>
        holidays.Contains(date) ? [] : windows[(int)date.DayOfWeek];

    private DateTime ToUtc(DateOnly date, int minuteOfDay)
    {
        // Clamped: a window ending exactly at 1440 would otherwise roll the date
        // forward by construction rather than by the walk.
        var capped = Math.Min(minuteOfDay, 1439);
        var local = date.ToDateTime(new TimeOnly(capped / 60, capped % 60));
        // Unspecified, not Local: the value is local to the WORKSPACE's zone, and
        // labelling it Local would make the conversion use the server's.
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone);
    }
}
