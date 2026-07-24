namespace Trackly.Core.Interfaces;

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

// A single outbound email. The From/Reply-To/Message-ID/In-Reply-To fields drive
// reply threading for ticket notifications (see the Email Architecture section of
// the plan): Reply-To carries the reply+<ticket-uuid> address, Message-ID is
// stored on the comment so an inbound In-Reply-To can be matched back to it.
public record EmailMessage(
    string ToEmail,
    string Subject,
    string TextBody,
    string? HtmlBody = null,
    string? ToName = null,
    string? FromEmail = null,
    string? FromName = null,
    string? ReplyTo = null,
    string? MessageId = null,
    string? InReplyTo = null);
