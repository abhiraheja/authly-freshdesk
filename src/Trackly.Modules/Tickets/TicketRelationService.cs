using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Ticket-to-ticket links, and the two consequences they carry.
///
/// **One row, read from both ends.** Writing "A duplicates B" stores a single
/// row on A; B's card shows the same fact as "duplicated by A", derived from
/// <see cref="TicketRelationKind.Inverse"/>. Storing the mirror row too would
/// mean two records of one fact that can fall out of step — delete one and the
/// pair goes half-broken, with each ticket telling a different story.
///
/// **A link is not decoration; two kinds of it change what happens.**
/// <list type="bullet">
/// <item><description>
///   <b>Duplicates</b> are the same report twice, so they end together. This
///   service works out which tickets those are; it never resolves them. The
///   agent is shown the list and ticks what follows, because each one is a
///   customer who gets an email.
/// </description></item>
/// <item><description>
///   <b>Blocks / causes</b> means one ticket cannot start until another ends.
///   The blocked ticket carries a banner while its blocker is open, resolving it
///   asks first, and the blocker ending notifies whoever is waiting.
/// </description></item>
/// </list>
/// <see cref="TicketRelationKind.Relates"/> deliberately carries neither: it is
/// the kind for "these two are connected and a human should know", and inventing
/// behaviour for it would make the safe, vague option the dangerous one.
///
/// Agent-facing (invariant 5): which other tickets a customer's problem is
/// related to is internal, and often about other customers entirely.
/// </summary>
public class TicketRelationService(TracklyDbContext db, ActivityLog activity)
{
    /// <summary>
    /// How far a chain of duplicates is walked.
    ///
    /// Duplicates are transitive — if B duplicates A and C duplicates B, then
    /// resolving A settles all three, and an agent who is only shown B has to
    /// resolve twice. Bounded because a cycle is possible (nothing stops an agent
    /// linking A→B and B→A) and an unbounded walk over one would not terminate.
    /// Six hops is far past any real thread of "same issue" reports.
    /// </summary>
    private const int MaxDuplicateHops = 6;

