using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// What a bulk request is asking for. One action per request — a payload that
/// could reassign AND resolve AND retag in one call would have to define what
/// happens when the middle one fails, and there is no answer to that which the
/// bar at the top of a list can report honestly.
/// </summary>
public static class TicketBulkAction
{
    public const string Assign = "assign";
    public const string Priority = "priority";
    public const string Status = "status";
    public const string Tag = "tag";
    public const string Pin = "pin";
    public const string Flag = "flag";
    public const string Delete = "delete";
}

/// <param name="Ids">The selected tickets. Duplicates are collapsed.</param>
/// <param name="Unassign">
/// Explicit, because "no assignee" cannot be expressed as an id — the same
/// reason the list query carries its own <c>Unassigned</c> flag.
/// </param>
/// <param name="On">
/// For the two toggles (pin, flag): true sets, false clears. A single action
/// value plus a direction, rather than four action names, because "pin" and
/// "unpin" are one decision the bar has already made for the whole selection.
/// </param>
/// <param name="ResolutionNote">
/// Shared by every ticket in the batch when the target status ends the work.
/// One note for many tickets is a real limitation and it is stated in the UI;
/// it is still better than the alternative, which is agents typing "." twenty
/// times to get past a per-ticket prompt.
/// </param>
public record TicketBulkRequest(
    List<Guid> Ids,
    string Action,
    Guid? AssigneeId = null,
    bool Unassign = false,
    string? Priority = null,
    string? Status = null,
    string? ResolutionNote = null,
    string? ResolutionSummary = null,
    List<string>? Tags = null,
    bool On = true,
    string? Reason = null);

/// <param name="Subject">
/// Named, not just identified. "3 tickets failed" is not something an agent can
/// act on; "Refund not received — cannot move straight to Closed" is.
/// </param>
public record TicketBulkFailure(Guid Id, string Subject, string Reason);

/// <summary>
/// A bulk write is <b>partial by design</b>: it reports what went through and
/// what did not, rather than rolling the whole batch back.
/// </summary>
/// <remarks>
/// The alternative — all-or-nothing — sounds safer and is worse here. A workflow
/// that forbids one of forty transitions would undo thirty-nine legitimate
/// changes, and the agent's only recourse would be to deselect rows by guesswork
/// until the batch happened to pass. Each ticket is its own transaction inside
/// <see cref="TicketService.UpdateAsync"/> already, so partial is also what the
/// database actually does; pretending otherwise in the response would just make
/// the report wrong.
/// </remarks>
public record TicketBulkResult(int Succeeded, IReadOnlyList<TicketBulkFailure> Failed)
{
    public int Requested => Succeeded + Failed.Count;
}

