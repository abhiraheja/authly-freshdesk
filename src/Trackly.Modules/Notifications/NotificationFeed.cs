using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Notifications;

/// <summary>
/// The bell: what happened on Trackly that somebody should know about.
///
/// Deliberately not the same thing as <c>Email.NotificationService</c>. Email is
/// for people who are not looking at Trackly; this is for people who are. Some
/// events write both — a mention is exactly the thing that should reach you
/// whichever one you are watching — and some write only here, because a
/// notification per field change would be an unsubscribe request by Tuesday.
///
/// Every write is best-effort in the sense that the caller has already committed
/// the thing being announced. A bell row that fails to insert must not undo a
/// reply that was sent.
/// </summary>
public class NotificationFeed(TracklyDbContext db)
{
    /// <summary>How many rows the bell will ever show. Older ones are history, not a queue.</summary>
    private const int MaxFeed = 50;

    private const int PreviewLength = 180;

    public async Task<IReadOnlyList<NotificationDto>> ListAsync(
        Actor actor, bool unreadOnly, CancellationToken ct)
    {
        var query = db.Notifications
            .Where(n => n.UserId == actor.UserId && n.WorkspaceId == actor.WorkspaceId);
        if (unreadOnly) query = query.Where(n => n.ReadAt == null);

        var rows = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(MaxFeed)
            .Include(n => n.Actor)
            .Include(n => n.Ticket)
            .ToListAsync(ct);

        return rows.Select(n => new NotificationDto(
            n.Id,
            n.Type,
            n.TicketId,
            // The subject rather than the id, because the bell is read at a
            // glance and "#019fda…" tells nobody anything.
            n.Ticket?.Subject,
            UserSummaryDto.From(n.Actor),
            n.Preview,
            n.ReadAt is not null,
            n.CreatedAt)).ToList();
    }

    public Task<int> UnreadCountAsync(Actor actor, CancellationToken ct) =>
        db.Notifications.CountAsync(
            n => n.UserId == actor.UserId && n.WorkspaceId == actor.WorkspaceId && n.ReadAt == null,
            ct);

    public async Task<bool> MarkReadAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var changed = await db.Notifications
            .Where(n => n.Id == id && n.UserId == actor.UserId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow), ct);
        return changed > 0;
    }

    public Task MarkAllReadAsync(Actor actor, CancellationToken ct) =>
        db.Notifications
            .Where(n => n.UserId == actor.UserId && n.WorkspaceId == actor.WorkspaceId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow), ct);

    // ---- Writing ---------------------------------------------------------------

    /// <summary>
    /// Queues rows for the given recipients. Does NOT save — the caller commits
    /// them alongside whatever they are announcing, so a bell row can never
    /// describe a reply that failed to send.
    ///
    /// The actor is dropped from the recipients. Being told about your own typing
    /// is the fastest way to teach somebody to ignore the bell.
    /// </summary>
    public void Queue(
        Guid workspaceId,
        IEnumerable<Guid> recipients,
        string type,
        Guid? actorId,
        Guid? ticketId,
        Guid? commentId = null,
        string? preview = null)
    {
        foreach (var userId in recipients.Distinct().Where(id => id != actorId))
        {
            db.Notifications.Add(new Notification
            {
                WorkspaceId = workspaceId,
                UserId = userId,
                Type = type,
                ActorId = actorId,
                TicketId = ticketId,
                CommentId = commentId,
                Preview = Shorten(preview),
            });
        }
    }

    /// <summary>
    /// Everyone watching a ticket, plus its assignee.
    ///
    /// The assignee is included without being a watcher because they are the one
    /// person who certainly needs to know — asking them to watch their own ticket
    /// would be a step nobody remembers to take.
    /// </summary>
    public async Task<List<Guid>> InterestedAsync(Guid ticketId, CancellationToken ct)
    {
        var watchers = await db.TicketWatchers
            .Where(w => w.TicketId == ticketId)
            .Select(w => w.AgentId)
            .ToListAsync(ct);

        var assignee = await db.Tickets
            .Where(t => t.Id == ticketId)
            .Select(t => t.AssigneeId)
            .SingleOrDefaultAsync(ct);
        if (assignee is { } id && !watchers.Contains(id)) watchers.Add(id);

        return watchers;
    }

    /// <summary>
    /// A one-line extract, never markup. The bell renders it as text; sending it
    /// HTML would either show tags or need a second sanitised surface.
    /// </summary>
    private static string? Shorten(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var clean = text.Trim();
        return clean.Length <= PreviewLength ? clean : clean[..PreviewLength].TrimEnd() + "…";
    }
}

public record NotificationDto(
    Guid Id,
    string Type,
    Guid? TicketId,
    string? TicketSubject,
    UserSummaryDto? Actor,
    string? Preview,
    bool IsRead,
    DateTime CreatedAt);
