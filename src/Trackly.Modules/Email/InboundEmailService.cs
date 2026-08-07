using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Email;

// The shared inbound pipeline: one path for every connector. Given a workspace
// and a normalised InboundMessage it resolves the ticket, authenticates the
// sender, strips quoted history, stores attachments, and inserts an email
// comment (or a new ticket) — exactly once. The idempotency row is written in the
// SAME SaveChanges as the comment/ticket, so a duplicate provider Message-ID
// trips the unique (workspace_id, message_id) index and rolls the whole insert
// back rather than creating a second comment.
public class InboundEmailService(
    TracklyDbContext db,
    IWorkspaceFileStorage storage,
    ISecretProtector secrets,
    NotificationService notifications,
    TicketService ticketService,
    SlaService sla,
    AutomationService automation,
    ILogger<InboundEmailService> logger)
{
    // ---- Option A webhook entry ---------------------------------------------

    // Verifies the provider signature against the workspace's stored secret and
    // returns the workspace id, or null if the workspace/connector/signature is
    // not valid. HMAC-SHA256 over the exact raw request body.
    public async Task<Guid?> ResolveWebhookWorkspaceAsync(
        string slug, byte[] rawBody, string? signatureHex, CancellationToken ct)
    {
        var config = await db.EmailConfigs
            .SingleOrDefaultAsync(c => c.Workspace!.Slug == slug, ct);
        if (config is null
            || config.InboundConnector != InboundConnector.ParseWebhook
            || config.InboundWebhookSecretEncrypted is not { Length: > 0 } enc)
            return null;

        if (string.IsNullOrEmpty(signatureHex))
            return null;

        var secret = secrets.Unprotect(enc);
        var expected = Convert.ToHexStringLower(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), rawBody));

        // Constant-time compare to avoid a signature-timing oracle.
        var provided = signatureHex.Trim().ToLowerInvariant();
        var ok = provided.Length == expected.Length
                 && CryptographicOperations.FixedTimeEquals(
                     Encoding.ASCII.GetBytes(provided), Encoding.ASCII.GetBytes(expected));
        return ok ? config.WorkspaceId : null;
    }

    // ---- Shared pipeline -----------------------------------------------------

    public async Task<InboundResult> ProcessAsync(Guid workspaceId, InboundMessage rawMsg, CancellationToken ct)
    {
        // Canonicalise every Message-ID (strip angle brackets) so ids from any
        // transport match the bracket-free form outbound stores on comments.
        var msg = rawMsg with
        {
            MessageId = NormalizeId(rawMsg.MessageId),
            ReferenceIds = rawMsg.ReferenceIds.Select(NormalizeId).Where(s => s.Length > 0).ToList(),
        };
        var from = msg.FromEmail.Trim().ToLowerInvariant();

        // (a) Fast idempotency check — a definitive duplicate skips all work.
        var already = await db.InboundEmailEvents
            .AnyAsync(e => e.WorkspaceId == workspaceId && e.MessageId == msg.MessageId, ct);
        if (already)
            return InboundResult.Duplicate;

        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);

        // (b) Resolve the ticket.
        var ticket = await ResolveTicketAsync(workspaceId, msg, ct);

        if (ticket is null)
        {
            if (config?.NewTicketViaEmail != true)
                return await RecordOnlyAsync(workspaceId, msg.MessageId, InboundOutcome.Ignored, null, null, ct);
            return await CreateTicketFromEmailAsync(workspaceId, from, msg, ct);
        }

        // (c) Authenticate the sender against this ticket.
        var matchedUser = await db.Users
            .SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == from, ct);
        var authoredByAgent = matchedUser is not null
            && (matchedUser.Role == TracklyRoles.Agent || matchedUser.Role == TracklyRoles.Admin);

        var isParticipant =
            from == ticket.GuestEmail?.ToLowerInvariant()
            || (ticket.Requester?.Email is { } re && re.ToLowerInvariant() == from)
            || authoredByAgent
            || await db.Comments.AnyAsync(c => c.TicketId == ticket.Id
                && (c.GuestEmail == from || (c.Author != null && c.Author.Email == from)), ct);

        if (!isParticipant)
        {
            logger.LogWarning("Inbound rejected: {From} is not a participant on ticket {TicketId}", from, ticket.Id);
            return await RecordOnlyAsync(workspaceId, msg.MessageId, InboundOutcome.Rejected, ticket.Id, null, ct);
        }

        // (d)+(e) Insert the comment + its idempotency row atomically.
        var comment = new Comment
        {
            TicketId = ticket.Id,
            AuthorId = matchedUser?.Id,               // null → treated as guest reply
            GuestEmail = matchedUser is null ? from : null,
            Body = QuotedReplyStripper.Strip(msg.TextBody),
            IsInternal = false,
            Source = CommentSource.Email,
            EmailMessageId = msg.MessageId,
        };
        db.Comments.Add(comment);                     // comment.Id assigned client-side here
        ticket.UpdatedAt = DateTime.UtcNow;
        if (authoredByAgent)
            sla.OnAgentReply(ticket);                 // an agent replying by email is a first response too
        db.InboundEmailEvents.Add(NewEvent(workspaceId, msg.MessageId, InboundOutcome.Comment, ticket.Id, comment.Id));

        if (!await TrySaveAsync(ct))
            return InboundResult.Duplicate;            // unique index rolled back comment + event

        await SaveAttachmentsAsync(ticket, comment.Id, msg.Attachments, ct);
        await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent, ct);
        return new InboundResult(InboundOutcome.Comment, ticket.Id, comment.Id);
    }

    // ---- Ticket resolution ---------------------------------------------------

    private async Task<Ticket?> ResolveTicketAsync(Guid workspaceId, InboundMessage msg, CancellationToken ct)
    {
        // 1st: ticket UUID encoded in the reply+<uuid>@ address.
        if (TicketIdFromReplyAddress(msg.ToAddress) is Guid tid)
        {
            var byAddr = await LoadTicketAsync(workspaceId, tid, ct);
            if (byAddr is not null) return byAddr;
        }

        var refs = msg.ReferenceIds.ToList(); // already normalised in ProcessAsync
        if (refs.Count == 0) return null;

        // 2nd: In-Reply-To / References matched against a stored comment id.
        var byComment = await db.Comments
            .Where(c => c.Ticket.WorkspaceId == workspaceId
                        && c.EmailMessageId != null && refs.Contains(c.EmailMessageId))
            .Select(c => c.TicketId)
            .FirstOrDefaultAsync(ct);
        if (byComment != Guid.Empty)
            return await LoadTicketAsync(workspaceId, byComment, ct);

        // 2nd (fallback): parse the ticket id out of our own <tid.cid@trackly> id,
        // handling clients that keep References but mangle Reply-To.
        foreach (var reference in refs)
        {
            if (TicketIdFromTrackedMessageId(reference) is Guid rtid)
            {
                var t = await LoadTicketAsync(workspaceId, rtid, ct);
                if (t is not null) return t;
            }
        }
        return null;
    }

    private Task<Ticket?> LoadTicketAsync(Guid workspaceId, Guid ticketId, CancellationToken ct) =>
        db.Tickets.Include(t => t.Requester)
            .SingleOrDefaultAsync(t => t.WorkspaceId == workspaceId && t.Id == ticketId, ct);

    internal static Guid? TicketIdFromReplyAddress(string to)
    {
        var at = to.IndexOf('@');
        if (at <= 0) return null;
        var local = to[..at];
        var plus = local.IndexOf('+');
        if (plus < 0) return null;
        return Guid.TryParseExact(local[(plus + 1)..], "N", out var g) ? g : null;
    }

    internal static string NormalizeId(string id) =>
        id.Trim().TrimStart('<').TrimEnd('>').Trim();

    internal static Guid? TicketIdFromTrackedMessageId(string messageId)
    {
        // {tid:N}.{cid:N}@trackly
        var s = NormalizeId(messageId);
        if (!s.EndsWith("@trackly", StringComparison.OrdinalIgnoreCase)) return null;
        var dot = s.IndexOf('.');
        var head = dot > 0 ? s[..dot] : s.Split('@')[0];
        return Guid.TryParseExact(head, "N", out var g) ? g : null;
    }

    // ---- New ticket from a cold / unmatched email ----------------------------

    private async Task<InboundResult> CreateTicketFromEmailAsync(
        Guid workspaceId, string from, InboundMessage msg, CancellationToken ct)
    {
        var matchedUser = await db.Users
            .SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == from, ct);

        var ticket = new Ticket
        {
            WorkspaceId = workspaceId,
            Subject = QuotedReplyStripper.CleanSubject(msg.Subject),
            Description = QuotedReplyStripper.Strip(msg.TextBody),
            Channel = TicketChannel.Email,
            RequesterId = matchedUser?.Id,
        };
        if (matchedUser is null)
        {
            // Unknown sender → guest ticket. The email itself proves address
            // ownership, so no OTP; a guest magic-link token is minted for the view.
            var guestToken = TokenUtils.GenerateToken();
            ticket.GuestEmail = from;
            ticket.GuestName = msg.FromName;
            ticket.GuestTokenHash = TokenUtils.Sha256Hex(guestToken);
        }
        db.Tickets.Add(ticket);                        // ticket.Id assigned client-side here

        var assigneeId = await ticketService.PickRoundRobinAssigneeAsync(workspaceId, null, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment { Ticket = ticket, AssignedTo = assigneeId.Value });
        }
        await automation.RunOnCreateAsync(ticket, ct);
        await sla.ApplyOnCreateAsync(ticket, ct);
        db.InboundEmailEvents.Add(NewEvent(workspaceId, msg.MessageId, InboundOutcome.NewTicket, ticket.Id, null));

        if (!await TrySaveAsync(ct))
            return InboundResult.Duplicate;

        await SaveAttachmentsAsync(ticket, null, msg.Attachments, ct);
        await notifications.OnTicketCreatedAsync(ticket.Id, ct);
        return new InboundResult(InboundOutcome.NewTicket, ticket.Id, null);
    }

    // ---- Persistence helpers -------------------------------------------------

    private static InboundEmailEvent NewEvent(
        Guid workspaceId, string messageId, string outcome, Guid? ticketId, Guid? commentId) => new()
    {
        WorkspaceId = workspaceId,
        MessageId = messageId,
        TicketId = ticketId,
        CommentId = commentId,
        Outcome = outcome,
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
            // Lost the race on the unique (workspace_id, message_id) index; the
            // whole insert (comment/ticket + event) rolled back. Another worker or
            // webhook already ingested this message.
            return false;
        }
    }

    private async Task<InboundResult> RecordOnlyAsync(
        Guid workspaceId, string messageId, string outcome, Guid? ticketId, Guid? commentId, CancellationToken ct)
    {
        db.InboundEmailEvents.Add(NewEvent(workspaceId, messageId, outcome, ticketId, commentId));
        if (!await TrySaveAsync(ct))
            return InboundResult.Duplicate;
        return new InboundResult(outcome, ticketId, commentId);
    }

    private async Task SaveAttachmentsAsync(
        Ticket ticket, Guid? commentId, IReadOnlyList<InboundAttachment> attachments, CancellationToken ct)
    {
        foreach (var a in attachments)
        {
            if (a.Content.LongLength is <= 0 or > AttachmentService.MaxSizeBytes) continue;
            await using var stream = new MemoryStream(a.Content);
            var key = await storage.SaveAsync(
                ticket.WorkspaceId, $"{ticket.WorkspaceId}/{ticket.Id}", a.FileName, stream, ct: ct);
            db.Attachments.Add(new Attachment
            {
                WorkspaceId = ticket.WorkspaceId,
                TicketId = ticket.Id,
                CommentId = commentId,
                UploadedBy = null,
                FileName = Path.GetFileName(a.FileName),
                ContentType = string.IsNullOrWhiteSpace(a.ContentType) ? "application/octet-stream" : a.ContentType,
                SizeBytes = a.Content.Length,
                StorageKey = key,
            });
        }
        if (attachments.Count > 0)
            await db.SaveChangesAsync(ct);
    }
}
