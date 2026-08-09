namespace Trackly.Core.Interfaces;

// Sends a notification using a workspace's own SMTP relay when it has one, or the
// shared deployment-level relay otherwise. Modules decrypt the workspace's stored
// SMTP password and hand it over as plaintext SmtpSettings; MIME/SMTP stays in
// Infrastructure.
public interface IWorkspaceEmailSender
{
    // overrideSmtp == null → use the shared/global relay (or the dev logger).
    Task SendAsync(SmtpSettings? overrideSmtp, EmailMessage message, CancellationToken cancellationToken = default);

    /// <summary>
    /// Connects and authenticates, then hangs up. **Sends nothing.**
    ///
    /// The outbound twin of <see cref="IMailboxReader.PollAsync"/> with a no-op
    /// handler: it answers "do these credentials work" without the side effect of
    /// a message arriving somewhere. Deliberately not the same question as the
    /// email test on `EmailSettingsController`, which delivers a real message and
    /// is the only thing invariant 8 counts — a relay can authenticate perfectly
    /// and still refuse to carry your From address.
    ///
    /// Throws on failure, with the server's own message: "authentication failed"
    /// and "connection refused" are different problems and only the provider can
    /// tell them apart.
    /// </summary>
    Task VerifyAsync(SmtpSettings smtp, CancellationToken cancellationToken = default);
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
