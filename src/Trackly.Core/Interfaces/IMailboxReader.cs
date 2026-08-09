namespace Trackly.Core.Interfaces;

// Option B transport: reads a workspace's real mailbox (IMAP now; Graph/Gmail
// later behind the same interface). Keeps MailKit out of Modules — the polling
// worker orchestrates, this fetches and marks messages processed.
public interface IMailboxReader
{
    // Connects, hands each unseen message to `handle`, and marks it \Seen only
    // when the handler completes without throwing (so a failed ingest is retried
    // next poll). Returns the number of messages marked processed.
    Task<int> PollAsync(
        MailboxConnection connection,
        Func<FetchedEmail, CancellationToken, Task> handle,
        CancellationToken cancellationToken = default);
}

/// <param name="Password">Null when <paramref name="AccessToken"/> carries the credential.</param>
/// <param name="AccessToken">
/// An OAuth access token, authenticated with SASL XOAUTH2 instead of a password.
///
/// A nullable field rather than a discriminator: exactly one of the two is ever
/// set, so the transport branches on `AccessToken is not null` in one place. It
/// is short-lived by design — resolve the connection immediately before use and
/// never cache one.
/// </param>
public record MailboxConnection(
    string Host,
    int Port,
    string Username,
    string? Password,
    string? AccessToken = null,
    bool UseSsl = true);

public record FetchedEmail(
    string Uid,
    string MessageId,
    string FromEmail,
    string? FromName,
    string ToAddress,
    string Subject,
    string TextBody,
    IReadOnlyList<string> ReferenceIds,
    IReadOnlyList<FetchedAttachment> Attachments);

public record FetchedAttachment(string FileName, string ContentType, byte[] Content);
