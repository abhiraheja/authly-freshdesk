namespace Trackly.Core.Entities;

// Idempotency ledger for inbound email. Every ingested message records its
// provider Message-ID here under a unique (workspace_id, message_id) index, so a
// webhook retry or a polling worker restart can never create the same comment
// twice. Written inside the same transaction that inserts the comment.
public class InboundEmailEvent
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string MessageId { get; set; } = null!;
    public Guid? TicketId { get; set; }       // resolved/created ticket, if any
    public Guid? CommentId { get; set; }       // inserted comment, if any
    public string Outcome { get; set; } = null!; // comment | new_ticket | rejected | ignored
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
}

public static class InboundOutcome
{
    public const string Comment = "comment";
    public const string NewTicket = "new_ticket";
    public const string Rejected = "rejected";
    public const string Ignored = "ignored";
}
