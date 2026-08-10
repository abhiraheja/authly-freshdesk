using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// What is still outstanding on a ticket somebody is about to resolve, and which
/// other tickets would end with it.
///
/// **Accountability, not obstruction.** Every finding here is a soft gate: the
/// agent is told, and if they go ahead the override is written into the activity
/// log with their name on it. A hard refusal would be worse than nothing — the
/// escape from "this ticket cannot be closed because of a checklist item somebody
/// added in March" is to delete the checklist item, which destroys the very
/// record the gate existed to keep. A recorded override keeps it.
///
/// **The gate lives here and in <see cref="TicketService.UpdateAsync"/>, not in
/// the dialog.** The dialog reads this so it can show the warnings before the
/// agent commits; the API re-checks them and refuses an unacknowledged resolve.
/// A rule that only exists in the SPA is not a rule — anything that can post JSON
/// would walk straight past it.
///
/// Agent-facing throughout: open tasks, who has not replied yet and which other
/// customers reported the same thing are all internal (invariant 5).
/// </summary>
public class TicketResolveGuard(TracklyDbContext db, TicketRelationService relations)
{
    /// <summary>
    /// How many duplicates one resolve may carry.
    ///
    /// Each one is a customer receiving a resolution email, so this is a blast
    /// radius rather than a page size. Past this the honest answer is a problem
    /// record grouping them, not a checkbox list nobody can read.
    /// </summary>
    public const int MaxCascade = 25;

    /// <summary>
    /// Everything the resolve dialog needs, in one round trip: the duplicates it
    /// can offer to close alongside, and the warnings it has to show first.
    ///
    /// Null when the ticket is not in this workspace.
    /// </summary>
    public async Task<ResolvePreviewDto?> PreviewAsync(Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await db.Tickets.AnyAsync(
                t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct))
            return null;

        var duplicates = await relations.OpenDuplicatesAsync(actor.WorkspaceId, ticketId, ct);
        return new ResolvePreviewDto(
            duplicates.Take(MaxCascade).ToList(),
            // Said plainly rather than left for the agent to notice by counting
            // rows: a list silently cut at 25 reads as "that is all of them".
            duplicates.Count > MaxCascade,
            await WarningsAsync(actor.WorkspaceId, ticketId, ct));
    }

    /// <summary>
    /// The three reasons a ticket might not be finished even though the agent
    /// thinks it is.
    ///
    /// One query for the two cheap lists plus one call for the blockers. Run on
    /// every open→terminal transition, so it stays deliberately small.
    /// </summary>
    public async Task<ResolveWarningsDto> WarningsAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var openTasks = await db.TicketTasks
            .Where(t => t.WorkspaceId == workspaceId && t.TicketId == ticketId && t.CompletedAt == null)
            .OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
            .Select(t => new OpenTaskDto(t.Id, t.Title, UserSummaryDto.From(t.Assignee), t.DueAt))
            .ToListAsync(ct);

        // "Responded" is ANY comment they wrote on this ticket — a team note
        // counts. Somebody pulled in to look at a router and reporting back
        // internally has done the thing they were added for; demanding a public
        // reply from them would demand they write to the customer, which is the
        // assignee's job and not what a responder was added to do.
        //
        // Read off comments rather than a flag on the responder row, so it cannot
        // drift: there is no second place recording whether they replied.
        var pending = await db.TicketResponders
            .Where(r => r.TicketId == ticketId
                        && !db.Comments.Any(c => c.TicketId == ticketId && c.AuthorId == r.AgentId))
            .OrderBy(r => r.AddedAt)
            .Select(r => new PendingResponderDto(UserSummaryDto.From(r.Agent)!, r.Role))
            .ToListAsync(ct);

        return new ResolveWarningsDto(
            openTasks,
            pending,
            await relations.BlockersAsync(workspaceId, ticketId, ct));
    }

    /// <summary>
    /// Narrows what the client asked to cascade down to what may actually be
    /// cascaded, and says why anything was dropped.
    ///
    /// Never trusts the ids it is given. The dialog offers a filtered list, but a
    /// client can post any id at all, and "resolve these too" pointed at an
    /// arbitrary ticket would be a way to close somebody else's work — or, across
    /// a workspace boundary, another organisation's (invariant 1). So each id has
    /// to prove it is a duplicate of the ticket being resolved.
    /// </summary>
    public async Task<CascadeTargets> ResolveCascadeAsync(
        Guid workspaceId, Guid ticketId, IReadOnlyList<Guid> requested, CancellationToken ct)
    {
        if (requested.Count == 0) return new CascadeTargets([], []);

        var allowed = (await relations.OpenDuplicatesAsync(workspaceId, ticketId, ct))
            .ToDictionary(d => d.Id);

        var wanted = requested.Distinct().Where(id => id != ticketId).ToList();
        if (wanted.Count > MaxCascade)
            throw new ArgumentException(
                $"A single resolve can carry at most {MaxCascade} duplicates.");

        var targets = new List<LinkedTicketDto>();
        var rejected = new List<Guid>();
        foreach (var id in wanted)
        {
            if (allowed.TryGetValue(id, out var target)) targets.Add(target);
            // Not an error. Between the dialog opening and the agent pressing the
            // button, somebody else may have resolved that ticket or removed the
            // link — both of which mean "it does not need to follow", which is
            // the outcome the agent wanted anyway.
            else rejected.Add(id);
        }

        return new CascadeTargets(targets, rejected);
    }
}

