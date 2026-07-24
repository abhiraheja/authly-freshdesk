namespace Trackly.Modules.Email;

// Transport-neutral inbound email. Both connectors (parse webhook and mailbox
// polling) normalise to this before entering the shared pipeline.
public record InboundMessage(
    string MessageId,
    string FromEmail,
    string? FromName,
    string ToAddress,
    string Subject,
    string TextBody,
    IReadOnlyList<string> ReferenceIds,
    IReadOnlyList<InboundAttachment> Attachments);

public record InboundAttachment(string FileName, string ContentType, byte[] Content);

public record InboundResult(string Outcome, Guid? TicketId, Guid? CommentId)
{
    public static InboundResult Duplicate => new(Trackly.Core.Entities.InboundOutcome.Ignored, null, null);
    public static InboundResult Ignored => new(Trackly.Core.Entities.InboundOutcome.Ignored, null, null);
    public static InboundResult Rejected => new(Trackly.Core.Entities.InboundOutcome.Rejected, null, null);
}
