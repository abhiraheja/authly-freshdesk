namespace Trackly.Core.Entities;

/// <summary>
/// One thing that happened which somebody should know about, in the app rather
/// than in their inbox.
///
/// Separate from the email notifications (<c>NotificationService</c>) on purpose.
/// Email is for people who are not looking at Trackly; this is the bell, for
/// people who are. A mention writes both, because "did you see my note?" is
/// exactly the thing that should reach you either way.
///
/// **Rendered client-side.** The row stores what happened —
/// <see cref="Type"/>, who did it, which ticket — and never a sentence. Storing
/// "Priya mentioned you" would freeze the notification in whatever language the
/// server was running in, forever.
/// </summary>
public class Notification
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>Who this is for.</summary>
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>One of <see cref="NotificationType"/>.</summary>
    public string Type { get; set; } = null!;

    public Guid? TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public Guid? CommentId { get; set; }

    /// <summary>Who caused it. Null for anything the system did on its own.</summary>
    public Guid? ActorId { get; set; }
    public User? Actor { get; set; }

    /// <summary>
    /// A short plain-text extract of what was written — never markup. The bell
    /// renders it as text, and it is also what the row is for: "someone replied"
    /// without the first line of the reply is not worth the interruption.
    /// </summary>
    public string? Preview { get; set; }

    /// <summary>Null until it is read. Not a bool, so "when" survives.</summary>
    public DateTime? ReadAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class NotificationType
{
    /// <summary>Named in a reply or a note.</summary>
    public const string Mention = "mention";

    /// <summary>Something changed on a ticket you watch.</summary>
    public const string Watching = "watching";

    /// <summary>The ticket became yours.</summary>
    public const string Assigned = "assigned";

    /// <summary>A reply landed on a ticket assigned to you.</summary>
    public const string Reply = "reply";

    /// <summary>An SLA deadline is close and there is still time to act.</summary>
    public const string SlaWarning = "sla_warning";

    /// <summary>An SLA deadline has passed. Sent once, never repeated.</summary>
    public const string SlaBreached = "sla_breached";

    public static readonly string[] All =
        [Mention, Watching, Assigned, Reply, SlaWarning, SlaBreached];
}

/// <summary>
/// Somebody named in a comment.
///
/// A row rather than a re-parse of the body on every read: "tickets where I was
/// mentioned" is a navigation item with a count beside it, and scanning every
/// comment in the workspace to build it is not a query anybody wants running on
/// each page load.
///
/// <see cref="TicketId"/> is denormalised from the comment for exactly that
/// query — it is what the index is on, and a mention never moves between tickets.
/// </summary>
public class CommentMention
{
    public Guid CommentId { get; set; }
    public Comment Comment { get; set; } = null!;

    /// <summary>Who was named. Always an agent or admin in this workspace.</summary>
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