/// <summary>
/// Thrown when a resolve would leave work outstanding and the caller has not said
/// it knows.
///
/// A distinct exception rather than <see cref="ArgumentException"/> because the
/// answer is not "your request was wrong" — the request was fine, and repeating it
/// with <c>acknowledgeWarnings</c> set is the correct next step. It maps to 409
/// and carries the warnings, so a client that skipped the preview can still show
/// the agent exactly what it is asking them to confirm.
/// </summary>
public class TicketWarningsException(ResolveWarningsDto warnings)
    : Exception("This ticket still has work outstanding.")
{
    public ResolveWarningsDto Warnings { get; } = warnings;
}

/// <param name="Duplicates">Open tickets that say "same issue" — offered as ticked boxes.</param>
/// <param name="MoreDuplicates">True when there are more than the dialog will carry.</param>
public record ResolvePreviewDto(
    IReadOnlyList<LinkedTicketDto> Duplicates,
    bool MoreDuplicates,
    ResolveWarningsDto Warnings);

/// <summary>
/// Why a resolve should pause. Empty means nothing is outstanding and the dialog
/// shows no warning at all — the common case, and it must stay silent in it.
/// </summary>
public record ResolveWarningsDto(
    IReadOnlyList<OpenTaskDto> OpenTasks,
    IReadOnlyList<PendingResponderDto> PendingResponders,
    IReadOnlyList<LinkedTicketDto> OpenBlockers)
{
    public bool Any => OpenTasks.Count > 0 || PendingResponders.Count > 0 || OpenBlockers.Count > 0;

    /// <summary>
    /// One line for the activity log, so the override is legible six months later
    /// without cross-referencing three other tables.
    /// </summary>
    public string Describe()
    {
        var parts = new List<string>();
        if (OpenTasks.Count > 0) parts.Add($"{OpenTasks.Count} open task(s)");
        if (PendingResponders.Count > 0)
            parts.Add($"{PendingResponders.Count} responder(s) who had not replied");
        if (OpenBlockers.Count > 0)
            parts.Add($"blocked by {string.Join(", ", OpenBlockers.Select(b => TicketNumber.Hash(b.Id)))}");
        return string.Join("; ", parts);
    }
}

public record OpenTaskDto(Guid Id, string Title, UserSummaryDto? Assignee, DateTime? DueAt);

/// <param name="Role">What they were added to do, if whoever added them said.</param>
public record PendingResponderDto(UserSummaryDto Agent, string? Role);

/// <param name="Targets">Duplicates that will be resolved with the ticket.</param>
/// <param name="Rejected">Ids that no longer qualify — already resolved, or unlinked since the dialog opened.</param>
public record CascadeTargets(IReadOnlyList<LinkedTicketDto> Targets, IReadOnlyList<Guid> Rejected);
