namespace Trackly.Core.Entities;

// Per-workspace email settings (one row per workspace). Secret columns are
// suffixed *_encrypted and hold AES-256-GCM ciphertext via ISecretProtector —
// never plaintext, never returned to a client.
public class EmailConfig
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    // ---- Outbound ----
    public bool UseSharedSmtp { get; set; } = true;
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
    public string? SmtpUser { get; set; }
    public string? SmtpPasswordEncrypted { get; set; }
    public bool SmtpUseStartTls { get; set; } = true;
    public string? FromName { get; set; }
    public string? FromEmail { get; set; }

    // ---- Interaction mode ----
    public string EmailMode { get; set; } = Entities.EmailMode.NotificationsOnly;
    public bool NewTicketViaEmail { get; set; }

    // ---- Inbound connector: admin picks ONE ----
    public string? InboundConnector { get; set; }   // null | parse_webhook | mailbox_poll

    // Option A — parse webhook
    public string? InboundProvider { get; set; }     // sendgrid | mailgun | postmark | ses
    public string? InboundReplyDomain { get; set; }  // e.g. tickets.acme.com
    public string? InboundWebhookSecretEncrypted { get; set; }

    // Option B — mailbox polling
    public string? MailboxProtocol { get; set; }     // imap | ms_graph | gmail_api
    public string? MailboxAddress { get; set; }      // e.g. support@acme.com
    public string? MailboxHost { get; set; }         // IMAP host
    public int? MailboxPort { get; set; }
    public string? MailboxUsername { get; set; }
    public string? MailboxPasswordEncrypted { get; set; }
    public string? MailboxOauthTokensEncrypted { get; set; }
    public int PollIntervalSeconds { get; set; } = 60;
    public DateTime? LastPolledAt { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class EmailMode
{
    public const string NotificationsOnly = "notifications_only";
    public const string OneWay = "one_way";
    public const string TwoWay = "two_way";
    public static readonly string[] All = [NotificationsOnly, OneWay, TwoWay];
}

public static class InboundConnector
{
    public const string ParseWebhook = "parse_webhook";
    public const string MailboxPoll = "mailbox_poll";
    public static readonly string[] All = [ParseWebhook, MailboxPoll];
}

public static class InboundProvider
{
    public const string SendGrid = "sendgrid";
    public const string Mailgun = "mailgun";
    public const string Postmark = "postmark";
    public const string Ses = "ses";
    public static readonly string[] All = [SendGrid, Mailgun, Postmark, Ses];
}

public static class MailboxProtocol
{
    public const string Imap = "imap";
    public const string MsGraph = "ms_graph";
    public const string GmailApi = "gmail_api";
    public static readonly string[] All = [Imap, MsGraph, GmailApi];
}
