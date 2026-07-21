using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

public class AttachmentService(TracklyDbContext db, IFileStorage storage)
{
    public const long MaxSizeBytes = 10 * 1024 * 1024; // 10 MB, enforced at API level too

    public async Task<AttachmentDto?> UploadAsync(
        Actor actor, Guid ticketId, Guid? commentId,
        string fileName, string contentType, long sizeBytes, Stream content,
        CancellationToken ct)
    {
        if (sizeBytes is <= 0 or > MaxSizeBytes)
            throw new ArgumentException("File must be between 1 byte and 10 MB.");

        var ticket = await db.Tickets
            .Where(t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId)
            .Where(t => actor.IsAgentOrAdmin || t.RequesterId == actor.UserId)
            .SingleOrDefaultAsync(ct);
        if (ticket is null)
            return null;

        if (commentId is not null)
        {
            var comment = await db.Comments
                .SingleOrDefaultAsync(c => c.Id == commentId && c.TicketId == ticketId, ct);
            if (comment is null)
                throw new ArgumentException("Comment does not belong to this ticket.");
            if (comment.IsInternal && !actor.IsAgentOrAdmin)
                throw new UnauthorizedAccessException();
        }

        var storageKey = await storage.SaveAsync(
            $"{actor.WorkspaceId}/{ticketId}", fileName, content, ct);

        var attachment = new Attachment
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticketId,
            CommentId = commentId,
            UploadedBy = actor.UserId,
            FileName = Path.GetFileName(fileName),
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
            SizeBytes = sizeBytes,
            StorageKey = storageKey,
        };
        db.Attachments.Add(attachment);
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return new AttachmentDto(
            attachment.Id, attachment.CommentId, attachment.FileName,
            attachment.ContentType, attachment.SizeBytes, attachment.CreatedAt);
    }

    public async Task<IReadOnlyList<AttachmentDto>?> ListForTicketAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        var visible = await db.Tickets
            .Where(t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId)
            .Where(t => actor.IsAgentOrAdmin || t.RequesterId == actor.UserId)
            .AnyAsync(ct);
        if (!visible)
            return null;

        var attachments = db.Attachments.Where(a => a.TicketId == ticketId);
        // Attachments hanging off a private note are invisible to customers.
        if (!actor.IsAgentOrAdmin)
            attachments = attachments.Where(a =>
                a.CommentId == null || !db.Comments.Any(c => c.Id == a.CommentId && c.IsInternal));

        return await attachments
            .OrderBy(a => a.CreatedAt)
            .Select(a => new AttachmentDto(a.Id, a.CommentId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt))
            .ToListAsync(ct);
    }

    // Visibility-checked download: workspace isolation, requester/agent scoping,
    // and attachments on private notes never reach customers.
    public async Task<(AttachmentDto Meta, Stream Content)?> DownloadAsync(
        Actor actor, Guid attachmentId, CancellationToken ct)
    {
        var attachment = await db.Attachments
            .Include(a => a.Ticket)
            .Include(a => a.Comment)
            .SingleOrDefaultAsync(a => a.Id == attachmentId && a.WorkspaceId == actor.WorkspaceId, ct);
        if (attachment is null)
            return null;

        if (!actor.IsAgentOrAdmin)
        {
            if (attachment.Ticket.RequesterId != actor.UserId)
                return null;
            if (attachment.Comment?.IsInternal == true)
                return null;
        }

        var stream = await storage.OpenReadAsync(attachment.StorageKey, ct);
        var meta = new AttachmentDto(
            attachment.Id, attachment.CommentId, attachment.FileName,
            attachment.ContentType, attachment.SizeBytes, attachment.CreatedAt);
        return (meta, stream);
    }
}
