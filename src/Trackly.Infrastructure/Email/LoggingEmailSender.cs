using Microsoft.Extensions.Logging;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

// Development fallback when no SMTP host is configured: writes the email to
// the log so magic links / codes can be exercised end-to-end locally.
public class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        logger.LogInformation(
            "DEV EMAIL (no SMTP configured)\nTo: {To}\nFrom: {From}\nReply-To: {ReplyTo}\nMessage-ID: {MessageId}\nSubject: {Subject}\n{Body}",
            message.ToEmail, message.FromEmail, message.ReplyTo, message.MessageId, message.Subject, message.TextBody);
        return Task.CompletedTask;
    }
}
