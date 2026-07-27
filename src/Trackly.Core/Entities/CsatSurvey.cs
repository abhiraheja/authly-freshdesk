namespace Trackly.Core.Entities;

// Customer-satisfaction survey issued when a ticket is resolved. Exactly one row
// per ticket (single submission). The rating link carries a random token stored
// here only as a SHA-256 hash; the score is attributed to the assignee at
// resolution time so CSAT can be reported per agent.
public class CsatSurvey
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    public string TokenHash { get; set; } = null!;   // SHA-256 of the rating-link token
    public Guid? AgentId { get; set; }                // assignee at resolution (per-agent CSAT)

    public int? Rating { get; set; }                  // 1..5, null until the customer rates
    public string? Comment { get; set; }              // optional free-text feedback

    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedAt { get; set; }        // non-null ⇒ already rated (single-use)
}
