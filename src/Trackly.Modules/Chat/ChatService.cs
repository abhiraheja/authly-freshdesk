using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Chat;

public record ChatStartResult(Guid SessionId, string Token, Guid WorkspaceId);
public record ChatEndResult(Guid TicketId, Guid WorkspaceId);
public record ChatMessageDto(Guid Id, Guid SessionId, string Sender, string? AuthorName, string Body, string CreatedAt);
public record ChatSessionDto(
    Guid Id, string? VisitorName, string? VisitorEmail, string Status,
    Guid? AgentId, string? AgentName, Guid? TicketId, int MessageCount, string CreatedAt);
public record ChatThread(ChatSessionDto Session, IReadOnlyList<ChatMessageDto> Messages);

// Live-chat persistence + transcript-to-ticket. The SignalR hub layers real-time
// delivery on top; this service is the source of truth and works over REST alone.
// Visitor calls are authenticated by the session token; agent calls by the actor
// (workspace-scoped). Private notes never apply here — chat is customer-facing.
public class ChatService(
    TracklyDbContext db,
    TicketService ticketService,
    SlaService sla,
    AutomationService automation,
    ActivityLog activity,
    NotificationService notifications)
{
    public async Task<ChatStartResult?> StartAsync(string workspaceSlug, string? name, string? email, CancellationToken ct)
    {
        var workspaceId = await db.Workspaces.Where(w => w.Slug == workspaceSlug).Select(w => (Guid?)w.Id).SingleOrDefaultAsync(ct);
        if (workspaceId is null) return null;

        var token = TokenUtils.GenerateToken();
        var session = new ChatSession
        {
            WorkspaceId = workspaceId.Value,
            VisitorName = Clean(name),
            VisitorEmail = Clean(email)?.ToLowerInvariant(),
            VisitorTokenHash = TokenUtils.Sha256Hex(token),
        };
        db.ChatSessions.Add(session);
        db.ChatMessages.Add(new ChatMessage
        {
            Session = session,
            Sender = ChatSender.System,
            Body = $"{session.VisitorName ?? "Visitor"} started a chat.",
        });
        await db.SaveChangesAsync(ct);
        return new ChatStartResult(session.Id, token, workspaceId.Value);
    }

    // ---- Posting -------------------------------------------------------------

    public async Task<(ChatMessageDto Message, Guid WorkspaceId)?> PostVisitorAsync(
        Guid sessionId, string token, string body, CancellationToken ct)
    {
        var session = await ActiveByTokenAsync(sessionId, token, ct);
        if (session is null || string.IsNullOrWhiteSpace(body)) return null;

        var msg = Add(session, ChatSender.Visitor, null, body);
        await db.SaveChangesAsync(ct);
        return (ToDto(msg, session.VisitorName), session.WorkspaceId);
    }

    public async Task<ChatMessageDto?> PostAgentAsync(Actor actor, Guid sessionId, string body, CancellationToken ct)
    {
        var session = await db.ChatSessions
            .SingleOrDefaultAsync(s => s.Id == sessionId && s.WorkspaceId == actor.WorkspaceId, ct);
        if (session is null || session.Status != ChatSessionStatus.Active || string.IsNullOrWhiteSpace(body)) return null;

        session.AgentId ??= actor.UserId; // first agent to reply claims the chat
        var msg = Add(session, ChatSender.Agent, actor.UserId, body);
        await db.SaveChangesAsync(ct);

        var name = await db.Users.Where(u => u.Id == actor.UserId).Select(u => u.Name ?? u.Email).SingleOrDefaultAsync(ct);
        return ToDto(msg, name);
    }

    // ---- Reads ---------------------------------------------------------------

    public async Task<IReadOnlyList<ChatSessionDto>> ListActiveAsync(Actor actor, CancellationToken ct)
    {
        return await db.ChatSessions
            .Where(s => s.WorkspaceId == actor.WorkspaceId && s.Status == ChatSessionStatus.Active)
            .OrderBy(s => s.CreatedAt)
            .Select(s => new ChatSessionDto(
                s.Id, s.VisitorName, s.VisitorEmail, s.Status, s.AgentId,
                s.Agent!.Name ?? s.Agent.Email, s.TicketId, s.Messages.Count, s.CreatedAt.ToString("o")))
            .ToListAsync(ct);
    }

    public Task<ChatThread?> GetForAgentAsync(Actor actor, Guid sessionId, CancellationToken ct)
        => ThreadAsync(s => s.Id == sessionId && s.WorkspaceId == actor.WorkspaceId, ct);

    public async Task<ChatThread?> GetForVisitorAsync(Guid sessionId, string token, CancellationToken ct)
    {
        var hash = TokenUtils.Sha256Hex(token);
        return await ThreadAsync(s => s.Id == sessionId && s.VisitorTokenHash == hash, ct);
    }

    // Validate a visitor's session token for the SignalR hub (must be active).
    public async Task<bool> IsVisitorValidAsync(Guid sessionId, string token, CancellationToken ct)
        => await ActiveByTokenAsync(sessionId, token, ct) is not null;

    public async Task<bool> AgentCanAccessAsync(Actor actor, Guid sessionId, CancellationToken ct)
        => await db.ChatSessions.AnyAsync(s => s.Id == sessionId && s.WorkspaceId == actor.WorkspaceId, ct);

    // ---- Ending → ticket -----------------------------------------------------

    public async Task<ChatEndResult?> EndForVisitorAsync(Guid sessionId, string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var hash = TokenUtils.Sha256Hex(token);
        var session = await LoadWithMessagesAsync(s => s.Id == sessionId && s.VisitorTokenHash == hash, ct);
        return session is null ? null : await EndAsync(session, ct);
    }

    public async Task<ChatEndResult?> EndForAgentAsync(Actor actor, Guid sessionId, CancellationToken ct)
    {
        var session = await LoadWithMessagesAsync(s => s.Id == sessionId && s.WorkspaceId == actor.WorkspaceId, ct);
        return session is null ? null : await EndAsync(session, ct);
    }

    private async Task<ChatEndResult?> EndAsync(ChatSession session, CancellationToken ct)
    {
        if (session.Status == ChatSessionStatus.Ended && session.TicketId is { } existing)
            return new ChatEndResult(existing, session.WorkspaceId); // idempotent

        var conversation = session.Messages.Where(m => m.Sender != ChatSender.System).OrderBy(m => m.CreatedAt).ToList();
        var firstVisitor = conversation.FirstOrDefault(m => m.Sender == ChatSender.Visitor)?.Body;

        var ticket = new Ticket
        {
            WorkspaceId = session.WorkspaceId,
            Subject = Subject(firstVisitor),
            Description = firstVisitor?.Trim() is { Length: > 0 } fv ? fv : "Live chat session.",
            Channel = TicketChannel.Chat,
        };
        // The visitor is a guest; a token is minted for parity with other guest tickets.
        ticket.GuestName = session.VisitorName ?? "Chat visitor";
        ticket.GuestEmail = session.VisitorEmail;
        ticket.GuestTokenHash = TokenUtils.Sha256Hex(TokenUtils.GenerateToken());
        db.Tickets.Add(ticket);

        // Null actor: a chat visitor is a guest, so there is no user row to
        // credit and the entry reads as "Trackly". Queued before automation, so
        // the history opens with the chat becoming a ticket rather than with the
        // rules that fired on it.
        activity.Happened(session.WorkspaceId, ticket.Id, null,
            TicketActivityType.Created, ticket.Subject);

        var assigneeId = session.AgentId ?? await ticketService.PickRoundRobinAssigneeAsync(session.WorkspaceId, null, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment { Ticket = ticket, AssignedTo = assigneeId.Value });
        }
        await automation.RunOnCreateAsync(ticket, ct);
        await sla.ApplyOnCreateAsync(ticket, ct);

        // Replay the transcript as comments, preserving who said what.
        foreach (var m in conversation)
        {
            db.Comments.Add(new Comment
            {
                Ticket = ticket,
                AuthorId = m.Sender == ChatSender.Agent ? m.AuthorId : null,
                GuestEmail = m.Sender == ChatSender.Visitor ? (session.VisitorEmail ?? "chat-visitor") : null,
                Body = m.Body,
                IsInternal = false,
                Source = TicketChannel.Chat,
                CreatedAt = m.CreatedAt,
            });
        }

        session.Status = ChatSessionStatus.Ended;
        session.EndedAt = DateTime.UtcNow;
        session.TicketId = ticket.Id;   // Guid key is client-generated on Add

        await db.SaveChangesAsync(ct);
        await notifications.OnTicketCreatedAsync(ticket.Id, ct);
        return new ChatEndResult(ticket.Id, session.WorkspaceId);
    }

    // ---- Helpers -------------------------------------------------------------

    private async Task<ChatSession?> ActiveByTokenAsync(Guid sessionId, string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var hash = TokenUtils.Sha256Hex(token);
        var session = await db.ChatSessions.SingleOrDefaultAsync(s => s.Id == sessionId && s.VisitorTokenHash == hash, ct);
        return session?.Status == ChatSessionStatus.Active ? session : null;
    }

    private ChatMessage Add(ChatSession session, string sender, Guid? authorId, string body)
    {
        var msg = new ChatMessage { SessionId = session.Id, Sender = sender, AuthorId = authorId, Body = body.Trim() };
        db.ChatMessages.Add(msg);
        return msg;
    }

    private async Task<ChatThread?> ThreadAsync(
        System.Linq.Expressions.Expression<Func<ChatSession, bool>> predicate, CancellationToken ct)
    {
        var session = await db.ChatSessions
            .Where(predicate)
            .Select(s => new ChatSessionDto(
                s.Id, s.VisitorName, s.VisitorEmail, s.Status, s.AgentId,
                s.Agent!.Name ?? s.Agent.Email, s.TicketId, s.Messages.Count, s.CreatedAt.ToString("o")))
            .SingleOrDefaultAsync(ct);
        if (session is null) return null;

        var raw = await db.ChatMessages
            .Where(m => m.SessionId == session.Id)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new { m.Id, m.Sender, m.AuthorId, m.Body, m.CreatedAt })
            .ToListAsync(ct);
        var authorIds = raw.Where(m => m.AuthorId != null).Select(m => m.AuthorId!.Value).Distinct().ToList();
        var names = await db.Users.Where(u => authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Name ?? u.Email, ct);
        var messages = raw
            .Select(m => new ChatMessageDto(
                m.Id, session.Id, m.Sender, m.AuthorId is { } a ? names.GetValueOrDefault(a) : null,
                m.Body, m.CreatedAt.ToString("o")))
            .ToList();
        return new ChatThread(session, messages);
    }

    private Task<ChatSession?> LoadWithMessagesAsync(
        System.Linq.Expressions.Expression<Func<ChatSession, bool>> predicate, CancellationToken ct)
        => db.ChatSessions.Include(s => s.Messages).SingleOrDefaultAsync(predicate, ct);

    private static ChatMessageDto ToDto(ChatMessage m, string? authorName)
        => new(m.Id, m.SessionId, m.Sender, authorName, m.Body, m.CreatedAt.ToString("o"));

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string Subject(string? firstVisitor)
    {
        var line = firstVisitor?.Trim().Split('\n', 2)[0].Trim();
        if (string.IsNullOrEmpty(line)) return "Live chat";
        return line.Length <= 80 ? line : line[..77] + "…";
    }
}
