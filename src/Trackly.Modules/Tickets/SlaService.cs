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
    /// <summary>
    /// The workspace's open hours, cached for the life of this scoped service.
    ///
    /// One request can recompute deadlines more than once — changing a priority
    /// and resolving in the same save touches this twice — and the schedule
    /// cannot change mid-request. Reading it once is the difference between one
    /// query and several for an answer that is identical every time.
    /// </summary>
    private readonly Dictionary<Guid, BusinessCalendar> calendars = new();

    private async Task<BusinessCalendar> CalendarAsync(Guid workspaceId, CancellationToken ct)
    {
        if (calendars.TryGetValue(workspaceId, out var cached)) return cached;

        var hours = await db.BusinessHours
            .Include(h => h.Days)
            .Include(h => h.Holidays)
            .SingleOrDefaultAsync(h => h.WorkspaceId == workspaceId, ct);

        var calendar = BusinessCalendar.For(hours);
        calendars[workspaceId] = calendar;
        return calendar;
    }

    // ---- Applying SLA to tickets --------------------------------------------

    public async Task ApplyOnCreateAsync(Ticket ticket, CancellationToken ct)
    {
        var policy = await PolicyAsync(ticket.WorkspaceId, ticket.Priority, ct);
        SetDueDates(ticket, policy, ticket.CreatedAt, await CalendarAsync(ticket.WorkspaceId, ct));
    }

    public async Task OnPriorityChangedAsync(Ticket ticket, CancellationToken ct)
    {
        var policy = await PolicyAsync(ticket.WorkspaceId, ticket.Priority, ct);
        // Recompute from the creation baseline; keep a met first-response as met.
        SetDueDates(ticket, policy, ticket.CreatedAt, await CalendarAsync(ticket.WorkspaceId, ct));
    }

    /// <summary>
    /// Pauses the clocks while pending; on resume, pushes the deadlines out by
    /// however long the pause lasted.
    ///
    /// **Takes categories, not statuses.** A workspace can call its waiting
    /// state "Awaiting customer", "Blocked" or "On hold" — the clock has to stop
    /// for all of them, and it only can if the rule is written against the
    /// category every one of those belongs to.
    /// </summary>
    public void OnStatusChanged(Ticket ticket, string oldCategory, string newCategory)
    {
        if (newCategory == TicketStatusCategory.Pending)
        {
            ticket.SlaPausedAt ??= DateTime.UtcNow;
        }
        else if (oldCategory == TicketStatusCategory.Pending && ticket.SlaPausedAt is { } pausedAt)
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

    /// <summary>
    /// Stamps the two deadlines, counting only the hours the desk is open.
    ///
    /// The calendar is what makes the number a promise the team can keep: a
    /// ticket raised at 17:55 on Friday with a four-hour target is due mid-Monday
    /// morning rather than breached before anyone is back at their desk. A
    /// workspace with business hours off gets plain wall-clock arithmetic, and
    /// the calendar does that itself so there is no branch here.
    ///
    /// **Both deadlines are stored as UTC instants**, not as remaining minutes.
    /// Everything downstream — the list's SLA column, the sort, the breach sweep
    /// — is then one indexed comparison rather than a calculation per row.
    /// </summary>
    private static void SetDueDates(
        Ticket ticket, SlaPolicy? policy, DateTime baseline, BusinessCalendar calendar)
    {
        if (policy is null)
        {
            if (ticket.FirstResponseAt is null) ticket.FirstResponseDueAt = null;
            ticket.ResolveDueAt = null;
            return;
        }
        if (ticket.FirstResponseAt is null)
            ticket.FirstResponseDueAt = policy.FirstResponseMinutes is int fr
                ? calendar.AddWorkingMinutes(baseline, fr)
                : null;
        ticket.ResolveDueAt = policy.ResolveMinutes is int rr
            ? calendar.AddWorkingMinutes(baseline, rr)
            : null;
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

        await AdoptUncoveredAsync(actor.WorkspaceId, policy, ct);

        await db.SaveChangesAsync(ct);
        return new SlaPolicyDto(policy.Priority, policy.FirstResponseMinutes, policy.ResolveMinutes);
    }

    /// <summary>
    /// Gives deadlines to open tickets of this priority that have none.
    ///
    /// "Tickets already open keep the deadlines they were given" is the rule the
    /// admin screen promises, and it is kept: a ticket that HAS due dates is not
    /// touched. But a ticket with none was never given any — it was created
    /// before anybody configured SLA, and without this it stays outside SLA for
    /// the rest of its life with no way to bring it in. On a new workspace that
    /// is every ticket raised before the admin got to this screen.
    ///
    /// Measured from creation, exactly as a new ticket is. That will show some
    /// of them as already breached, which is the honest reading: the admin has
    /// just declared that an urgent ticket gets two hours, and a twenty-hour-old
    /// unanswered urgent ticket is late by that standard. Starting the clock at
    /// "now" instead would put a deadline on the ticket that its own elapsed
    /// time contradicts, and the progress bar — which measures from creation —
    /// would read as nonsense.
    ///
    /// Resolved and closed tickets are left alone: the work is over, and a
    /// deadline on it is a number nobody can act on.
    /// </summary>
    private async Task AdoptUncoveredAsync(Guid workspaceId, SlaPolicy policy, CancellationToken ct)
    {
        var uncovered = await db.Tickets
            .Where(t => t.WorkspaceId == workspaceId
                        && t.Priority == policy.Priority
                        && (t.StatusCategory != TicketStatusCategory.Resolved && t.StatusCategory != TicketStatusCategory.Closed)
                        && t.FirstResponseDueAt == null
                        && t.ResolveDueAt == null)
            .ToListAsync(ct);

        var calendar = await CalendarAsync(workspaceId, ct);
        foreach (var ticket in uncovered)
            SetDueDates(ticket, policy, ticket.CreatedAt, calendar);
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
