namespace Trackly.Core.Entities;

/// <summary>
/// One agent's own pin on a ticket. Personal, and invisible to everybody else.
///
/// **This is not the flag, and the difference is who it is for.** A pin is a
/// bookmark: "I am coming back to this", it sorts to the top of MY list, and no
/// colleague can see it or clear it. A flag (<see cref="Ticket.FlaggedAt"/>) is
/// a statement to the team: "this one matters", visible to everyone and
/// clearable by anyone.
///
/// Collapsing the two would break both. A shared pin means an agent tidying
/// their own list reorders everybody else's; a personal flag means nobody can be
/// told that a ticket is important.
/// </summary>
public class TicketPin
{
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    /// <summary>Whose pin. The row exists only for them.</summary>
    public Guid AgentId { get; set; }
    public User? Agent { get; set; }

    public DateTime PinnedAt { get; set; } = DateTime.UtcNow;
}
