using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// The checklist on a ticket, and the people working it alongside the assignee.
///
/// Two small features in one service because they are the same shape — a short
/// agent-facing list hanging off a ticket, with the same permission rule and the
/// same activity entries — and two files of forty lines each would be two places
/// to look for one screen.
///
/// Agent-facing throughout (invariant 5): a customer has no business reading the
/// steps their ticket was broken into or who was pulled in to help.
/// </summary>
public class TicketTaskService(TracklyDbContext db, ActivityLog activity)
{
    private const int MaxTitleLength = 300;

    // ---- Tasks ---------------------------------------------------------------

    public async Task<IReadOnlyList<TicketTaskDto>?> ListAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await ExistsAsync(actor, ticketId, ct)) return null;

        // Open first, then the admin's order. A checklist is read to find what
        // is left, so the done half sinking to the bottom is the whole point.
        return await db.TicketTasks
            .Where(t => t.WorkspaceId == actor.WorkspaceId && t.TicketId == ticketId)
            .OrderBy(t => t.CompletedAt != null).ThenBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
            .Select(t => new TicketTaskDto(
                t.Id, t.Title, UserSummaryDto.From(t.Assignee), t.DueAt,
                t.CompletedAt, UserSummaryDto.From(t.CompletedBy), t.SortOrder, t.CreatedAt))
            .ToListAsync(ct);
    }

    public async Task<TicketTaskDto?> CreateAsync(
        Actor actor, Guid ticketId, string title, Guid? assigneeId, DateTime? dueAt, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        title = Clean(title) ?? throw new ArgumentException("A task needs a title.");
        if (!await ExistsAsync(actor, ticketId, ct)) return null;
        await ValidateAgentAsync(actor, assigneeId, ct);

        var next = await db.TicketTasks
            .Where(t => t.TicketId == ticketId)
            .Select(t => (int?)t.SortOrder)
            .MaxAsync(ct) ?? -1;

        var task = new TicketTask
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticketId,
            Title = title,
            AssigneeId = assigneeId,
            DueAt = dueAt,
            SortOrder = next + 1,
            CreatedById = actor.UserId,
        };
        db.TicketTasks.Add(task);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId, TicketActivityType.TaskAdded, title);
        await db.SaveChangesAsync(ct);

        await db.Entry(task).Reference(t => t.Assignee).LoadAsync(ct);
        return Shape(task);
    }

    /// <summary>
    /// Edits a task. Every argument is optional, and <paramref name="completed"/>
    /// is the tick box.
    ///
    /// <paramref name="clearAssignee"/> and <paramref name="clearDueAt"/> exist
    /// because null means "leave it alone" for everything else here — without
    /// them there would be no way to take a due date back off.
    /// </summary>
    public async Task<TicketTaskDto?> UpdateAsync(
        Actor actor, Guid ticketId, Guid taskId,
        string? title, Guid? assigneeId, bool clearAssignee,
        DateTime? dueAt, bool clearDueAt, bool? completed, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var task = await db.TicketTasks.SingleOrDefaultAsync(
            t => t.Id == taskId && t.TicketId == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (task is null) return null;

        if (Clean(title) is { } newTitle) task.Title = newTitle;

        if (clearAssignee) task.AssigneeId = null;
        else if (assigneeId is not null)
        {
            await ValidateAgentAsync(actor, assigneeId, ct);
            task.AssigneeId = assigneeId;
        }

        if (clearDueAt) task.DueAt = null;
        else if (dueAt is not null) task.DueAt = dueAt;

        // Only on a real change of state: re-saving a ticked task must not
        // re-stamp who ticked it, or the record of who did the work drifts to
        // whoever last opened the screen.
        if (completed is { } wanted && wanted != (task.CompletedAt is not null))
        {
            task.CompletedAt = wanted ? DateTime.UtcNow : null;
            task.CompletedById = wanted ? actor.UserId : null;
            activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
                wanted ? TicketActivityType.TaskCompleted : TicketActivityType.TaskReopened, task.Title);
        }

        await db.SaveChangesAsync(ct);
        await db.Entry(task).Reference(t => t.Assignee).LoadAsync(ct);
        await db.Entry(task).Reference(t => t.CompletedBy).LoadAsync(ct);
        return Shape(task);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid ticketId, Guid taskId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var task = await db.TicketTasks.SingleOrDefaultAsync(
            t => t.Id == taskId && t.TicketId == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (task is null) return false;

        db.TicketTasks.Remove(task);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.TaskRemoved, task.Title);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- Responders ----------------------------------------------------------

    public async Task<IReadOnlyList<TicketResponderDto>?> RespondersAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await ExistsAsync(actor, ticketId, ct)) return null;

        return await db.TicketResponders
            .Where(r => r.TicketId == ticketId)
            .OrderBy(r => r.AddedAt)
            .Select(r => new TicketResponderDto(UserSummaryDto.From(r.Agent)!, r.Role, r.AddedAt))
            .ToListAsync(ct);
    }

    public async Task<bool> AddResponderAsync(
        Actor actor, Guid ticketId, Guid agentId, string? role, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await ExistsAsync(actor, ticketId, ct)) return false;

        var agent = await db.Users.SingleOrDefaultAsync(u =>
            u.Id == agentId && u.WorkspaceId == actor.WorkspaceId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (agent is null)
            throw new ArgumentException("A responder must be an active agent or admin in this workspace.");

        var existing = await db.TicketResponders
            .SingleOrDefaultAsync(r => r.TicketId == ticketId && r.AgentId == agentId, ct);
        if (existing is not null)
        {
            // Adding somebody already on it is how their role gets edited — it is
            // the same action from the agent's point of view, and refusing it
            // would mean removing and re-adding to fix a typo.
            existing.Role = Clean(role);
            await db.SaveChangesAsync(ct);
            return true;
        }

        db.TicketResponders.Add(new TicketResponder
        {
            TicketId = ticketId,
            AgentId = agentId,
            Role = Clean(role),
            AddedBy = actor.UserId,
        });

        // Responders are notified like watchers, so being added means not missing
        // the customer's next reply. A separate watcher row would be a second
        // list saying the same thing that can drift from this one.
        var alreadyWatching = await db.TicketWatchers
            .AnyAsync(w => w.TicketId == ticketId && w.AgentId == agentId, ct);
        if (!alreadyWatching)
            db.TicketWatchers.Add(new TicketWatcher
            {
                TicketId = ticketId,
                AgentId = agentId,
                AddedBy = actor.UserId,
            });

        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.ResponderAdded, agent.Name ?? agent.Email);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Takes somebody off the ticket.
    ///
    /// The watcher row stays. Adding them subscribed them; removing them from the
    /// working set is not the same statement as "stop telling me about this", and
    /// silently unsubscribing somebody is how a handover goes quiet.
    /// </summary>
    public async Task<bool> RemoveResponderAsync(
        Actor actor, Guid ticketId, Guid agentId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var responder = await db.TicketResponders
            .Include(r => r.Agent)
            .SingleOrDefaultAsync(r => r.TicketId == ticketId && r.AgentId == agentId, ct);
        if (responder is null) return false;

        db.TicketResponders.Remove(responder);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.ResponderRemoved, responder.Agent?.Name ?? responder.Agent?.Email);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- Helpers --------------------------------------------------------------

    private Task<bool> ExistsAsync(Actor actor, Guid ticketId, CancellationToken ct) =>
        db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);

    private async Task ValidateAgentAsync(Actor actor, Guid? agentId, CancellationToken ct)
    {
        if (agentId is null) return;
        var ok = await db.Users.AnyAsync(u =>
            u.Id == agentId && u.WorkspaceId == actor.WorkspaceId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (!ok) throw new ArgumentException("Tasks can only be assigned to an active agent or admin.");
    }

    private static string? Clean(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= MaxTitleLength ? trimmed : trimmed[..MaxTitleLength];
    }

    private static TicketTaskDto Shape(TicketTask t) =>
        new(t.Id, t.Title, UserSummaryDto.From(t.Assignee), t.DueAt,
            t.CompletedAt, UserSummaryDto.From(t.CompletedBy), t.SortOrder, t.CreatedAt);
}

/// <param name="CompletedAt">Null means still open. There is no separate flag.</param>
public record TicketTaskDto(
    Guid Id,
    string Title,
    UserSummaryDto? Assignee,
    DateTime? DueAt,
    DateTime? CompletedAt,
    UserSummaryDto? CompletedBy,
    int SortOrder,
    DateTime CreatedAt);

public record TicketResponderDto(UserSummaryDto Agent, string? Role, DateTime AddedAt);
