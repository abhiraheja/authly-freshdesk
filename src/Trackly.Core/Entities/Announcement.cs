namespace Trackly.Core.Entities;

// A mass email to every customer with a Trackly account in the workspace.
// Guests are excluded — Trackly has no verified opt-in for them.
public class Announcement
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Type { get; set; } = AnnouncementType.General;
    public string Subject { get; set; } = null!;
    public string Body { get; set; } = null!;
    public Guid? ProblemId { get; set; }
    public Problem? Problem { get; set; }
    public Guid CreatedBy { get; set; }
    public User CreatedByUser { get; set; } = null!;
    public DateTime? ScheduledAt { get; set; }
    public DateTime? SentAt { get; set; }
    public int RecipientCount { get; set; }
    public int SuccessCount { get; set; }
    public int FailureCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<AnnouncementDelivery> Deliveries { get; set; } = new List<AnnouncementDelivery>();
}

public static class AnnouncementType
{
    public const string PlannedOutage = "planned_outage";
    public const string UnplannedOutage = "unplanned_outage";
    public const string Resolved = "resolved";
    public const string General = "general";
    public static readonly string[] All = [PlannedOutage, UnplannedOutage, Resolved, General];
}

public class AnnouncementDelivery
{
    public Guid Id { get; set; }
    public Guid AnnouncementId { get; set; }
    public Announcement Announcement { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string Status { get; set; } = DeliveryStatus.Pending;
    public DateTime? SentAt { get; set; }
    public string? Error { get; set; }
}

public static class DeliveryStatus
{
    public const string Pending = "pending";
    public const string Sent = "sent";
    public const string Failed = "failed";
    public const string Bounced = "bounced";
}
