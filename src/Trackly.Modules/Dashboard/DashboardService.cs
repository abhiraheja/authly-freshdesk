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
    int OpenProblems);

// Agent dashboard counts, computed in the database rather than by pulling a page
// of tickets to the client. Workspace-scoped.
public class DashboardService(TracklyDbContext db)
{
    public async Task<DashboardStatsDto> GetStatsAsync(Actor actor, CancellationToken ct)
    {
        var tickets = db.Tickets.Where(t => t.WorkspaceId == actor.WorkspaceId);
        return new DashboardStatsDto(
            await tickets.CountAsync(ct),
            await tickets.CountAsync(t => t.Status == TicketStatus.Open, ct),
            await tickets.CountAsync(t => t.Status == TicketStatus.Pending, ct),
            await tickets.CountAsync(t => t.Status == TicketStatus.Resolved, ct),
            await tickets.CountAsync(t => t.Status == TicketStatus.Closed, ct),
            await tickets.CountAsync(t => t.AssigneeId == null, ct),
            await tickets.CountAsync(t => t.AssigneeId == actor.UserId, ct),
            await db.Problems.CountAsync(
                p => p.WorkspaceId == actor.WorkspaceId && p.Status != ProblemStatus.Resolved, ct));
    }
}
