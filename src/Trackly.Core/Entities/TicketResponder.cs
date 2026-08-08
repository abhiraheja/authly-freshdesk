namespace Trackly.Core.Entities;

/// <summary>
/// Someone working the ticket alongside the assignee.
///
/// **Not a watcher, and the difference matters.** A watcher is reading; a
/// responder is doing. Merging the two would mean either notifying every curious
/// bystander as though they owed the customer an answer, or leaving the second
/// engineer on a major incident with no way to say they are on it.
///
/// **One assignee, still.** Trackly does not have joint ownership, because
/// "everyone is responsible" is how a ticket ends up with nobody answering it.
/// The assignee owns the outcome; responders are the people helping, and
/// promoting one is a normal reassignment.
///
/// Responders are notified like watchers — being on the ticket implies wanting
/// to hear about it — so adding somebody here also means they will not miss the
/// customer's next reply.
/// </summary>
public class TicketResponder
{
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public Guid AgentId { get; set; }
    public User? Agent { get; set; }

    /// <summary>
    /// What they are doing on it — "network side", "shadowing", "vendor liaison".
    /// Free text and optional: any fixed list would be wrong for the next
    /// workspace, and the field earns its place only when somebody uses it.
    /// </summary>
    public string? Role { get; set; }

    public Guid? AddedBy { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}
