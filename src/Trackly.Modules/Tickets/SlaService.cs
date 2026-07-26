using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

// Computes and maintains SLA due dates on tickets. Targets are wall-clock minutes
// from the priority's policy; the resolve clock pauses while a ticket is pending
// (deadlines are pushed out by the paused duration, so the stored due date stays
// a single comparable timestamp). Admin CRUD lives here too.
public class SlaService(TracklyDbContext db)
{
    // ---- Applying SLA to tickets --------------------------------------------

    public async Task ApplyOnCreateAsync(Ticket ticket, CancellationToken ct)
    {
        var policy = await PolicyAsync(ticket.WorkspaceId, ticket.Priority, ct);
        SetDueDates(ticket, policy, ticket.CreatedAt);
    }

    public async Task OnPriorityChangedAsync(Ticket ticket, CancellationToken ct)
    {
        var policy = await PolicyAsync(ticket.WorkspaceId, ticket.Priority, ct);
        // Recompute from the creation baseline; keep a met first-response as met.
        SetDueDates(ticket, policy, ticket.CreatedAt);
    }

    // Pause the clocks while pending; on resume, push deadlines out by the pause.
    public void OnStatusChanged(Ticket ticket, string oldStatus, string newStatus)
    {
        if (newStatus == TicketStatus.Pending)
        {
            ticket.SlaPausedAt ??= DateTime.UtcNow;
        }
        else if (oldStatus == TicketStatus.Pending && ticket.SlaPausedAt is { } pausedAt)
        {
            var delta = DateTime.UtcNow - pausedAt;
            if (ticket.FirstResponseAt is null && ticket.FirstResponseDueAt is { } fr)
                ticket.FirstResponseDueAt = fr.Add(delta);
            if (ticket.ResolveDueAt is { } rr)
                ticket.ResolveDueAt = rr.Add(delta);
            ticket.SlaPausedAt = null;
        }
    }

    public void OnAgentReply(Ticket ticket)
    {
        ticket.FirstResponseAt ??= DateTime.UtcNow;
    }

    private static void SetDueDates(Ticket ticket, SlaPolicy? policy, DateTime baseline)
    {
        if (policy is null)
        {
            if (ticket.FirstResponseAt is null) ticket.FirstResponseDueAt = null;
            ticket.ResolveDueAt = null;
            return;
        }
        if (ticket.FirstResponseAt is null)
            ticket.FirstResponseDueAt = policy.FirstResponseMinutes is int fr ? baseline.AddMinutes(fr) : null;
        ticket.ResolveDueAt = policy.ResolveMinutes is int rr ? baseline.AddMinutes(rr) : null;
    }

    private Task<SlaPolicy?> PolicyAsync(Guid workspaceId, string priority, CancellationToken ct)
        => db.SlaPolicies.SingleOrDefaultAsync(p => p.WorkspaceId == workspaceId && p.Priority == priority, ct);

    // ---- Admin CRUD ----------------------------------------------------------

    public async Task<IReadOnlyList<SlaPolicyDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await db.SlaPolicies
            .Where(p => p.WorkspaceId == actor.WorkspaceId)
            .Select(p => new SlaPolicyDto(p.Priority, p.FirstResponseMinutes, p.ResolveMinutes))
            .ToListAsync(ct);
    }

    public async Task<SlaPolicyDto> UpsertAsync(Actor actor, SlaPolicyDto dto, CancellationToken ct)
    {
        if (!TicketPriority.All.Contains(dto.Priority))
            throw new ArgumentException("Invalid priority.");

        var policy = await db.SlaPolicies
            .SingleOrDefaultAsync(p => p.WorkspaceId == actor.WorkspaceId && p.Priority == dto.Priority, ct);
        if (policy is null)
        {
            policy = new SlaPolicy { WorkspaceId = actor.WorkspaceId, Priority = dto.Priority };
            db.SlaPolicies.Add(policy);
        }
        policy.FirstResponseMinutes = dto.FirstResponseMinutes is > 0 ? dto.FirstResponseMinutes : null;
        policy.ResolveMinutes = dto.ResolveMinutes is > 0 ? dto.ResolveMinutes : null;
        policy.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new SlaPolicyDto(policy.Priority, policy.FirstResponseMinutes, policy.ResolveMinutes);
    }

    public async Task<bool> DeleteAsync(Actor actor, string priority, CancellationToken ct)
    {
        var deleted = await db.SlaPolicies
            .Where(p => p.WorkspaceId == actor.WorkspaceId && p.Priority == priority)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }
}

public record SlaPolicyDto(string Priority, int? FirstResponseMinutes, int? ResolveMinutes);
