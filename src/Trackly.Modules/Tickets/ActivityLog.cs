using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Writes the ticket's audit trail.
///
/// **Nothing here saves.** Every method queues rows on the context and the
/// caller commits them with the change that caused them, in one transaction. An
/// activity row that landed while the change it describes was rolled back is
/// worse than no row at all — it is a log that lies, and a log nobody can trust
/// is one nobody reads.
///
/// Mirrors <see cref="Notifications.NotificationFeed"/> deliberately: same rule,
/// same reason, so a mutation queues both and saves once.
/// </summary>
public class ActivityLog(TracklyDbContext db)
{
    /// <summary>
    /// Records a change with a before and an after.
    ///
    /// **A no-op is not recorded.** Saving a form re-sends every field, so
    /// without this a single "Save" would stamp a row for priority, category,
    /// team and assignee whether or not any of them moved, and the feed would
    /// be unreadable within a week.
    /// </summary>
    public void Changed(
        Guid workspaceId, Guid ticketId, Guid? actorId, string type, string? from, string? to)
    {
        if (string.Equals(from, to, StringComparison.Ordinal)) return;
        Add(workspaceId, ticketId, actorId, type, from, to);
    }

    /// <summary>
    /// Records something that happened rather than something that changed — a
    /// reply, an attachment, time logged. <paramref name="detail"/> is whatever
    /// the entry needs to be worth reading: a file name, "30m", a watcher.
    /// </summary>
    public void Happened(
        Guid workspaceId, Guid ticketId, Guid? actorId, string type, string? detail = null)
        => Add(workspaceId, ticketId, actorId, type, null, detail);

    private void Add(
        Guid workspaceId, Guid ticketId, Guid? actorId, string type, string? from, string? to)
    {
        db.TicketActivities.Add(new TicketActivity
        {
            WorkspaceId = workspaceId,
            TicketId = ticketId,
            ActorId = actorId,
            Type = type,
            FromLabel = Trim(from),
            ToLabel = Trim(to),
        });
    }

    /// <summary>
    /// The feed for one ticket, oldest first.
    ///
    /// Oldest first, unlike the bell: this is read as a story of what happened
    /// to the ticket, and a story runs forwards. It also puts "created" at the
    /// top, which is where anyone looks for it.
    /// </summary>
    public async Task<IReadOnlyList<TicketActivityDto>> ForTicketAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
        => await db.TicketActivities
            .Where(a => a.WorkspaceId == workspaceId && a.TicketId == ticketId)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .Select(a => new TicketActivityDto(
                a.Id,
                a.Type,
                a.FromLabel,
                a.ToLabel,
                UserSummaryDto.From(a.Actor),
                a.CreatedAt))
            .ToListAsync(ct);

    /// <summary>
    /// Labels are read by people, and a 4 KB paste into the subject would make
    /// one row taller than the rest of the feed put together.
    /// </summary>
    private static string? Trim(string? label)
    {
        if (string.IsNullOrWhiteSpace(label)) return null;
        var value = label.Trim();
        return value.Length <= 200 ? value : value[..200] + "…";
    }
}

/// <param name="Actor">Null means Trackly itself — automation, inbound email, the clock.</param>
public record TicketActivityDto(
    Guid Id,
    string Type,
    string? FromLabel,
    string? ToLabel,
    UserSummaryDto? Actor,
    DateTime CreatedAt);
