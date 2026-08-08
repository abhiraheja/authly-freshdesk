using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Ticket-to-ticket links.
///
/// **One row, read from both ends.** Writing "A duplicates B" stores a single
/// row on A; B's card shows the same fact as "duplicated by A", derived from
/// <see cref="TicketRelationKind.Inverse"/>. Storing the mirror row too would
/// mean two records of one fact that can fall out of step — delete one and the
/// pair goes half-broken, with each ticket telling a different story.
///
/// Agent-facing (invariant 5): which other tickets a customer's problem is
/// related to is internal, and often about other customers entirely.
/// </summary>
public class TicketRelationService(TracklyDbContext db, ActivityLog activity)
{
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
            })
            .ToListAsync(ct);

        return outgoing
            .Select(r => Shape(r.Id, r.Kind, r.Other, r.CreatedBy, r.CreatedAt, mirrored: false))
            .Concat(incoming.Select(r =>
                Shape(r.Id, TicketRelationKind.Inverse(r.Kind), r.Other, r.CreatedBy, r.CreatedAt, mirrored: true)))
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
            TicketActivityType.LinkAdded, $"#{Short(relatedTicketId)} {other.Subject}");
        activity.Happened(actor.WorkspaceId, relatedTicketId, actor.UserId,
            TicketActivityType.LinkAdded, $"#{Short(ticketId)}");

        await db.SaveChangesAsync(ct);
        await db.Entry(relation).Reference(r => r.CreatedBy).LoadAsync(ct);
        return Shape(relation.Id, kind, other, relation.CreatedBy, relation.CreatedAt, mirrored: false);
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
            TicketActivityType.LinkRemoved, $"#{Short(relation.RelatedTicketId)}");
        activity.Happened(actor.WorkspaceId, relation.RelatedTicketId, actor.UserId,
            TicketActivityType.LinkRemoved, $"#{Short(relation.TicketId)}");
        await db.SaveChangesAsync(ct);
        return true;
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

    private Task<bool> ExistsAsync(Actor actor, Guid ticketId, CancellationToken ct) =>
        db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);

    private static string Short(Guid id) => id.ToString()[..8];

    private static TicketRelationDto Shape(
        Guid id, string kind, Ticket other, User? createdBy, DateTime createdAt, bool mirrored) =>
        new(id, kind, other.Id, other.Subject, other.Status, other.StatusCategory,
            other.Priority, UserSummaryDto.From(createdBy), createdAt, mirrored);
}

/// <param name="Kind">Already flipped where needed — render it as given.</param>
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
    string StatusCategory,
    string Priority,
    UserSummaryDto? CreatedBy,
    DateTime CreatedAt,
    bool Mirrored);
