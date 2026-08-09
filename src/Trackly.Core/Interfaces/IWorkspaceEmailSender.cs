namespace Trackly.Core.Interfaces;

// Sends a notification using a workspace's own SMTP relay when it has one, or the
// shared deployment-level relay otherwise. Modules decrypt the workspace's stored
// SMTP password and hand it over as plaintext SmtpSettings; MIME/SMTP stays in
// Infrastructure.
public interface IWorkspaceEmailSender
{
    // overrideSmtp == null → use the shared/global relay (or the dev logger).
    Task SendAsync(SmtpSettings? overrideSmtp, EmailMessage message, CancellationToken cancellationToken = default);
}

/// <param name="AccessToken">
/// An OAuth access token, authenticated with SASL XOAUTH2 instead of a password —
/// see <see cref="MailboxConnection.AccessToken"/> for why it is a nullable field
/// rather than a mode. Short-lived: resolve it per send, never hold one.
/// </param>
public record SmtpSettings(
    string Host,
    int Port,
    string? Username,
    string? Password,
    bool UseStartTls,
    string? AccessToken = null);
