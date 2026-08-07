using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// The workspace's status vocabulary and its workflow.
///
/// Two jobs that belong together because neither is meaningful alone: a status
/// nothing can transition into is unreachable, and a transition to a status that
/// does not exist is nothing.
///
/// Seeding is lazy, on first read, for the same reason
/// <see cref="TicketOptionService"/> does it — it fixes existing workspaces and
/// new ones by the same path, with no data migration to run and nothing to
/// remember on the day a workspace is created.
/// </summary>
public class TicketStatusService(TracklyDbContext db)
{
    /// <summary>
    /// What Trackly seeds. Deliberately minimal: five statuses, one per
    /// category, with the four values that already exist on every ticket ever
    /// written plus one for Active.
    ///
    /// Richer flows — "Estimation required", "Testing", "Awaiting CAB" — are the
    /// workspace's to invent. Seeding a guess would put words in their mouth and
    /// leave them deleting things on day one.
    /// </summary>
    private static readonly (string Category, string Value, string Name)[] Defaults =
    [
        (TicketStatusCategory.Open, "open", "Open"),
        (TicketStatusCategory.Pending, "pending", "Pending"),
        (TicketStatusCategory.Active, "in-progress", "In progress"),
        (TicketStatusCategory.Resolved, "resolved", "Resolved"),
        (TicketStatusCategory.Closed, "closed", "Closed"),
    ];

    // ---- Reads ---------------------------------------------------------------

    public async Task<IReadOnlyList<TicketStatusDto>> ListAsync(
        Guid workspaceId, bool includeInactive, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);

        var statuses = db.TicketStatuses.Where(s => s.WorkspaceId == workspaceId);
        if (!includeInactive) statuses = statuses.Where(s => s.IsActive);

