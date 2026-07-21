namespace Trackly.Core.Entities;

// Assignment history: one row per (re)assignment; null AssignedBy = auto (round-robin).
public class TicketAssignment
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;
    public Guid AssignedTo { get; set; }
    public User AssignedToUser { get; set; } = null!;
    public Guid? AssignedBy { get; set; }
    public User? AssignedByUser { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
}
