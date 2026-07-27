using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Channels;

// A normalized inbound message from a messaging connector. A provider-native
// relay (Slack Events API / WhatsApp Cloud API / Bot Framework) translates the
// provider envelope into this shape and re-signs with X-Trackly-Signature.
public record InboundChatMessage(
    string ConversationId,   // provider-scoped thread key (channel+thread / phone / conversation id)
    string MessageId,        // provider message id (idempotency)
    string SenderId,         // provider user id
    string? SenderName,
    string? SenderEmail,     // if the relay can resolve one; used to link a known user
    string Text);

public enum ChannelInboundOutcome { NewTicket, Comment, Duplicate, Ignored }

public record ChannelInboundResult(ChannelInboundOutcome Outcome, Guid? TicketId, Guid? CommentId)
{
    public static ChannelInboundResult Duplicate { get; } = new(ChannelInboundOutcome.Duplicate, null, null);
    public static ChannelInboundResult Ignored { get; } = new(ChannelInboundOutcome.Ignored, null, null);
}

// Turns connector messages into tickets/comments, sharing the same principles as
// the Phase 4 email pipeline: HMAC-verified access, idempotent ingest, threading,
// and notifications. Threading is by provider conversation key rather than email
// Message-IDs. Workspace-scoped throughout.
public class ChannelInboundService(
    TracklyDbContext db,
    ISecretProtector secrets,
    TicketService ticketService,
    SlaService sla,
    AutomationService automation,
    NotificationService notifications)
{
    // Verify the webhook signature and resolve the workspace for a provider.
    public async Task<Guid?> ResolveConnectorAsync(
        string provider, string slug, byte[] rawBody, string? signatureHex, CancellationToken ct)
    {
        if (!ChannelProvider.All.Contains(provider)) return null;

        var connector = await db.ChannelConnectors
            .SingleOrDefaultAsync(c => c.Workspace.Slug == slug && c.Provider == provider, ct);
        if (connector is null
            || !connector.Enabled
            || connector.SigningSecretEncrypted is not { Length: > 0 } enc
            || string.IsNullOrEmpty(signatureHex))
            return null;

        var secret = secrets.Unprotect(enc);
        var expected = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), rawBody));
        var provided = signatureHex.Trim().ToLowerInvariant();
        var ok = provided.Length == expected.Length
                 && CryptographicOperations.FixedTimeEquals(
                     Encoding.ASCII.GetBytes(provided), Encoding.ASCII.GetBytes(expected));
        return ok ? connector.WorkspaceId : null;
    }

    public async Task<ChannelInboundResult> ProcessAsync(
        Guid workspaceId, string provider, InboundChatMessage msg, CancellationToken ct)
    {
        var extId = msg.MessageId?.Trim() ?? "";
        var convKey = msg.ConversationId?.Trim() ?? "";
        if (extId.Length == 0 || convKey.Length == 0 || string.IsNullOrWhiteSpace(msg.Text))
            return ChannelInboundResult.Ignored;

        // Fast idempotency check — a retried delivery does nothing.
        if (await db.InboundChannelEvents.AnyAsync(
                e => e.WorkspaceId == workspaceId && e.Provider == provider && e.ExternalMessageId == extId, ct))
            return ChannelInboundResult.Duplicate;

        var conversation = await db.ChannelConversations
            .Include(c => c.Ticket).ThenInclude(t => t.Requester)
            .SingleOrDefaultAsync(
                c => c.WorkspaceId == workspaceId && c.Provider == provider && c.ConversationKey == convKey, ct);

        return conversation is null
            ? await CreateTicketAsync(workspaceId, provider, convKey, extId, msg, ct)
            : await AppendCommentAsync(workspaceId, provider, conversation.Ticket, extId, msg, ct);
    }

    // ---- New conversation → new ticket --------------------------------------

    private async Task<ChannelInboundResult> CreateTicketAsync(
        Guid workspaceId, string provider, string convKey, string extId, InboundChatMessage msg, CancellationToken ct)
    {
        var email = string.IsNullOrWhiteSpace(msg.SenderEmail) ? null : msg.SenderEmail.Trim().ToLowerInvariant();
        var matchedUser = email is null
            ? null
            : await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == email, ct);

        var ticket = new Ticket
        {
            WorkspaceId = workspaceId,
            Subject = Subject(msg.Text, provider),
            Description = msg.Text.Trim(),
            Channel = ChannelProvider.ToTicketChannel(provider),
            RequesterId = matchedUser?.Id,
        };
        if (matchedUser is null)
        {
            ticket.GuestEmail = email;
            ticket.GuestName = msg.SenderName ?? SenderLabel(provider, msg.SenderId);
            ticket.GuestTokenHash = TokenUtils.Sha256Hex(TokenUtils.GenerateToken());
        }
        db.Tickets.Add(ticket);

        var assigneeId = await ticketService.PickRoundRobinAssigneeAsync(workspaceId, null, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment { Ticket = ticket, AssignedTo = assigneeId.Value });
        }
        await automation.RunOnCreateAsync(ticket, ct);
        await sla.ApplyOnCreateAsync(ticket, ct);

        db.ChannelConversations.Add(new ChannelConversation
        {
            WorkspaceId = workspaceId,
            Provider = provider,
            ConversationKey = convKey,
            Ticket = ticket,
        });
        db.InboundChannelEvents.Add(NewEvent(workspaceId, provider, extId));

        if (!await TrySaveAsync(ct))
            return ChannelInboundResult.Duplicate;

        await notifications.OnTicketCreatedAsync(ticket.Id, ct);
        return new ChannelInboundResult(ChannelInboundOutcome.NewTicket, ticket.Id, null);
    }

    // ---- Follow-up message → comment on the threaded ticket -----------------

    private async Task<ChannelInboundResult> AppendCommentAsync(
        Guid workspaceId, string provider, Ticket ticket, string extId, InboundChatMessage msg, CancellationToken ct)
    {
        var email = string.IsNullOrWhiteSpace(msg.SenderEmail) ? null : msg.SenderEmail.Trim().ToLowerInvariant();
        var matchedUser = email is null
            ? null
            : await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == email, ct);
        var authoredByAgent = matchedUser is { Role: TracklyRoles.Agent or TracklyRoles.Admin };

        var comment = new Comment
        {
            TicketId = ticket.Id,
            AuthorId = matchedUser?.Id,
            GuestEmail = matchedUser is null ? (email ?? SenderLabel(provider, msg.SenderId)) : null,
            Body = msg.Text.Trim(),
            IsInternal = false,
            Source = provider,
        };
        db.Comments.Add(comment);
        ticket.UpdatedAt = DateTime.UtcNow;
        if (authoredByAgent) sla.OnAgentReply(ticket);
        db.InboundChannelEvents.Add(NewEvent(workspaceId, provider, extId));

        if (!await TrySaveAsync(ct))
            return ChannelInboundResult.Duplicate;

        await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent, ct);
        return new ChannelInboundResult(ChannelInboundOutcome.Comment, ticket.Id, comment.Id);
    }

    // ---- Helpers -------------------------------------------------------------

    private static InboundChannelEvent NewEvent(Guid workspaceId, string provider, string extId) => new()
    {
        WorkspaceId = workspaceId,
        Provider = provider,
        ExternalMessageId = extId,
    };

    private async Task<bool> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException)
        {
            // Lost the race on a unique index (dedup or conversation key) — another
            // delivery already ingested this; the whole insert rolled back.
            return false;
        }
    }

    private static string Subject(string text, string provider)
    {
        var firstLine = text.Trim().Split('\n', 2)[0].Trim();
        if (firstLine.Length == 0) return $"New {provider} conversation";
        return firstLine.Length <= 80 ? firstLine : firstLine[..77] + "…";
    }

    private static string SenderLabel(string provider, string senderId) => $"{provider}:{senderId}";
}
