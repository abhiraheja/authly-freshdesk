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
    public Guid? ProblemId { get; set; }            // groups related tickets (agent-only)
    public Problem? Problem { get; set; }
    public Guid? TeamId { get; set; }               // routed team (round-robin within)
    public Team? Team { get; set; }
    public string Channel { get; set; } = TicketChannel.Web;

    // SLA (nullable = no policy applies). first_response_at stops the response
    // clock; sla_paused_at holds the moment the resolve clock paused (pending).
    public DateTime? FirstResponseDueAt { get; set; }
    public DateTime? ResolveDueAt { get; set; }
    public DateTime? FirstResponseAt { get; set; }
    public DateTime? SlaPausedAt { get; set; }

    // Set each time the ticket transitions into Resolved; cleared on reopen.
    // Drives resolution-time and SLA-attainment analytics (Phase 7C).
    public DateTime? ResolvedAt { get; set; }

    /// <summary>
    /// Why this ticket was resolved or closed — what was fixed, by whom.
    /// Required on the transition out of open/pending, enforced in
    /// <c>TicketService.UpdateAsync</c> rather than the dialog, because a rule
    /// that only exists in the UI is not a rule.
    ///
    /// **Internal.** It is engineering detail (root cause, a work-item link) and
    /// never reaches the customer, the guest view or a messaging connector —
    /// same footing as a private note (invariant 5). The copy that lives in the
    /// thread is written as an internal comment.
    ///
    /// Cleared on reopen: it describes the resolution the ticket currently has,
    /// and a reopened ticket has none. The comment keeps the history.
    /// </summary>
    public string? ResolutionNote { get; set; }

    /// <summary>Work item, PR or user story this was fixed under. Optional.</summary>
    public string? ResolutionLink { get; set; }

    public Guid? ResolvedById { get; set; }
    public User? ResolvedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
    public ICollection<TicketWatcher> Watchers { get; set; } = new List<TicketWatcher>();
    public ICollection<TicketTag> TicketTags { get; set; } = new List<TicketTag>();
    public ICollection<TicketTimeEntry> TimeEntries { get; set; } = new List<TicketTimeEntry>();
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
    public const string Slack = "slack";
    public const string WhatsApp = "whatsapp";
    public const string Teams = "teams";
    public const string Chat = "chat";

    // The channels Trackly itself produces. A workspace may store others — an
    // agent can type a channel of their own on the new-ticket form — so treat
    // this as the known set, never as validation.
    public static readonly string[] All = [Web, Widget, Email, Slack, WhatsApp, Teams, Chat];
}
