namespace Trackly.Core.Entities;

/// <summary>
/// Work an agent did on a ticket: how long, and what they did.
///
/// Many rows per ticket, not one total, because a ticket is usually worked in
/// sittings and often by more than one person — a single number could not say
/// who spent it or on what, which is the part that is actually worth reading
/// later.
///
/// Entered by hand rather than measured by a running clock. A timer sounds more
/// accurate and is not: it is left running overnight, or never started at all,
/// and then the number has to be corrected anyway.
/// </summary>
public class TicketTimeEntry
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    /// <summary>Who did the work — not necessarily who typed it in.</summary>
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>
    /// Minutes, not a TimeSpan: every input and every total in the UI is whole
    /// minutes, and storing a finer unit would only invite rounding differences
    /// between the two.
    /// </summary>
    public int Minutes { get; set; }

    /// <summary>What was done. Agent-facing only, like a private note.</summary>
    public string? Note { get; set; }

    /// <summary>
    /// When the work happened, which is not when the row was written — time is
    /// routinely logged the morning after.
    /// </summary>
    public DateTime SpentAt { get; set; } = DateTime.UtcNow;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class TicketTimeLimits
{
    /// <summary>
    /// 24 hours in one entry. Not a policy — a typo guard: "480" meant as eight
    /// hours typed into a field that wanted minutes is the common mistake, and
    /// a day is the point past which the number is certainly wrong.
    /// </summary>
    public const int MaxMinutesPerEntry = 24 * 60;
}
