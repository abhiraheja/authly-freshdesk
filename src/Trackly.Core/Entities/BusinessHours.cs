namespace Trackly.Core.Entities;

/// <summary>
/// When this workspace is open, so an SLA deadline can be a promise it can keep.
///
/// **Without this, a ticket raised at 17:55 on Friday with a 4-hour target is
/// breached before anyone is back at their desk.** That is not a missed SLA, it
/// is a badly measured one, and a support team that stops trusting the number
/// stops looking at it.
///
/// Off by default. A 24/7 desk wants the clock to keep running, and a workspace
/// that has not thought about this yet is better served by the simple behaviour
/// than by hours somebody else guessed at.
/// </summary>
public class BusinessHours
{
    /// <summary>One row per workspace, so the workspace id IS the key.</summary>
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>
    /// False means round-the-clock: deadlines are plain wall-clock arithmetic.
    /// </summary>
    public bool IsEnabled { get; set; }

    /// <summary>
    /// IANA zone — "Asia/Kolkata", "Europe/London".
    ///
    /// Stored rather than taken from the server, because "9am" means the
    /// customer's 9am and the server may be in another hemisphere. Deadlines are
    /// still stored in UTC; this only decides which UTC instants count as open.
    /// </summary>
    public string TimeZone { get; set; } = "UTC";

    public ICollection<BusinessHourDay> Days { get; set; } = new List<BusinessHourDay>();
    public ICollection<BusinessHoliday> Holidays { get; set; } = new List<BusinessHoliday>();
}

/// <summary>
/// One open window on one day of the week.
///
/// A row per open day rather than seven rows with an "is open" flag: a closed
/// day is the absence of a window, which is one fewer state that can disagree
/// with itself (open with a zero-length window, closed with hours set).
/// </summary>
public class BusinessHourDay
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public BusinessHours? BusinessHours { get; set; }

    /// <summary>0 = Sunday, matching <see cref="System.DayOfWeek"/>.</summary>
    public int DayOfWeek { get; set; }

    /// <summary>Minutes from midnight, local to the workspace's zone. 540 = 09:00.</summary>
    public int StartMinute { get; set; }
    public int EndMinute { get; set; }
}

/// <summary>
/// A day the desk is shut regardless of the weekly pattern.
///
/// A plain date, not a range: a holiday that spans days is entered as days, and
/// a range would need a rule for what "half a day" means that nobody wants.
/// </summary>
public class BusinessHoliday
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public BusinessHours? BusinessHours { get; set; }

    /// <summary>The local date in the workspace's zone. Time is ignored.</summary>
    public DateOnly Date { get; set; }
    public string? Name { get; set; }
}
