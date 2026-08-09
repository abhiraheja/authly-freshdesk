using Microsoft.Extensions.Logging;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

// Development fallback when no SMTP host is configured: writes the email to
// the log so magic links / codes can be exercised end-to-end locally.
public class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        // The text part is printed because it is the readable one — a magic link
        // is meant to be copied out of here. The HTML part is only *counted*: a
        // branded email is ~4 kB of table markup that would bury every other log
        // line, but "was there one at all" is the question someone debugging a
        // plain-looking email actually has.
        logger.LogInformation(
            "DEV EMAIL (no SMTP configured)\nTo: {To}\nFrom: {From}\nReply-To: {ReplyTo}\nMessage-ID: {MessageId}\nHTML part: {HtmlPart}\nSubject: {Subject}\n{Body}",
            message.ToEmail, message.FromEmail, message.ReplyTo, message.MessageId,
            message.HtmlBody is { Length: > 0 } html ? $"yes ({html.Length} chars)" : "none",
            message.Subject, message.TextBody);
        return Task.CompletedTask;
    }
}
