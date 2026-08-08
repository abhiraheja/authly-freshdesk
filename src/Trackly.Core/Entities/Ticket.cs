namespace Trackly.Core.Entities;

public class Ticket
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Subject { get; set; } = null!;
    public string Description { get; set; } = null!;

    /// <summary>
    /// The workspace status's <see cref="TicketStatus.Value"/>, not its id.
    ///
    /// A value rather than a foreign key because it is what automation rules
    /// match on, what the email and chat connectors write, and what every
    /// pre-workflow row already holds — an id would have made all three a
    /// migration.
    /// </summary>
    public string Status { get; set; } = TicketStatusCategory.DefaultValue;

    /// <summary>
    /// The category of <see cref="Status"/>, denormalised.
    ///
    /// **Every rule in Trackly tests this, never the status.** Keeping it on the
    /// row is what lets "open tickets", "pause the clock", "ask for a resolution
    /// note" and "issue a CSAT survey" stay single indexed comparisons instead of
    /// a join in every query in the system.
    ///
    /// Written whenever Status is written, and re-written across every affected
    /// ticket when an admin moves a status to another category. Never set one
    /// without the other.
    /// </summary>
    public string StatusCategory { get; set; } = TicketStatusCategory.Open;
    public string Priority { get; set; } = TicketPriority.Medium;
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }

    /// <summary>
    /// The narrower category, whose <see cref="Category.ParentId"/> must be
    /// <see cref="CategoryId"/> — validated on write.
    ///
    /// A second column rather than pointing CategoryId at the leaf: every rule,
    /// report and filter that already reads CategoryId keeps meaning "the
    /// department-level answer", and none of them had to learn about the tree.
    /// Clearing the parent clears this too, since a sub-category without its
    /// parent is a label with nothing above it.
    /// </summary>
    public Guid? SubCategoryId { get; set; }
    public Category? SubCategory { get; set; }
    public Guid? RequesterId { get; set; }          // null if anonymous (guest)
    public User? Requester { get; set; }
    public string? GuestEmail { get; set; }
    public string? GuestName { get; set; }
    public string? GuestTokenHash { get; set; }     // SHA-256 of guest magic-link token
    public Guid? AssigneeId { get; set; }
    public User? Assignee { get; set; }
    public Guid? ProblemId { get; set; }            // groups related tickets (agent-only)
    public Problem? Problem { get; set; }
    public Guid? TeamId { get; set; }               // routed department (round-robin within)
    public Team? Team { get; set; }

    /// <summary>
    /// The sub-department, whose <see cref="Team.ParentId"/> must be
    /// <see cref="TeamId"/> — validated on write. Labels only: routing reads
    /// TeamId, so narrowing this never changes who the ticket lands on.
    /// </summary>
    public Guid? SubTeamId { get; set; }
    public Team? SubTeam { get; set; }

    public string Channel { get; set; } = TicketChannel.Web;

    // SLA (nullable = no policy applies). first_response_at stops the response
    // clock; sla_paused_at holds the moment the resolve clock paused (pending).
    public DateTime? FirstResponseDueAt { get; set; }
    public DateTime? ResolveDueAt { get; set; }
    public DateTime? FirstResponseAt { get; set; }
    public DateTime? SlaPausedAt { get; set; }

    /// <summary>
    /// When the breach sweep last told somebody about this ticket, and at what
    /// stage.
    ///
    /// A marker rather than a derived check, because "is it late" is true from
    /// the moment it goes late until somebody acts — and a sweep that re-derived
    /// it would send the same warning every few minutes until the recipient
    /// filtered the whole lot into a folder.
    ///
    /// Two columns, because a warning and a breach are two different messages
    /// about the same ticket and sending the second must not depend on whether
    /// the first went out.
    /// </summary>
    public DateTime? SlaWarningSentAt { get; set; }
    public DateTime? SlaBreachSentAt { get; set; }

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

    /// <summary>
    /// What the CUSTOMER is told was done. Optional, and a different thing from
    /// <see cref="ResolutionNote"/>.
    ///
    /// The internal note is engineering detail — "stale connection pool, patched
    /// in #4821". That sentence is the right record for the team and the wrong
    /// thing to send a customer, so Trackly does not send it. This is the plain
    /// answer to "what happened to my ticket": *"We restarted the payments
    /// service and your invoice has now been emailed."*
    ///
    /// Reaching customer surfaces is the whole point of the field, so it is the
    /// one part of the resolution the portal, the guest view and the resolution
    /// email may render. Everything else stays internal (invariant 5). Cleared
    /// on reopen alongside the internal note.
    /// </summary>
    public string? ResolutionSummary { get; set; }

    public Guid? ResolvedById { get; set; }
    public User? ResolvedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
    public ICollection<TicketWatcher> Watchers { get; set; } = new List<TicketWatcher>();
    public ICollection<TicketTag> TicketTags { get; set; } = new List<TicketTag>();
    public ICollection<TicketTimeEntry> TimeEntries { get; set; } = new List<TicketTimeEntry>();
    public ICollection<TicketLink> Links { get; set; } = new List<TicketLink>();
    public ICollection<TicketTask> Tasks { get; set; } = new List<TicketTask>();
    public ICollection<TicketResponder> Responders { get; set; } = new List<TicketResponder>();
    public ICollection<TicketAsset> Assets { get; set; } = new List<TicketAsset>();
    public ICollection<TicketImpactedService> ImpactedServices { get; set; } = new List<TicketImpactedService>();
    public ICollection<TicketFieldValue> FieldValues { get; set; } = new List<TicketFieldValue>();
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
