namespace Trackly.Core.Entities;

/// <summary>
/// One thing that happened to a ticket. The audit trail behind the Activity tab.
///
/// **Stores what changed, never a sentence.** A row holds a type and the two
/// labels; the client builds the wording. Trackly ships in two languages, and a
/// row that already said "changed status to Open" would be stuck in whichever
/// one the agent happened to have selected at the time.
///
/// **The labels are captured as they read AT THE TIME.** An audit trail is a
/// record of what happened, so renaming a status to "QA" must not rewrite last
/// month's entry into a change that nobody made, and deleting a category must
/// not blank out the rows that mention it. That is also why they are plain text
/// and not foreign keys.
///
/// The actor is the exception: it is stored as an id and rendered live, because
/// a person's name changing is a fact about them and not about the ticket, and
/// their avatar and profile are worth reaching from here.
/// </summary>
public class TicketActivity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    /// <summary>Null means Trackly did it — automation, an inbound email, the SLA clock.</summary>
    public Guid? ActorId { get; set; }
    public User? Actor { get; set; }

    /// <summary>One of <see cref="TicketActivityType"/>.</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>What it was. Null when the change had nothing before it.</summary>
    public string? FromLabel { get; set; }

    /// <summary>What it became, or the detail of a one-sided event ("30m", a file name).</summary>
    public string? ToLabel { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The vocabulary of the activity feed.
///
/// Deliberately one constant per KIND of change rather than a generic
/// "field changed" with the field name in a column: the client renders each one
/// differently — an icon, a tone, whether the labels are chips or plain — and a
/// free-text field name would make that a lookup that silently falls through
/// for anything unrecognised.
/// </summary>
public static class TicketActivityType
{
    public const string Created = "created";

    // Property changes: both labels set.
    public const string Status = "status";
    public const string Priority = "priority";
    public const string Assignee = "assignee";
    public const string Team = "team";
    public const string Category = "category";
    public const string Subject = "subject";
    public const string Requester = "requester";

    // One-sided events: ToLabel carries the detail.
    public const string WatcherAdded = "watcher_added";
    public const string WatcherRemoved = "watcher_removed";
    public const string Replied = "replied";
    public const string Noted = "noted";
    public const string AttachmentAdded = "attachment_added";
    public const string LinkAdded = "link_added";
    public const string LinkRemoved = "link_removed";
    public const string TimeLogged = "time_logged";
    public const string ProblemLinked = "problem_linked";
    public const string ProblemUnlinked = "problem_unlinked";
    public const string TaskAdded = "task_added";
    public const string TaskCompleted = "task_completed";
    public const string TaskReopened = "task_reopened";
    public const string TaskRemoved = "task_removed";
    public const string ResponderAdded = "responder_added";
    public const string ResponderRemoved = "responder_removed";
    public const string AssetAdded = "asset_added";
    public const string AssetRemoved = "asset_removed";
    public const string ServiceImpacted = "service_impacted";
    public const string ServiceRecovered = "service_recovered";
    public const string FieldChanged = "field_changed";

    /// <summary>
    /// The ticket ended. Separate from <see cref="Status"/> even though a status
    /// change is what caused it, because "resolved" is the event people scan the
    /// log for and it carries the resolution note rather than the status name.
    /// </summary>
    public const string Resolved = "resolved";

    public const string Reopened = "reopened";
}
