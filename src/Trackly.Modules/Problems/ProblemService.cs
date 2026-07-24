using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Problems;

// Problems group related tickets under a root cause. Agent/admin-only (enforced
// by the controller policy); every query is still workspace-scoped here.
public class ProblemService(TracklyDbContext db, NotificationService notifications)
{
    private IQueryable<Problem> Visible(Actor actor) =>
        db.Problems.Where(p => p.WorkspaceId == actor.WorkspaceId);

    public async Task<IReadOnlyList<ProblemSummaryDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await Visible(actor)
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new ProblemSummaryDto(
                p.Id, p.Title, p.Status,
                UserSummaryDto.From(p.Assignee),
                db.Tickets.Count(t => t.ProblemId == p.Id),
                p.CreatedAt, p.UpdatedAt, p.ResolvedAt))
            .ToListAsync(ct);
    }

    public async Task<ProblemDetailDto?> GetAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var problem = await Visible(actor)
            .Include(p => p.Assignee)
            .Include(p => p.CreatedByUser)
            .SingleOrDefaultAsync(p => p.Id == id, ct);
        if (problem is null) return null;

        var tickets = await db.Tickets
            .Where(t => t.ProblemId == id)
            .OrderByDescending(t => t.UpdatedAt)
            .Select(t => new TicketSummaryDto(
                t.Id, t.Subject, t.Status, t.Priority, t.Channel,
                CategoryDto.From(t.Category),
                UserSummaryDto.From(t.Requester),
                t.GuestName, t.GuestEmail,
                UserSummaryDto.From(t.Assignee),
                t.Comments.Count(),
                t.CreatedAt, t.UpdatedAt))
            .ToListAsync(ct);

        return new ProblemDetailDto(
            problem.Id, problem.Title, problem.Description, problem.Status,
            UserSummaryDto.From(problem.Assignee),
            UserSummaryDto.From(problem.CreatedByUser),
            tickets,
            problem.CreatedAt, problem.UpdatedAt, problem.ResolvedAt);
    }

    public async Task<ProblemDetailDto> CreateAsync(Actor actor, CreateProblemRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Title))
            throw new ArgumentException("Title is required.");

        var problem = new Problem
        {
            WorkspaceId = actor.WorkspaceId,
            Title = req.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
            CreatedBy = actor.UserId,
            AssigneeId = await ValidateAssigneeAsync(actor, req.AssigneeId, ct),
        };
        db.Problems.Add(problem);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(actor, problem.Id, ct))!;
    }

    public async Task<ProblemDetailDto?> UpdateAsync(Actor actor, Guid id, UpdateProblemRequest req, CancellationToken ct)
    {
        var problem = await Visible(actor).SingleOrDefaultAsync(p => p.Id == id, ct);
        if (problem is null) return null;

        if (req.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Title)) throw new ArgumentException("Title cannot be empty.");
            problem.Title = req.Title.Trim();
        }
        if (req.Description is not null)
            problem.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();
        if (req.Status is not null)
        {
            if (!ProblemStatus.All.Contains(req.Status)) throw new ArgumentException("Invalid status.");
            problem.Status = req.Status;
            problem.ResolvedAt = req.Status == ProblemStatus.Resolved ? DateTime.UtcNow : null;
        }
        if (req.Unassign)
            problem.AssigneeId = null;
        else if (req.AssigneeId is not null)
            problem.AssigneeId = await ValidateAssigneeAsync(actor, req.AssigneeId, ct);

        problem.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, id, ct);
    }

    public async Task<bool> LinkTicketAsync(Actor actor, Guid problemId, Guid ticketId, CancellationToken ct)
    {
        var problemExists = await Visible(actor).AnyAsync(p => p.Id == problemId, ct);
        if (!problemExists) return false;

        // Ticket must belong to the same workspace — never link across tenants.
        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (ticket is null) return false;

        ticket.ProblemId = problemId;
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> UnlinkTicketAsync(Actor actor, Guid ticketId, CancellationToken ct)
    {
        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (ticket is null) return false;
        ticket.ProblemId = null;
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<ProblemDetailDto?> ResolveAsync(
        Actor actor, Guid id, bool bulkResolveTickets, CancellationToken ct)
    {
        var problem = await Visible(actor).SingleOrDefaultAsync(p => p.Id == id, ct);
        if (problem is null) return null;

        problem.Status = ProblemStatus.Resolved;
        problem.ResolvedAt = DateTime.UtcNow;
        problem.UpdatedAt = DateTime.UtcNow;

        if (bulkResolveTickets)
        {
            // Resolve every still-open linked ticket in one action, then notify.
            var ticketIds = await db.Tickets
                .Where(t => t.ProblemId == id && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed)
                .Select(t => t.Id)
                .ToListAsync(ct);
            await db.Tickets
                .Where(t => ticketIds.Contains(t.Id))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.Status, TicketStatus.Resolved)
                    .SetProperty(t => t.UpdatedAt, DateTime.UtcNow), ct);
            await db.SaveChangesAsync(ct);

            foreach (var ticketId in ticketIds)
                await notifications.OnStatusChangedAsync(ticketId, TicketStatus.Resolved, ct);
        }
        else
        {
            await db.SaveChangesAsync(ct);
        }

        return await GetAsync(actor, id, ct);
    }

    private async Task<Guid?> ValidateAssigneeAsync(Actor actor, Guid? assigneeId, CancellationToken ct)
    {
        if (assigneeId is null) return null;
        var ok = await db.Users.AnyAsync(u =>
            u.WorkspaceId == actor.WorkspaceId && u.Id == assigneeId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (!ok) throw new ArgumentException("Assignee must be an active agent or admin in this workspace.");
        return assigneeId;
    }
}
