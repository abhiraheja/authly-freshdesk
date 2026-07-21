namespace Trackly.Core.Entities;

// Composite PK (TicketId, AgentId). Watchers receive all ticket notifications.
public class TicketWatcher
{
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;
    public Guid AgentId { get; set; }
    public User Agent { get; set; } = null!;
    public Guid AddedBy { get; set; }
    public User AddedByUser { get; set; } = null!;
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}