    /// <summary>
    /// Everything linked to this ticket, from either direction, newest first.
    /// </summary>
    public async Task<IReadOnlyList<TicketRelationDto>?> ListAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await ExistsAsync(actor, ticketId, ct)) return null;

        // Written on this ticket: the kind reads as stored.
        var outgoing = await db.TicketRelations
            .Where(r => r.WorkspaceId == actor.WorkspaceId && r.TicketId == ticketId)
            .Select(r => new
            {
                r.Id, r.Kind, r.CreatedAt,
                Other = r.RelatedTicket!,
                CreatedBy = r.CreatedBy,
                // The workspace's own word for the other ticket's status. Inlined
                // rather than read off the entity, which only carries the value —
                // a relation card showing "in_progress" next to a rail that says
                // "Being worked on" reads as two different systems.
                OtherStatusName = db.TicketStatuses
                    .Where(s => s.WorkspaceId == r.WorkspaceId && s.Value == r.RelatedTicket!.Status)
                    .Select(s => s.Name)
                    .FirstOrDefault(),
            })
            .ToListAsync(ct);

        // Written on the OTHER ticket, pointing here: the kind is inverted, so
        // "A blocks B" reads on B as "blocked by A".
        var incoming = await db.TicketRelations
            .Where(r => r.WorkspaceId == actor.WorkspaceId && r.RelatedTicketId == ticketId)
            .Select(r => new
            {
                r.Id, r.Kind, r.CreatedAt,
                Other = r.Ticket!,
                CreatedBy = r.CreatedBy,
                OtherStatusName = db.TicketStatuses
                    .Where(s => s.WorkspaceId == r.WorkspaceId && s.Value == r.Ticket!.Status)
                    .Select(s => s.Name)
                    .FirstOrDefault(),
            })
            .ToListAsync(ct);

        return outgoing
            .Select(r => Shape(r.Id, r.Kind, r.Other, r.OtherStatusName, r.CreatedBy, r.CreatedAt, mirrored: false))
            .Concat(incoming.Select(r => Shape(
                r.Id, TicketRelationKind.Inverse(r.Kind), r.Other, r.OtherStatusName,
                r.CreatedBy, r.CreatedAt, mirrored: true)))
            .OrderByDescending(r => r.CreatedAt)
            .ToList();
    }

    public async Task<TicketRelationDto?> AddAsync(
        Actor actor, Guid ticketId, Guid relatedTicketId, string kind, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        // A ticket related to itself is a loop that renders as a card linking to
        // the page it is on.
        if (ticketId == relatedTicketId)
            throw new ArgumentException("A ticket cannot be related to itself.");
        if (!TicketRelationKind.IsKnown(kind))
            throw new ArgumentException("Unknown relationship.");

        if (!await ExistsAsync(actor, ticketId, ct)) return null;
        // Checked through the same workspace filter: linking across tenants would
        // put another organisation's subject on this screen.
        var other = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == relatedTicketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (other is null) throw new ArgumentException("That ticket is not in this workspace.");

        // Either direction counts as already linked. Without this, an agent on B
        // can re-add a link they are already looking at, and the card shows the
        // same pair twice with opposite wording.
        var already = await db.TicketRelations.AnyAsync(r =>
            r.WorkspaceId == actor.WorkspaceId &&
            ((r.TicketId == ticketId && r.RelatedTicketId == relatedTicketId && r.Kind == kind) ||
             (r.TicketId == relatedTicketId && r.RelatedTicketId == ticketId
              && r.Kind == TicketRelationKind.Inverse(kind))), ct);
        if (already) throw new ArgumentException("These tickets are already linked that way.");

        var relation = new TicketRelation
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticketId,
            RelatedTicketId = relatedTicketId,
            Kind = kind,
            CreatedById = actor.UserId,
        };
        db.TicketRelations.Add(relation);

        // Both tickets get an entry: the link is equally a fact about each, and
        // an agent looking at the other one should not have to guess where it
        // came from.
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.LinkAdded, $"{TicketNumber.Hash(relatedTicketId)} {other.Subject}");
        activity.Happened(actor.WorkspaceId, relatedTicketId, actor.UserId,
            TicketActivityType.LinkAdded, TicketNumber.Hash(ticketId));

        await db.SaveChangesAsync(ct);
        await db.Entry(relation).Reference(r => r.CreatedBy).LoadAsync(ct);
        var otherStatusName = await StatusNameAsync(actor.WorkspaceId, other.Status, ct);
        return Shape(relation.Id, kind, other, otherStatusName, relation.CreatedBy, relation.CreatedAt, mirrored: false);
    }

    /// <summary>
    /// Removes a link from either end.
    ///
    /// The id is enough — it identifies the one row regardless of which ticket
    /// the agent happens to be looking at, which is what makes a mirrored link
    /// removable from the side that did not create it.
    /// </summary>
    public async Task<bool> DeleteAsync(Actor actor, Guid ticketId, Guid relationId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var relation = await db.TicketRelations.SingleOrDefaultAsync(r =>
            r.Id == relationId && r.WorkspaceId == actor.WorkspaceId
            && (r.TicketId == ticketId || r.RelatedTicketId == ticketId), ct);
        if (relation is null) return false;

        db.TicketRelations.Remove(relation);
        activity.Happened(actor.WorkspaceId, relation.TicketId, actor.UserId,
            TicketActivityType.LinkRemoved, TicketNumber.Hash(relation.RelatedTicketId));
        activity.Happened(actor.WorkspaceId, relation.RelatedTicketId, actor.UserId,
            TicketActivityType.LinkRemoved, TicketNumber.Hash(relation.TicketId));
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- What the links mean --------------------------------------------------

    /// <summary>
    /// The headline an agent needs the moment a ticket opens: how many tickets it
    /// is tied to, and which of those ties are currently holding it up.
    ///
    /// Cheap on the common path. The counts are one query; the two lists are only
    /// fetched when there is at least one link, so the great majority of tickets
    /// — which have none — cost a single extra round trip and render no banner.
    /// </summary>
    public async Task<TicketRelationSummaryDto> SummaryAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var counts = await db.Tickets
            .Where(t => t.Id == ticketId && t.WorkspaceId == workspaceId)
            .Select(t => new
            {
                Total = db.TicketRelations.Count(r =>
                    r.WorkspaceId == workspaceId && (r.TicketId == t.Id || r.RelatedTicketId == t.Id)),
                Duplicates = db.TicketRelations.Count(r =>
                    r.WorkspaceId == workspaceId
                    && TicketRelationKind.Duplicate.Contains(r.Kind)
                    && (r.TicketId == t.Id || r.RelatedTicketId == t.Id)),
            })
            .SingleOrDefaultAsync(ct);

        if (counts is null || counts.Total == 0)
            return new TicketRelationSummaryDto(0, 0, [], []);

        return new TicketRelationSummaryDto(
            counts.Total,
            counts.Duplicates,
            await BlockersAsync(workspaceId, ticketId, ct),
            await BlockedByThisAsync(workspaceId, ticketId, ct));
    }

    /// <summary>
    /// Open tickets that hold this one up.
    ///
    /// Two queries rather than one union: the same fact is stored in two shapes
    /// (a `blocked_by` row written here, or a `blocks` row written there), and
    /// joining them in SQL to save a round trip produces a query plan that is
    /// harder to read than the two it replaces.
    ///
    /// Only unfinished ones. A blocker that has been resolved is not a blocker;
    /// it is history, and history does not belong in a warning.
    /// </summary>
    public async Task<IReadOnlyList<LinkedTicketDto>> BlockersAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var written = await Linked(workspaceId)
            .Where(r => r.TicketId == ticketId && TicketRelationKind.Blocked.Contains(r.Kind))
            .Select(r => r.RelatedTicket!)
            .Where(Unfinished())
            .Select(Project(workspaceId))
            .ToListAsync(ct);

        var mirrored = await Linked(workspaceId)
            .Where(r => r.RelatedTicketId == ticketId && TicketRelationKind.Blocking.Contains(r.Kind))
            .Select(r => r.Ticket!)
            .Where(Unfinished())
            .Select(Project(workspaceId))
            .ToListAsync(ct);

        return Merge(written, mirrored);
    }

    /// <summary>
    /// Open tickets that THIS one holds up — the queue that starts moving when it
    /// is resolved, and therefore the people to tell.
    /// </summary>
    public async Task<IReadOnlyList<LinkedTicketDto>> BlockedByThisAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var written = await Linked(workspaceId)
            .Where(r => r.TicketId == ticketId && TicketRelationKind.Blocking.Contains(r.Kind))
            .Select(r => r.RelatedTicket!)
            .Where(Unfinished())
            .Select(Project(workspaceId))
            .ToListAsync(ct);

        var mirrored = await Linked(workspaceId)
            .Where(r => r.RelatedTicketId == ticketId && TicketRelationKind.Blocked.Contains(r.Kind))
            .Select(r => r.Ticket!)
            .Where(Unfinished())
            .Select(Project(workspaceId))
            .ToListAsync(ct);

        return Merge(written, mirrored);
    }

    /// <summary>
    /// Every unfinished ticket reachable from this one through duplicate links,
    /// however many hops away — the full set that "this is the same issue" covers.
    ///
    /// Transitive on purpose. Three customers reporting one outage usually get
    /// linked in a chain rather than a star, because each agent links the ticket
    /// they are holding to the one they just saw. Only offering the direct
    /// neighbours would leave the far end of the chain open, which is the one
    /// nobody remembers to go back to.
    ///
    /// The ticket itself is never in the result.
    /// </summary>
    public async Task<IReadOnlyList<LinkedTicketDto>> OpenDuplicatesAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var seen = new HashSet<Guid> { ticketId };
        var frontier = new List<Guid> { ticketId };

        for (var hop = 0; hop < MaxDuplicateHops && frontier.Count > 0; hop++)
        {
            var edges = await db.TicketRelations
                .Where(r => r.WorkspaceId == workspaceId
                            && TicketRelationKind.Duplicate.Contains(r.Kind)
                            && (frontier.Contains(r.TicketId) || frontier.Contains(r.RelatedTicketId)))
                .Select(r => new { r.TicketId, r.RelatedTicketId })
                .ToListAsync(ct);

            // `seen.Add` is the visited check and the accumulate in one step, so a
            // cycle simply produces an empty frontier and the walk stops.
            frontier = edges
                .SelectMany(e => new[] { e.TicketId, e.RelatedTicketId })
                .Where(id => seen.Add(id))
                .ToList();
        }

        seen.Remove(ticketId);
        if (seen.Count == 0) return [];

        var ids = seen.ToList();
        return await db.Tickets
            .Where(t => t.WorkspaceId == workspaceId && ids.Contains(t.Id))
            .Where(Unfinished())
            .Select(Project(workspaceId))
            .OrderBy(t => t.CreatedAt)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Clears links pointing AT a ticket about to be deleted.
    ///
    /// The incoming foreign key is NO ACTION, because two cascade paths from
    /// tickets into one table is a schema PostgreSQL will not create. So the
    /// rows have to go by hand, or deleting a ticket fails on a constraint
    /// nobody can see from the delete button.
    /// </summary>
    public Task ClearIncomingAsync(Guid ticketId, CancellationToken ct) =>
        db.TicketRelations.Where(r => r.RelatedTicketId == ticketId).ExecuteDeleteAsync(ct);

    // ---- Helpers --------------------------------------------------------------

    private IQueryable<TicketRelation> Linked(Guid workspaceId) =>
        db.TicketRelations.Where(r => r.WorkspaceId == workspaceId);

    /// <summary>Still being worked — the only state in which a link constrains anything.</summary>
    private static System.Linq.Expressions.Expression<Func<Ticket, bool>> Unfinished() =>
        t => t.StatusCategory != TicketStatusCategory.Resolved
             && t.StatusCategory != TicketStatusCategory.Closed;

    /// <summary>
    /// One projection for every list of "another ticket" this service returns, so
    /// the banner, the resolve dialog and the relations tab describe a linked
    /// ticket in exactly the same terms.
    /// </summary>
    private System.Linq.Expressions.Expression<Func<Ticket, LinkedTicketDto>> Project(Guid workspaceId) =>
        t => new LinkedTicketDto(
            t.Id,
            t.Subject,
            t.Status,
            db.TicketStatuses
                .Where(s => s.WorkspaceId == workspaceId && s.Value == t.Status)
                .Select(s => s.Name)
                .FirstOrDefault() ?? t.Status,
            t.StatusCategory,
            t.Priority,
            UserSummaryDto.From(t.Assignee),
            t.CreatedAt);

    /// <summary>
    /// Both halves of a two-shape lookup, de-duplicated.
    ///
    /// The same pair can legitimately be linked twice with different kinds
    /// ("blocks" and "relates"), and a ticket listed twice in a warning reads as
    /// two separate problems.
    /// </summary>
    private static IReadOnlyList<LinkedTicketDto> Merge(
        List<LinkedTicketDto> written, List<LinkedTicketDto> mirrored) =>
        written
            .Concat(mirrored)
            .GroupBy(t => t.Id)
            .Select(g => g.First())
            .OrderBy(t => t.CreatedAt)
            .ToList();

    private Task<bool> ExistsAsync(Actor actor, Guid ticketId, CancellationToken ct) =>
        db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);

    private async Task<string?> StatusNameAsync(Guid workspaceId, string value, CancellationToken ct) =>
        await db.TicketStatuses
            .Where(s => s.WorkspaceId == workspaceId && s.Value == value)
            .Select(s => s.Name)
            .FirstOrDefaultAsync(ct);

    private static TicketRelationDto Shape(
        Guid id, string kind, Ticket other, string? otherStatusName,
        User? createdBy, DateTime createdAt, bool mirrored) =>
        new(id, kind, other.Id, other.Subject, other.Status, otherStatusName ?? other.Status,
            other.StatusCategory, other.Priority, UserSummaryDto.From(createdBy), createdAt, mirrored);
}