        var rows = await statuses.ToListAsync(ct);
        return Order(rows).Select(ToDto).ToList();
    }

    /// <summary>
    /// The statuses a ticket in <paramref name="fromValue"/> may move to,
    /// including the one it is already in.
    ///
    /// The current status is always in the list. Leaving it out makes a picker
    /// that cannot show what is selected, and a "no change" save — which happens
    /// constantly, because saving a form re-sends every field — would be rejected
    /// as an illegal transition.
    /// </summary>
    public async Task<IReadOnlyList<TicketStatusDto>> ReachableAsync(
        Guid workspaceId, string? fromValue, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);

        var all = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId && s.IsActive)
            .ToListAsync(ct);

        var transitions = await db.TicketStatusTransitions
            .Where(t => t.WorkspaceId == workspaceId)
            .ToListAsync(ct);

        // No workflow defined at all means everything is allowed, not nothing. A
        // workspace whose rows were somehow all removed must not become a place
        // where no ticket can ever change status again.
        if (transitions.Count == 0) return Order(all).Select(ToDto).ToList();

        var from = all.FirstOrDefault(s => s.Value == fromValue);
        var reachable = transitions
            // A null FromStatusId is "from anywhere" — Jira's ANY STATUS.
            .Where(t => t.FromStatusId is null || (from is not null && t.FromStatusId == from.Id))
            .Select(t => t.ToStatusId)
            .ToHashSet();

        var allowed = all.Where(s => reachable.Contains(s.Id)).ToList();
        if (from is not null && allowed.All(s => s.Id != from.Id)) allowed.Add(from);

        return Order(allowed).Select(ToDto).ToList();
    }

    /// <summary>
    /// The status a value refers to, or null. Inactive statuses resolve too —
    /// a ticket already carrying one has to keep rendering.
    /// </summary>
    public async Task<TicketStatus?> ResolveAsync(Guid workspaceId, string value, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);
        return await db.TicketStatuses
            .FirstOrDefaultAsync(s => s.WorkspaceId == workspaceId && s.Value == value, ct);
    }

    /// <summary>Where a new ticket starts.</summary>
    public async Task<TicketStatus> DefaultAsync(Guid workspaceId, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);
        var statuses = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId && s.IsActive)
            .ToListAsync(ct);

        // Falls through rather than throwing: a workspace that deactivated its
        // default still has to be able to raise a ticket.
        return statuses.FirstOrDefault(s => s.IsDefault)
               ?? statuses.FirstOrDefault(s => s.Category == TicketStatusCategory.Open)
               ?? Order(statuses).First();
    }

    /// <summary>
    /// The status to use when Trackly needs to put a ticket into a category on
    /// its own — a problem resolving all of its tickets, an automation rule
    /// saying "close it".
    ///
    /// A workspace may have five statuses in one category, and the caller has no
    /// business guessing which. The first by the admin's own order is the one
    /// they arranged to be first.
    /// </summary>
    public async Task<TicketStatus> DefaultForCategoryAsync(
        Guid workspaceId, string category, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);
        var statuses = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId && s.Category == category && s.IsActive)
            .ToListAsync(ct);

        var chosen = Order(statuses).FirstOrDefault();
        if (chosen is not null) return chosen;

        // The category has been emptied. Rather than fail the caller's whole
        // operation, fall back to the workspace's default status — the ticket
        // ends up somewhere real, and the admin's own configuration is why.
        return await DefaultAsync(workspaceId, ct);
    }

    /// <summary>
    /// Whether the workflow permits this move. Staying put always does.
    /// </summary>
    public async Task<bool> CanTransitionAsync(
        Guid workspaceId, string fromValue, string toValue, CancellationToken ct)
    {
        if (fromValue == toValue) return true;
        var reachable = await ReachableAsync(workspaceId, fromValue, ct);
        return reachable.Any(s => s.Value == toValue);
    }

    // ---- Writes ---------------------------------------------------------------

    public async Task<TicketStatusDto> CreateAsync(
        Guid workspaceId, string category, string name, string? color, CancellationToken ct)
    {
        if (!TicketStatusCategory.All.Contains(category))
            throw new ArgumentException("Unknown status category.");
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("A name is required.");

        await EnsureSeededAsync(workspaceId, ct);

        var value = Slugify(name);
        if (value.Length == 0)
            throw new ArgumentException("The name needs at least one letter or digit.");
        if (await db.TicketStatuses.AnyAsync(s => s.WorkspaceId == workspaceId && s.Value == value, ct))
            throw new ArgumentException("A status with that name already exists.");

        var nextOrder = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId && s.Category == category)
            .Select(s => (int?)s.SortOrder)
            .MaxAsync(ct) ?? -1;

        var status = new TicketStatus
        {
            WorkspaceId = workspaceId,
            Category = category,
            Value = value,
            Name = name.Trim(),
            Color = color,
            SortOrder = nextOrder + 1,
        };
        db.TicketStatuses.Add(status);
        await db.SaveChangesAsync(ct);

        // Reachable from anywhere until the admin says otherwise. A new status
        // nothing can transition into is invisible, and "why doesn't my new
        // status appear?" is a bad first experience of the workflow screen.
        db.TicketStatusTransitions.Add(new TicketStatusTransition
        {
            WorkspaceId = workspaceId,
            FromStatusId = null,
            ToStatusId = status.Id,
        });
        await db.SaveChangesAsync(ct);

        return ToDto(status);
    }

    public async Task<TicketStatusDto?> UpdateAsync(
        Guid workspaceId, Guid id, string? name, string? category, string? color,
        int? sortOrder, bool? isActive, bool? isDefault, CancellationToken ct)
    {
        var status = await db.TicketStatuses
            .SingleOrDefaultAsync(s => s.Id == id && s.WorkspaceId == workspaceId, ct);
        if (status is null) return null;

        if (!string.IsNullOrWhiteSpace(name)) status.Name = name.Trim();
        if (color is not null) status.Color = color.Length == 0 ? null : color;
        if (sortOrder is not null) status.SortOrder = sortOrder.Value;

        if (category is not null && category != status.Category)
        {
            if (!TicketStatusCategory.All.Contains(category))
                throw new ArgumentException("Unknown status category.");
            status.Category = category;

            // Every ticket carrying this status now belongs to a different
            // category, and the denormalised column on the ticket is what all
            // the rules read. Leaving it stale would mean a ticket that reads
            // "Done" while the SLA clock keeps running on it.
            await db.Tickets
                .Where(t => t.WorkspaceId == workspaceId && t.Status == status.Value)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.StatusCategory, category), ct);
        }

        if (isActive is not null)
        {
            // An empty picker makes the field unfillable and every ticket stuck.
            if (!isActive.Value && await IsLastActiveAsync(workspaceId, status, ct))
                throw new ArgumentException("At least one status must stay active.");
            status.IsActive = isActive.Value;
            if (!status.IsActive) status.IsDefault = false;
        }

        if (isDefault == true)
        {
            if (!status.IsActive)
                throw new ArgumentException("An inactive status cannot be the default.");
            // Exactly one, always. Two defaults is a coin toss on every new ticket.
            await db.TicketStatuses
                .Where(s => s.WorkspaceId == workspaceId && s.Id != status.Id && s.IsDefault)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDefault, false), ct);
            status.IsDefault = true;
        }

        await db.SaveChangesAsync(ct);
        return ToDto(status);
    }

    /// <summary>
    /// Deletes only when nothing carries the value. A used status is retired by
    /// deactivating it — removing the row would leave tickets showing a value
    /// with no name, which reads as corrupt data rather than as history.
    /// </summary>
    public async Task<TicketStatusDeleteResult> DeleteAsync(
        Guid workspaceId, Guid id, CancellationToken ct)
    {
        var status = await db.TicketStatuses
            .SingleOrDefaultAsync(s => s.Id == id && s.WorkspaceId == workspaceId, ct);
        if (status is null) return TicketStatusDeleteResult.NotFound;
        if (status.IsSystem) return TicketStatusDeleteResult.SystemStatus;

        if (await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId && t.Status == status.Value, ct))
            return TicketStatusDeleteResult.InUse;
        if (await IsLastActiveAsync(workspaceId, status, ct))
            return TicketStatusDeleteResult.LastActive;

        // Its transitions go with it — a rule pointing at a status that no longer
        // exists is a rule that can never fire.
        //
        // Loaded and removed through the change tracker rather than with
        // ExecuteDelete, for two reasons. ExecuteDelete commits its own
        // transaction, so a failure on the line below would leave the status
        // alive with every one of its rules gone — unreachable, for no reason
        // anyone could see. And it deletes behind the tracker's back: any
        // transition already loaded in this scope stays in memory pointing at a
        // status about to be removed, and EF refuses that as a severed required
        // relationship. One SaveChanges takes both, atomically.
        var rules = await db.TicketStatusTransitions
            .Where(t => t.WorkspaceId == workspaceId && (t.FromStatusId == id || t.ToStatusId == id))
            .ToListAsync(ct);

        db.TicketStatusTransitions.RemoveRange(rules);
        db.TicketStatuses.Remove(status);
        await db.SaveChangesAsync(ct);
        return TicketStatusDeleteResult.Deleted;
    }

    // ---- Workflow --------------------------------------------------------------

    public async Task<IReadOnlyList<TransitionDto>> TransitionsAsync(
        Guid workspaceId, CancellationToken ct)
    {
        await EnsureSeededAsync(workspaceId, ct);
        return await db.TicketStatusTransitions
            .Where(t => t.WorkspaceId == workspaceId)
            .Select(t => new TransitionDto(t.Id, t.FromStatusId, t.ToStatusId))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Replaces the whole workflow in one call.
    ///
    /// A matrix screen edits every cell at once, and sending diffs from it would
    /// mean the client computing what changed — which is how a half-applied
    /// workflow happens. One list in, one transaction, no intermediate state
    /// where a ticket cannot move.
    /// </summary>
    public async Task SetTransitionsAsync(
        Guid workspaceId, IReadOnlyList<TransitionInput> wanted, CancellationToken ct)
    {
        var statusIds = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId)
            .Select(s => s.Id)
            .ToListAsync(ct);
        var known = statusIds.ToHashSet();

        // Ids from another workspace would build a workflow whose rules nobody
        // here can see or edit.
        foreach (var input in wanted)
        {
            if (!known.Contains(input.ToStatusId))
                throw new ArgumentException("Unknown target status.");
            if (input.FromStatusId is { } from && !known.Contains(from))
                throw new ArgumentException("Unknown source status.");
        }

        await db.TicketStatusTransitions
            .Where(t => t.WorkspaceId == workspaceId)
            .ExecuteDeleteAsync(ct);

        foreach (var input in wanted.DistinctBy(i => (i.FromStatusId, i.ToStatusId)))
        {
            db.TicketStatusTransitions.Add(new TicketStatusTransition
            {
                WorkspaceId = workspaceId,
                FromStatusId = input.FromStatusId,
                ToStatusId = input.ToStatusId,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    // ---- Seeding ---------------------------------------------------------------

    /// <summary>
    /// Adds any default status the workspace does not have, and gives a brand new
    /// workspace a fully permissive workflow.
    ///
    /// Topped up rather than seeded once (the way panels are, and unlike
    /// priorities): the five categories are Trackly's, so a category that gains
    /// a default status in a later release has to reach every existing workspace.
    /// </summary>
    private async Task EnsureSeededAsync(Guid workspaceId, CancellationToken ct)
    {
        var existing = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId)
            .Select(s => s.Value)
            .ToListAsync(ct);
        var have = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var missing = Defaults.Where(d => !have.Contains(d.Value)).ToList();
        if (missing.Count == 0) return;

        var fresh = existing.Count == 0;

        foreach (var (category, value, name) in missing)
        {
            db.TicketStatuses.Add(new TicketStatus
            {
                WorkspaceId = workspaceId,
                Category = category,
                Value = value,
                Name = name,
                SortOrder = 0,
                IsSystem = true,
                // Only on a first seed: a workspace that has already chosen its
                // default must not have it moved by a later top-up.
                IsDefault = fresh && category == TicketStatusCategory.Open,
            });
        }
        await db.SaveChangesAsync(ct);

        // Every seeded status reachable from anywhere, which is exactly what
        // Trackly did before workflows existed. The admin narrows it from there.
        var seeded = await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId)
            .Select(s => s.Id)
            .ToListAsync(ct);
        var wired = await db.TicketStatusTransitions
            .Where(t => t.WorkspaceId == workspaceId)
            .Select(t => t.ToStatusId)
            .ToListAsync(ct);
        var wiredSet = wired.ToHashSet();

        foreach (var id in seeded.Where(id => !wiredSet.Contains(id)))
        {
            db.TicketStatusTransitions.Add(new TicketStatusTransition
            {
                WorkspaceId = workspaceId,
                FromStatusId = null,
                ToStatusId = id,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task<bool> IsLastActiveAsync(
        Guid workspaceId, TicketStatus status, CancellationToken ct)
    {
        var another = await db.TicketStatuses.AnyAsync(
            s => s.WorkspaceId == workspaceId && s.IsActive && s.Id != status.Id, ct);
        return !another;
    }

    /// <summary>Category order first, then the admin's order inside it.</summary>
    private static IEnumerable<TicketStatus> Order(IEnumerable<TicketStatus> statuses) =>
        statuses
            .OrderBy(s => Array.IndexOf(TicketStatusCategory.All, s.Category))
            .ThenBy(s => s.SortOrder)
            .ThenBy(s => s.Name);

    private static string Slugify(string name)
    {
        var chars = name.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();
        var slug = string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return slug.Length > 64 ? slug[..64] : slug;
    }

    private static TicketStatusDto ToDto(TicketStatus s) =>
        new(s.Id, s.Category, s.Value, s.Name, s.Color, s.SortOrder, s.IsActive, s.IsDefault, s.IsSystem);
}

public enum TicketStatusDeleteResult
{
    Deleted,
    NotFound,
    SystemStatus,
    InUse,
    LastActive,
}

public record TicketStatusDto(
    Guid Id,
    string Category,
    string Value,
    string Name,
    string? Color,
    int SortOrder,
    bool IsActive,
    bool IsDefault,
    bool IsSystem);

public record TransitionDto(Guid Id, Guid? FromStatusId, Guid ToStatusId);

/// <param name="FromStatusId">Null means "from any status".</param>
public record TransitionInput(Guid? FromStatusId, Guid ToStatusId);
