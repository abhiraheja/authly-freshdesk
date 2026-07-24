namespace Trackly.Core.Entities;

// Groups related tickets under a single root cause. Agent/admin-only — customers
// never see the grouping, only their own ticket.
public class Problem
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Title { get; set; } = null!;
    public string? Description { get; set; }
    public string Status { get; set; } = ProblemStatus.Investigating;
    public Guid? AssigneeId { get; set; }
    public User? Assignee { get; set; }
    public Guid CreatedBy { get; set; }
    public User CreatedByUser { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
}

public static class ProblemStatus
{
    public const string Investigating = "investigating";
    public const string Identified = "identified";
    public const string Monitoring = "monitoring";
    public const string Resolved = "resolved";
    public static readonly string[] All = [Investigating, Identified, Monitoring, Resolved];
}
