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

public record SmtpSettings(
    string Host,
    int Port,
    string? Username,
    string? Password,
    bool UseStartTls);
