using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Dashboard;

public record DashboardStatsDto(
    int Total,
    int Open,
    int Pending,
    int Resolved,
    int Closed,
    int Unassigned,
    int AssignedToMe,
    int OpenProblems,
    // Both are about the signed-in agent. They sit beside AssignedToMe because
    // they answer the same question — "what needs me?" — from two other angles.
    int MentioningMe,
    int WatchedByMe,
    /// <summary>
    /// The caller's open tasks, on tickets that are still going. The third
    /// "needs me" number, and the one that is work rather than reading.
    /// </summary>
    int MyOpenTasks,
    /// <summary>Active customers — the sidebar count beside Customers.</summary>
    int Customers,
    /// <summary>Assets on the register that are still in service.</summary>
    int ActiveAssets,
    /// <summary>
    /// Services with at least one open ticket saying they are fully down.
    ///
    /// The one count in this record that is about the world outside Trackly rather
    /// than about the queue, and the reason it earns a place in the sidebar: an
    /// agent should not have to open a page to find out the payment gateway is off.
    /// </summary>
    int ServicesDown);

// Agent dashboard counts, computed in the database rather than by pulling a page
// of tickets to the client. Workspace-scoped.
public class DashboardService(TracklyDbContext db)
{
    public async Task<DashboardStatsDto> GetStatsAsync(Actor actor, CancellationToken ct)
    {
        var tickets = db.Tickets.Where(t => t.WorkspaceId == actor.WorkspaceId);
        return new DashboardStatsDto(
            await tickets.CountAsync(ct),
            await tickets.CountAsync(t => t.StatusCategory == TicketStatusCategory.Open, ct),
            await tickets.CountAsync(t => t.StatusCategory == TicketStatusCategory.Pending, ct),
            await tickets.CountAsync(t => t.StatusCategory == TicketStatusCategory.Resolved, ct),
            await tickets.CountAsync(t => t.StatusCategory == TicketStatusCategory.Closed, ct),
            await tickets.CountAsync(t => t.AssigneeId == null, ct),
            await tickets.CountAsync(t => t.AssigneeId == actor.UserId, ct),
            await db.Problems.CountAsync(
                p => p.WorkspaceId == actor.WorkspaceId && p.Status != ProblemStatus.Resolved, ct),
            // Distinct tickets, not mentions: being named four times on one
            // ticket is one thing to go and read.
            await tickets.CountAsync(
                t => db.CommentMentions.Any(m => m.TicketId == t.Id && m.UserId == actor.UserId), ct),
            await tickets.CountAsync(t => t.Watchers.Any(w => w.AgentId == actor.UserId), ct),
            // Open tasks assigned to the caller, on tickets that have not ended.
            // A task left over on a resolved ticket is history — counting it would
            // put a number in the sidebar that clicking cannot clear.
            await db.TicketTasks.CountAsync(t =>
                t.WorkspaceId == actor.WorkspaceId
                && t.AssigneeId == actor.UserId
                && t.CompletedAt == null
                && t.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                && t.Ticket.StatusCategory != TicketStatusCategory.Closed, ct),
            // Active only, matching what the Customers list shows by default: a
            // sidebar number that disagreed with the page it opens is worse than no
            // number.
            await db.Users.CountAsync(u =>
                u.WorkspaceId == actor.WorkspaceId
                && u.Role == TracklyRoles.Customer
                && u.IsActive, ct),
            await db.Assets.CountAsync(a => a.WorkspaceId == actor.WorkspaceId && a.IsActive, ct),
            // DISTINCT services, not impact rows: five tickets reporting that
            // payments is down is one thing being down, and a sidebar reading
            // "5 down" during a single incident is how the number stops being read.
            await db.TicketImpactedServices
                .Where(x => x.Level == ServiceImpactLevel.Down
                            && x.Service!.WorkspaceId == actor.WorkspaceId
                            && x.Service.IsActive
                            && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                            && x.Ticket.StatusCategory != TicketStatusCategory.Closed)
                .Select(x => x.ServiceId)
                .Distinct()
                .CountAsync(ct));
    }
}
