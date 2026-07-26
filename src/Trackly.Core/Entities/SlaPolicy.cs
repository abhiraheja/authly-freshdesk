namespace Trackly.Core.Entities;

// Per-workspace, per-priority SLA target. Minutes are wall-clock; the resolve
// clock pauses while a ticket is pending (waiting on the customer). One policy
// per (workspace, priority).
public class SlaPolicy
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Priority { get; set; } = null!;       // low | medium | high | urgent
    public int? FirstResponseMinutes { get; set; }
    public int? ResolveMinutes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
