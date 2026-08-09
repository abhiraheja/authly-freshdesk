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
            using var client = await OpenAsync(overrideSmtp, cancellationToken);
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

    public async Task VerifyAsync(SmtpSettings smtp, CancellationToken cancellationToken = default)
    {
        // Not wrapped in the swallow-and-log above: a failure here *is* the
        // answer the caller asked for, so it has to reach them.
        using var client = await OpenAsync(smtp, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }

    /// <summary>
    /// Connect and authenticate — everything both paths do before they diverge.
    ///
    /// Shared so that a verify cannot pass through a handshake a send would not:
    /// two copies of the TLS mode and the auth branch would eventually disagree,
    /// and the failure would be a green test button on a relay that never
    /// delivers.
    /// </summary>
    private static async Task<SmtpClient> OpenAsync(SmtpSettings smtp, CancellationToken cancellationToken)
    {
        var client = new SmtpClient();
        try
        {
            await client.ConnectAsync(smtp.Host, smtp.Port,
                smtp.UseStartTls ? SecureSocketOptions.StartTlsWhenAvailable : SecureSocketOptions.Auto,
                cancellationToken);
            // XOAUTH2 when a token was resolved, password otherwise — the same
            // single branch as ImapMailboxReader, and for the same reason.
            if (smtp.AccessToken is { Length: > 0 } accessToken)
                await client.AuthenticateAsync(
                    new SaslMechanismOAuth2(smtp.Username ?? "", accessToken), cancellationToken);
            else if (!string.IsNullOrEmpty(smtp.Username))
                await client.AuthenticateAsync(smtp.Username, smtp.Password ?? "", cancellationToken);
            return client;
        }
        catch
        {
            // The caller never receives the client, so nothing else can dispose it.
            client.Dispose();
            throw;
        }
    }
}
