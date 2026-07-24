using System.Text;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MailKit.Security;
using MimeKit;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

// IMAP implementation of IMailboxReader. Fetches unseen INBOX messages and marks
// them \Seen after the handler succeeds. Exactly-once across restarts is
// guaranteed by the caller's Message-ID dedup, not by the \Seen flag alone.
public class ImapMailboxReader : IMailboxReader
{
    public async Task<int> PollAsync(
        MailboxConnection connection,
        Func<FetchedEmail, CancellationToken, Task> handle,
        CancellationToken cancellationToken = default)
    {
        using var client = new ImapClient();
        await client.ConnectAsync(connection.Host, connection.Port,
            connection.UseSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls,
            cancellationToken);
        await client.AuthenticateAsync(connection.Username, connection.Password, cancellationToken);

        var inbox = client.Inbox;
        await inbox.OpenAsync(FolderAccess.ReadWrite, cancellationToken);

        var uids = await inbox.SearchAsync(SearchQuery.NotSeen, cancellationToken);
        var processed = 0;
        foreach (var uid in uids)
        {
            var mime = await inbox.GetMessageAsync(uid, cancellationToken);
            var email = Map(uid.ToString(), mime, connection.Username);
            await handle(email, cancellationToken);
            await inbox.AddFlagsAsync(uid, MessageFlags.Seen, silent: true, cancellationToken);
            processed++;
        }

        await client.DisconnectAsync(true, cancellationToken);
        return processed;
    }

    private static FetchedEmail Map(string uid, MimeMessage mime, string mailboxAddress)
    {
        var from = mime.From.Mailboxes.FirstOrDefault();

        // Prefer a reply+<uuid> recipient if the customer replied to one; otherwise
        // the mailbox address (threading then falls back to References).
        var to = mime.To.Mailboxes.Concat(mime.Cc.Mailboxes)
                     .FirstOrDefault(a => a.Address.Contains('+'))?.Address
                 ?? mailboxAddress;

        var references = new List<string>();
        if (!string.IsNullOrEmpty(mime.InReplyTo)) references.Add(mime.InReplyTo);
        references.AddRange(mime.References);

        var body = mime.TextBody ?? HtmlToText(mime.HtmlBody) ?? "";

        var attachments = new List<FetchedAttachment>();
        foreach (var part in mime.Attachments.OfType<MimePart>())
        {
            if (part.Content is null) continue;
            using var ms = new MemoryStream();
            part.Content.DecodeTo(ms);
            attachments.Add(new FetchedAttachment(
                part.FileName ?? "attachment",
                part.ContentType?.MimeType ?? "application/octet-stream",
                ms.ToArray()));
        }

        return new FetchedEmail(
            uid,
            mime.MessageId ?? SyntheticId(mime),
            from?.Address ?? "",
            from?.Name,
            to,
            mime.Subject ?? "",
            body,
            references,
            attachments);
    }

    // Some senders omit Message-ID; derive a stable one so dedup still holds.
    private static string SyntheticId(MimeMessage mime)
    {
        var seed = $"{mime.Date.UtcDateTime:O}|{mime.From}|{mime.Subject}";
        var hash = Convert.ToHexStringLower(
            System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed)));
        return $"{hash[..32]}@imap";
    }

    private static string? HtmlToText(string? html) =>
        html is null ? null : System.Text.RegularExpressions.Regex.Replace(html, "<[^>]+>", " ");
}
