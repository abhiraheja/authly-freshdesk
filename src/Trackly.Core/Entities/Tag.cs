namespace Trackly.Core.Entities;

// Free-form workspace label for tickets. Agent-facing metadata; not shown on
// customer surfaces. Unique by name within a workspace.
public class Tag
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Color { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Join row: which tags are on which ticket.
public class TicketTag
{
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;
    public Guid TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}