/// <summary>
/// The bulk bar above the ticket list.
///
/// <b>Every action routes through the single-ticket path.</b> Assign, priority
/// and status all build an <see cref="UpdateTicketRequest"/> and call
/// <see cref="TicketService.UpdateAsync"/> once per ticket; delete goes through
/// the one delete method. That is deliberately not the fast implementation — a
/// single <c>ExecuteUpdate</c> would do the assign in one statement — but it is
/// the only one that keeps the workflow rules, the activity log, the SLA clock,
/// the watcher notifications and the resolution email identical to what happens
/// when the same change is made from the ticket screen. A second code path here
/// would drift, and it would drift silently: nothing about a bulk assign that
/// skipped notifications looks wrong until somebody asks why they were never
/// told about forty tickets.
/// </summary>
public class TicketBulkService(
    TracklyDbContext db,
    TicketService tickets,
    TagService tags,
    TicketRelationService relations,
    IWorkspaceFileStorage storage,
    ILogger<TicketBulkService> log)
{
    /// <summary>
    /// The most tickets one call may touch.
    ///
    /// Each one is a transaction with its own notifications, so a batch of a
    /// thousand is a request that runs for minutes and times out halfway with
    /// nobody able to say where it stopped. The list pages at 20; a cap five
    /// times the largest page is room to select several pages' worth and still
    /// finish inside a request.
    /// </summary>
    public const int MaxTickets = 100;

    public async Task<TicketBulkResult> RunAsync(
        Actor actor, TicketBulkRequest request, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var ids = request.Ids?.Where(id => id != Guid.Empty).Distinct().ToList() ?? [];
        if (ids.Count == 0)
            throw new ArgumentException("Select at least one ticket.");
        if (ids.Count > MaxTickets)
            throw new ArgumentException($"Select at most {MaxTickets} tickets at a time.");

        // Subjects up front, in one query, and BEFORE anything is touched:
        // after a delete there is nothing left to name the ticket with, and
        // after a resolve the subject may have been the thing that changed.
        var subjects = await db.Tickets
            .Where(t => t.WorkspaceId == actor.WorkspaceId && ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.Subject, ct);

        // Deleting is the one action that is not simply "an update applied many
        // times", so it is checked once here rather than per ticket.
        if (request.Action == TicketBulkAction.Delete && !actor.IsAdmin)
            throw new UnauthorizedAccessException();

        var update = BuildUpdate(request);

        var succeeded = 0;
        var failed = new List<TicketBulkFailure>();

        foreach (var id in ids)
        {
            // Not in the workspace, or already gone. Reported rather than
            // ignored: a selection that half-disappeared while the agent was
            // reading it is exactly the case they need to be told about.
            if (!subjects.TryGetValue(id, out var subject))
            {
                failed.Add(new TicketBulkFailure(id, $"#{Short(id)}", "No longer exists."));
                continue;
            }

            try
            {
                var applied = request.Action switch
                {
                    TicketBulkAction.Delete => await DeleteAsync(actor, id, ct),
                    TicketBulkAction.Pin => await tickets.SetPinnedAsync(actor, id, request.On, ct),
                    TicketBulkAction.Flag =>
                        await tickets.SetFlaggedAsync(actor, id, request.On, request.Reason, ct),
                    TicketBulkAction.Tag => await TagAsync(actor, id, request, ct),
                    _ => await tickets.UpdateAsync(actor, id, update!, ct) is not null,
                };

                if (applied) succeeded++;
                else failed.Add(new TicketBulkFailure(id, subject, "No longer exists."));
            }
            catch (ArgumentException ex)
            {
                // The rule that refused it, verbatim — "cannot move straight to
                // Closed", "Invalid priority". These messages were written to be
                // read by the agent on the ticket screen and they read just as
                // well beside a row here.
                failed.Add(new TicketBulkFailure(id, subject, ex.Message));
            }
            catch (Exception ex)
            {
                // One ticket blowing up must not take the batch with it. Logged
                // with its id so the server-side story is complete, and reported
                // without the exception text, which is not for the agent.
                log.LogError(ex, "Bulk {Action} failed for ticket {TicketId}", request.Action, id);
                failed.Add(new TicketBulkFailure(id, subject, "Something went wrong."));
            }
        }

        return new TicketBulkResult(succeeded, failed);
    }

    /// <summary>
    /// Turns the bulk payload into the same request shape the ticket screen
    /// sends. Null for the actions that are not updates.
    /// </summary>
    private static UpdateTicketRequest? BuildUpdate(TicketBulkRequest request) => request.Action switch
    {
        TicketBulkAction.Assign => new UpdateTicketRequest(
            Subject: null, Status: null, Priority: null, CategoryId: null,
            AssigneeId: request.Unassign ? null : request.AssigneeId,
            Unassign: request.Unassign),

        TicketBulkAction.Priority => new UpdateTicketRequest(
            Subject: null, Status: null,
            Priority: request.Priority ?? throw new ArgumentException("Pick a priority."),
            CategoryId: null),

        TicketBulkAction.Status => new UpdateTicketRequest(
            Subject: null,
            Status: request.Status ?? throw new ArgumentException("Pick a status."),
            Priority: null, CategoryId: null,
            ResolutionNote: request.ResolutionNote,
            ResolutionSummary: request.ResolutionSummary),

        TicketBulkAction.Tag or TicketBulkAction.Pin or TicketBulkAction.Flag or TicketBulkAction.Delete => null,

        _ => throw new ArgumentException("Unknown bulk action."),
    };

    /// <summary>
    /// Adds tags, keeping the ones already there.
    ///
    /// Bulk tagging that REPLACED would quietly strip every tag the selection
    /// already carried — forty tickets losing their labels because somebody
    /// wanted to add "escalated" to all of them.
    /// </summary>
    private async Task<bool> TagAsync(
        Actor actor, Guid id, TicketBulkRequest request, CancellationToken ct)
    {
        var wanted = request.Tags?.Where(t => !string.IsNullOrWhiteSpace(t)).ToList() ?? [];
        if (wanted.Count == 0) throw new ArgumentException("Type at least one tag.");

        var existing = await db.TicketTags
            .Where(tt => tt.TicketId == id)
            .Select(tt => tt.Tag.Name)
            .ToListAsync(ct);

        var merged = existing
            .Concat(wanted)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return await tags.SetTicketTagsAsync(actor, id, merged, ct) is not null;
    }

    /// <summary>
    /// Deletes a ticket and everything hanging off it. <b>Admin only</b> — see
    /// the check in <see cref="RunAsync"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Most child rows go by database cascade, which is both faster and the only
    /// version that cannot be forgotten when a new child table is added. Two
    /// things cannot: links pointing AT this ticket (the incoming foreign key is
    /// NO ACTION, because PostgreSQL refuses a schema with two cascade paths
    /// into one table) and the attachment blobs, which live outside the database
    /// entirely and would otherwise be orphaned in the bucket forever.
    /// </para>
    /// <para>
    /// The links are <b>loaded and removed</b>, not <c>ExecuteDelete</c>d, even
    /// though one statement would obviously be cheaper. Two reasons, and the
    /// first is not theoretical — it is what a harness caught here:
    /// <c>ExecuteDelete</c> writes straight past the change tracker, so any
    /// relation the request has already loaded is still sitting there when the
    /// ticket is removed, and EF refuses the save with "the association has been
    /// severed" for a row the database no longer has. The second is atomicity:
    /// <c>ExecuteDelete</c> commits its own transaction, so a failure between it
    /// and <c>SaveChanges</c> would leave the links gone and the ticket intact.
    /// This way both land in one transaction or neither does.
    /// </para>
    /// <para>
    /// Blobs are deleted <b>after</b> the row, not before. If the delete fails
    /// the ticket is still whole and still readable; the other order would leave
    /// a ticket whose attachments 404.
    /// </para>
    /// </remarks>
    private async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == id && t.WorkspaceId == actor.WorkspaceId, ct);
        if (ticket is null) return false;

        var keys = await db.Attachments
            .Where(a => a.TicketId == id)
            .Select(a => a.StorageKey)
            .ToListAsync(ct);

        // Both directions. The outgoing half cascades in the database, but once
        // a row is in the change tracker EF decides its fate itself — and it
        // cannot see the cascade, so it would try to null a non-nullable key.
        var links = await db.TicketRelations
            .Where(r => r.TicketId == id || r.RelatedTicketId == id)
            .ToListAsync(ct);
        db.TicketRelations.RemoveRange(links);

        // Mentions, for the same reason as links: comment_mentions.ticket_id is
        // NO ACTION.
        //
        // The model comment used to claim the comment's own cascade cleared
        // these in time. It does not, and PostgreSQL says so plainly —
        // "violates foreign key constraint fk_comment_mentions_tickets_ticket_id".
        // The ticket's referencing keys are checked against the row being
        // deleted, and the cascade that would empty this table hangs off
        // comments, one level further down. So it has to be done here.
        var mentions = await db.CommentMentions.Where(m => m.TicketId == id).ToListAsync(ct);
        db.CommentMentions.RemoveRange(mentions);

        db.Tickets.Remove(ticket);
        await db.SaveChangesAsync(ct);

        foreach (var key in keys)
        {
            try
            {
                await storage.DeleteAsync(actor.WorkspaceId, key, ct);
            }
            catch (Exception ex)
            {
                // A blob that will not delete is a leak, not a failure: the
                // ticket is already gone and telling the agent it did not work
                // would be untrue. Logged so it can be swept later.
                log.LogWarning(ex, "Orphaned attachment blob {Key} after deleting ticket {TicketId}", key, id);
            }
        }

        return true;
    }

    private static string Short(Guid id) => id.ToString()[..8];
}
