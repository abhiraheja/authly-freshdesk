using MimeKit;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

// Turns an EmailMessage into a MimeMessage, applying the threading headers used
// by the inbound pipeline. Shared by the shared-relay sender and the
// per-workspace sender so header handling stays identical.
internal static class MimeMessageBuilder
{
    public static MimeMessage Build(EmailMessage message, string fallbackFromEmail, string fallbackFromName)
    {
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(
            message.FromName ?? fallbackFromName,
            message.FromEmail ?? fallbackFromEmail));
        mime.To.Add(new MailboxAddress(message.ToName ?? message.ToEmail, message.ToEmail));
        mime.Subject = message.Subject;

        if (!string.IsNullOrEmpty(message.ReplyTo))
            mime.ReplyTo.Add(MailboxAddress.Parse(message.ReplyTo));

        // Stamp a stable Message-ID so a customer's reply carries it in
        // In-Reply-To/References — the inbound threading fallback matches on it.
        if (!string.IsNullOrEmpty(message.MessageId))
            mime.MessageId = message.MessageId;
        if (!string.IsNullOrEmpty(message.InReplyTo))
        {
            mime.InReplyTo = message.InReplyTo;
            mime.References.Add(message.InReplyTo);
        }

        var body = new BodyBuilder { TextBody = message.TextBody };
        if (message.HtmlBody is not null)
            body.HtmlBody = message.HtmlBody;
        mime.Body = body.ToMessageBody();
        return mime;
    }
}