/// <param name="Kind">Already flipped where needed — render it as given.</param>
/// <param name="StatusName">
/// The workspace's word for <paramref name="Status"/>. Render this; switch on
/// <paramref name="StatusCategory"/>.
/// </param>
/// <param name="Mirrored">
/// True when the row was written on the other ticket. The UI does not show this;
/// it exists so a client can tell a derived direction from a stored one without
/// re-deriving the rule.
/// </param>
public record TicketRelationDto(
    Guid Id,
    string Kind,
    Guid TicketId,
    string Subject,
    string Status,
    string StatusName,
    string StatusCategory,
    string Priority,
    UserSummaryDto? CreatedBy,
    DateTime CreatedAt,
    bool Mirrored);

/// <summary>
/// Another ticket, described just far enough to decide something about it — a
/// banner, a warning, a checkbox in the resolve dialog.
///
/// Deliberately not <c>TicketSummaryDto</c>: that carries tags, SLA timestamps,
/// comment counts and a pin, none of which mean anything in a list of "these
/// three are the same issue", and all of which would have to be computed for
/// every row of it.
/// </summary>
public record LinkedTicketDto(
    Guid Id,
    string Subject,
    string Status,
    string StatusName,
    string StatusCategory,
    string Priority,
    UserSummaryDto? Assignee,
    DateTime CreatedAt);

/// <param name="Total">Every link, whatever the kind — the number on the tab.</param>
/// <param name="DuplicateCount">How many of them say "same issue".</param>
/// <param name="Blockers">Open tickets holding this one up. Non-empty means the banner shows.</param>
/// <param name="Blocking">Open tickets this one is holding up — who starts moving when it ends.</param>
public record TicketRelationSummaryDto(
    int Total,
    int DuplicateCount,
    IReadOnlyList<LinkedTicketDto> Blockers,
    IReadOnlyList<LinkedTicketDto> Blocking);
