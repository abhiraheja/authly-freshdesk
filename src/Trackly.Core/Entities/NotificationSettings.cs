namespace Trackly.Core.Entities;

// Per-workspace toggles gating each outbound notification. One row per workspace;
// absent row means "all defaults on".
public class NotificationSettings
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public bool NotifyCustomerOnCreate { get; set; } = true;
    public bool NotifyCustomerOnReply { get; set; } = true;
    public bool NotifyCustomerOnStatus { get; set; } = true;
    public bool NotifyAgentOnAssign { get; set; } = true;
    public bool NotifyAgentOnReply { get; set; } = true;
    public bool NotifyAgentOnReassign { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
