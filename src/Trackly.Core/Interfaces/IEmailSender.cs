namespace Trackly.Core.Interfaces;

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

public record EmailMessage(
    string ToEmail,
    string Subject,
    string TextBody,
    string? HtmlBody = null,
    string? ToName = null);
