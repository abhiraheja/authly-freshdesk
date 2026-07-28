namespace Trackly.Core.Entities;

// A live-chat session opened from a customer-facing surface. The visitor is
// anonymous; a random token (stored hashed) authenticates their side of the
// conversation. When the chat ends, the transcript is turned into a ticket.
public class ChatSession
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string? VisitorName { get; set; }
    public string? VisitorEmail { get; set; }
    public string VisitorTokenHash { get; set; } = null!;   // SHA-256 of the visitor token

    public string Status { get; set; } = ChatSessionStatus.Active;
    public Guid? AgentId { get; set; }                       // the agent who claimed it
    public User? Agent { get; set; }
    public Guid? TicketId { get; set; }                      // set when the transcript is filed

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }

    public ICollection<ChatMessage> Messages { get; set; } = new List<ChatMessage>();
}

public static class ChatSessionStatus
{
    public const string Active = "active";
    public const string Ended = "ended";
}

public class ChatMessage
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public ChatSession Session { get; set; } = null!;

    public string Sender { get; set; } = null!;             // visitor | agent | system
    public Guid? AuthorId { get; set; }                     // agent user id, when sender = agent
    public string Body { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class ChatSender
{
    public const string Visitor = "visitor";
    public const string Agent = "agent";
    public const string System = "system";
}
