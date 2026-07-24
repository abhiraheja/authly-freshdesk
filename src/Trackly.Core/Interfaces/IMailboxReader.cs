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

public record MailboxConnection(
    string Host,
    int Port,
    string Username,
    string Password,
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
