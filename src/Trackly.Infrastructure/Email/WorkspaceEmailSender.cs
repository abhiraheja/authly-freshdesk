using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

// Notification sender that picks the transport per workspace: a workspace's own
// SMTP relay when configured, otherwise the shared deployment relay (or the dev
// logger when no shared host is set). Reuses MimeMessageBuilder so threading
// headers are applied identically on both paths.
public class WorkspaceEmailSender(
    IEmailSender shared,
    IOptions<SmtpOptions> sharedOptions,
    ILogger<WorkspaceEmailSender> logger) : IWorkspaceEmailSender
{
    private readonly SmtpOptions _shared = sharedOptions.Value;

    public async Task SendAsync(SmtpSettings? overrideSmtp, EmailMessage message, CancellationToken cancellationToken = default)
    {
        if (overrideSmtp is null)
        {
            // Shared relay in prod, LoggingEmailSender in dev — both already honor
            // the extended EmailMessage fields.
            await shared.SendAsync(message, cancellationToken);
            return;
        }

        var mime = MimeMessageBuilder.Build(
            message,
            fallbackFromEmail: _shared.FromEmail,
            fallbackFromName: _shared.FromName);

        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(overrideSmtp.Host, overrideSmtp.Port,
                overrideSmtp.UseStartTls ? SecureSocketOptions.StartTlsWhenAvailable : SecureSocketOptions.Auto,
                cancellationToken);
            if (!string.IsNullOrEmpty(overrideSmtp.Username))
                await client.AuthenticateAsync(overrideSmtp.Username, overrideSmtp.Password ?? "", cancellationToken);
            await client.SendAsync(mime, cancellationToken);
            await client.DisconnectAsync(true, cancellationToken);
        }
        catch (Exception ex)
        {
            // A workspace's own relay may be misconfigured; log and swallow so a
            // notification failure never fails the ticket operation that triggered it.
            logger.LogWarning(ex, "Workspace SMTP send to {Host} failed for {To}", overrideSmtp.Host, message.ToEmail);
            throw;
        }
    }
}
