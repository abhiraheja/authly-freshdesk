namespace Trackly.Core.Entities;

// Per-workspace inbound connector for a messaging channel (Slack, WhatsApp,
// Teams). One row per (workspace, provider). The signing secret is stored
// AES-256-GCM encrypted and never returned; inbound webhooks are proven by an
// HMAC-SHA256 signature over the raw body using it (same model as the email
// parse webhook — a provider-native relay re-signs with X-Trackly-Signature).
public class ChannelConnector
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string Provider { get; set; } = null!;             // slack | whatsapp | teams
    public bool Enabled { get; set; }
    public string? SigningSecretEncrypted { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class ChannelProvider
{
    public const string Slack = "slack";
    public const string WhatsApp = "whatsapp";
    public const string Teams = "teams";
    public static readonly string[] All = [Slack, WhatsApp, Teams];

    // The ticket channel a provider's messages land on.
    public static string ToTicketChannel(string provider) => provider switch
    {
        Slack => TicketChannel.Slack,
        WhatsApp => TicketChannel.WhatsApp,
        Teams => TicketChannel.Teams,
        _ => TicketChannel.Chat,
    };
}

// Maps a provider conversation (e.g. Slack channel+thread, a WhatsApp phone
// number, a Teams conversation id) to the Trackly ticket it threads into, so
// follow-up messages append to the same ticket instead of opening new ones.
public class ChannelConversation
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string Provider { get; set; } = null!;
    public string ConversationKey { get; set; } = null!;      // provider-scoped conversation id
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Idempotency ledger for inbound channel messages — a provider retrying a
// delivery must not create a duplicate ticket or comment.
public class InboundChannelEvent
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public string Provider { get; set; } = null!;
    public string ExternalMessageId { get; set; } = null!;
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
}
