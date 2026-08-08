using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Notifications;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Finds tickets about to miss an SLA, or already missing one, and tells the
/// people who can do something about it.
///
/// **Two messages, once each.** A warning while there is still time to act, and
/// a breach when there is not. Each ticket gets at most one of each, marked on
/// the row — a sweep that re-derived "is it late" would resend every few minutes
/// until the recipient filtered the whole lot into a folder, at which point the
/// feature is worse than nothing because it looks like it is working.
///
/// **Only tickets somebody can still act on.** Resolved and closed are skipped:
/// the deadline on a finished ticket is a number nobody can move, and a bell row
/// about it is pure noise. Pending is skipped too, because the clock is paused
/// and the ticket is deliberately waiting on somebody else.
/// </summary>
public class SlaBreachService(TracklyDbContext db, NotificationFeed feed)
{
    /// <summary>
    /// How close to the deadline counts as "about to miss it".
    ///
    /// Proportional would be cleverer and worse: 10% of a four-hour target is 24
    /// minutes and 10% of a five-day one is most of a day. A fixed window is the
    /// same promise on every ticket — "you have half an hour".
    /// </summary>
    private static readonly TimeSpan WarnWindow = TimeSpan.FromMinutes(30);

    /// <summary>
    /// One sweep. Returns how many notifications were queued.
    ///
    /// Batched hard: a workspace coming back from an outage can have thousands of
    /// tickets go late at once, and a sweep that tried to notify all of them in
    /// one transaction would hold a lock long enough to stall the API.
    /// </summary>
    public async Task<int> SweepAsync(CancellationToken ct, int batchSize = 200)
    {
        var now = DateTime.UtcNow;
        var warnFrom = now.Add(WarnWindow);

        var candidates = await db.Tickets
            .Where(t => t.StatusCategory != TicketStatusCategory.Resolved
                        && t.StatusCategory != TicketStatusCategory.Closed
                        // Paused: the clock is deliberately stopped and the
                        // deadline has already been pushed out.
                        && t.StatusCategory != TicketStatusCategory.Pending
                        // Something has to be due at all.
                        && ((t.FirstResponseDueAt != null && t.FirstResponseAt == null)
                            || t.ResolveDueAt != null)
                        // And it has to be within the warning window at least.
                        && ((t.FirstResponseDueAt != null && t.FirstResponseAt == null
                             && t.FirstResponseDueAt <= warnFrom)
                            || (t.ResolveDueAt != null && t.ResolveDueAt <= warnFrom))
                        // Nothing to say if both messages have already gone.
                        && (t.SlaWarningSentAt == null || t.SlaBreachSentAt == null))
            .OrderBy(t => t.ResolveDueAt ?? t.FirstResponseDueAt)
            .Take(batchSize)
            .ToListAsync(ct);

        if (candidates.Count == 0) return 0;

        var queued = 0;
        foreach (var ticket in candidates)
        {
            // The nearer of the two deadlines is the one that matters: a ticket
            // that has blown its first response is late whatever the resolve
            // clock says.
            var deadline = Nearest(ticket);
            if (deadline is null) continue;

            var breached = deadline <= now;

            if (breached && ticket.SlaBreachSentAt is null)
            {
                queued += await AnnounceAsync(ticket, NotificationType.SlaBreached, ct);
                ticket.SlaBreachSentAt = now;
                // Stamped too, so a ticket that goes straight past the window —
                // a five-minute target, or a sweep that missed a tick — does not
                // then send a warning about a deadline already gone.
                ticket.SlaWarningSentAt ??= now;
            }
            else if (!breached && ticket.SlaWarningSentAt is null)
            {
                queued += await AnnounceAsync(ticket, NotificationType.SlaWarning, ct);
                ticket.SlaWarningSentAt = now;
            }
        }

        await db.SaveChangesAsync(ct);
        return queued;
    }

    /// <summary>
    /// Clears the markers so a reopened ticket can warn again.
    ///
    /// Called when a ticket comes back from resolved/closed. Without it, a ticket
    /// that breached, was closed, and was reopened a month later would run its
    /// whole second life with nobody ever told it was late.
    /// </summary>
    public static void ClearMarkers(Ticket ticket)
    {
        ticket.SlaWarningSentAt = null;
        ticket.SlaBreachSentAt = null;
    }

    /// <summary>
    /// Tells the assignee, the responders and the watchers.
    ///
    /// **Not the customer.** A missed internal target is a fact about the desk,
    /// not about them, and telling them turns an SLA into a stick they did not
    /// ask for. Nothing here reaches a customer surface (invariant 5).
    /// </summary>
    private async Task<int> AnnounceAsync(Ticket ticket, string type, CancellationToken ct)
    {
        var recipients = await feed.InterestedAsync(ticket.Id, ct);
        if (recipients.Count == 0) return 0;

        // Null actor: nobody did this, a clock ran out.
        feed.Queue(ticket.WorkspaceId, recipients, type, actorId: null, ticket.Id,
            preview: ticket.Subject);
        return recipients.Count;
    }

    private static DateTime? Nearest(Ticket ticket)
    {
        var first = ticket.FirstResponseAt is null ? ticket.FirstResponseDueAt : null;
        var resolve = ticket.ResolveDueAt;
        if (first is null) return resolve;
        if (resolve is null) return first;
        return first < resolve ? first : resolve;
    }
}
