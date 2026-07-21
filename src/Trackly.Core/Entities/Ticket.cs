namespace Trackly.Core.Entities;

public class Ticket
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Subject { get; set; } = null!;
    public string Description { get; set; } = null!;
    public string Status { get; set; } = TicketStatus.Open;
    public string Priority { get; set; } = TicketPriority.Medium;
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }
    public Guid? RequesterId { get; set; }          // null if anonymous (guest)
    public User? Requester { get; set; }
    public string? GuestEmail { get; set; }
    public string? GuestName { get; set; }
    public string? GuestTokenHash { get; set; }     // SHA-256 of guest magic-link token
    public Guid? AssigneeId { get; set; }
    public User? Assignee { get; set; }
    public string Channel { get; set; } = TicketChannel.Web;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
    public ICollection<TicketWatcher> Watchers { get; set; } = new List<TicketWatcher>();
}

public static class TicketStatus
{
    public const string Open = "open";
    public const string Pending = "pending";
    public const string Resolved = "resolved";
    public const string Closed = "closed";
    public static readonly string[] All = [Open, Pending, Resolved, Closed];
}

public static class TicketPriority
{
    public const string Low = "low";
    public const string Medium = "medium";
    public const string High = "high";
    public const string Urgent = "urgent";
    public static readonly string[] All = [Low, Medium, High, Urgent];
}

public static class TicketChannel
{
    public const string Web = "web";
    public const string Widget = "widget";
    public const string Email = "email";
}
