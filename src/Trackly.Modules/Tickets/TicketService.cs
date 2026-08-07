using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Csat;
using Trackly.Modules.Email;

namespace Trackly.Modules.Tickets;

public class TicketService(
    TracklyDbContext db, NotificationService notifications, SlaService sla, AutomationService automation,
    CsatService csat, TagService tags, TicketOptionService options)
{
    // ---- Queries ------------------------------------------------------------

    // Workspace isolation + role scoping for every ticket read. Customers only
    // ever see their own tickets; agents and admins see the whole workspace.
    private IQueryable<Ticket> VisibleTickets(Actor actor)
    {
        var query = db.Tickets.Where(t => t.WorkspaceId == actor.WorkspaceId);
        if (!actor.IsAgentOrAdmin)
            query = query.Where(t => t.RequesterId == actor.UserId);
        return query;
    }

    public async Task<(IReadOnlyList<TicketSummaryDto> Items, int Total)> ListAsync(
        Actor actor, TicketListQuery query, CancellationToken ct)
    {
        var tickets = VisibleTickets(actor);

        if (!string.IsNullOrWhiteSpace(query.Status))
            tickets = tickets.Where(t => t.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Priority))
            tickets = tickets.Where(t => t.Priority == query.Priority);
        if (query.AssigneeId is not null && actor.IsAgentOrAdmin)
            tickets = tickets.Where(t => t.AssigneeId == query.AssigneeId);
        if (!string.IsNullOrWhiteSpace(query.Tag) && actor.IsAgentOrAdmin)
            tickets = tickets.Where(t => t.TicketTags.Any(tt => tt.Tag.Name == query.Tag));
        if (query.TeamId is not null && actor.IsAgentOrAdmin)
            tickets = tickets.Where(t => t.TeamId == query.TeamId);
        if (!string.IsNullOrWhiteSpace(query.Search))
            tickets = tickets.Where(t => EF.Functions.ILike(t.Subject, $"%{query.Search}%"));

        var total = await tickets.CountAsync(ct);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var page = Math.Max(query.Page, 1);

        var items = await tickets
            .OrderByDescending(t => t.UpdatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new TicketSummaryDto(
                t.Id, t.Subject, t.Status, t.Priority, t.Channel,
                CategoryDto.From(t.Category),
                UserSummaryDto.From(t.Requester),
                t.GuestName, t.GuestEmail,
                UserSummaryDto.From(t.Assignee),
                t.Comments.Count(c => !c.IsInternal || actor.IsAgentOrAdmin),
                // Tags are agent-facing metadata — never on customer surfaces.
                actor.IsAgentOrAdmin
                    ? t.TicketTags.Select(tt => new TagDto(tt.Tag.Id, tt.Tag.Name, tt.Tag.Color)).ToList()
                    : new List<TagDto>(),
                actor.IsAgentOrAdmin ? t.FirstResponseDueAt : null,
                actor.IsAgentOrAdmin ? t.ResolveDueAt : null,
                actor.IsAgentOrAdmin ? t.FirstResponseAt : null,
                t.CreatedAt, t.UpdatedAt))
            .ToListAsync(ct);

        return (items, total);
    }

    public async Task<TicketDetailDto?> GetAsync(Actor actor, Guid ticketId, CancellationToken ct)
    {
        var ticket = await VisibleTickets(actor)
            .Include(t => t.Category)
            .Include(t => t.Requester)
            .Include(t => t.Assignee)
            .Include(t => t.Watchers).ThenInclude(w => w.Agent)
            .Include(t => t.TicketTags).ThenInclude(tt => tt.Tag)
            .Include(t => t.Team)
            .SingleOrDefaultAsync(t => t.Id == ticketId, ct);
        // Problem grouping and tags are internal — never expose them to a customer.
        return ticket is null ? null : ToDetail(ticket, actor.IsAgentOrAdmin);
    }

    // ---- Create + round-robin assignment ------------------------------------

    public async Task<TicketDetailDto> CreateAsync(
        Actor actor, CreateTicketRequest request, CancellationToken ct)
    {
        // Priority and channel are workspace-configured now, so the valid set is
        // a query rather than a constant. TicketPriority.Medium is still the
        // fallback: it is seeded for every workspace and cannot be the one that
        // gets deactivated away (the service refuses to leave a kind empty).
        var priority = request.Priority ?? TicketPriority.Medium;
        var allowedPriorities = await options.ActiveValuesAsync(
            actor.WorkspaceId, TicketOptionKind.Priority, ct);
        if (!allowedPriorities.Contains(priority))
            throw new ArgumentException("Invalid priority.");

        Guid? categoryId = null;
        if (request.CategoryId is not null)
        {
            categoryId = await db.Categories
                .Where(c => c.WorkspaceId == actor.WorkspaceId && c.Id == request.CategoryId)
                .Select(c => (Guid?)c.Id)
                .SingleOrDefaultAsync(ct);
            if (categoryId is null)
                throw new ArgumentException("Unknown category.");
        }
        else if (actor.IsAgentOrAdmin && !string.IsNullOrWhiteSpace(request.CategoryName))
        {
            categoryId = (await ResolveCategoryAsync(actor.WorkspaceId, request.CategoryName, ct)).Id;
        }

        var channel = TicketChannel.Web;
        if (actor.IsAgentOrAdmin && !string.IsNullOrWhiteSpace(request.Channel))
        {
            channel = NormalizeChannel(request.Channel);
            var allowedChannels = await options.ActiveValuesAsync(
                actor.WorkspaceId, TicketOptionKind.Channel, ct);
            if (!allowedChannels.Contains(channel))
                throw new ArgumentException("Invalid channel.");
        }

        // Tags are resolved BEFORE the ticket is added, so the Tag rows their
        // SaveChanges writes cannot drag a half-built ticket into the database
        // ahead of automation and SLA.
        var resolvedTags = actor.IsAgentOrAdmin && request.Tags is { Count: > 0 }
            ? await tags.ResolveAsync(actor.WorkspaceId, request.Tags, ct)
            : [];

        // Who the ticket is FOR, which is not the same question as who filed it.
        //
        // A customer using the portal is always their own requester. An agent is
        // filing on someone else's behalf, so they get whoever they picked — and
        // picking nobody leaves it genuinely empty rather than quietly naming the
        // agent. Defaulting to the agent made every internally-raised ticket look
        // like the agent's own support request, and made "add the customer later"
        // impossible because the slot was already taken.
        //
        // RequesterId is nullable for exactly this reason: guest tickets have no
        // user behind them either.
        Guid? requesterId = actor.IsAgentOrAdmin ? null : actor.UserId;
        if (actor.IsAgentOrAdmin && request.RequesterId is { } onBehalfOf)
        {
            // Membership is re-checked rather than trusted from the client, or
            // any user id in the system could be attached to this workspace.
            var exists = await db.Users
                .AnyAsync(u => u.Id == onBehalfOf && u.WorkspaceId == actor.WorkspaceId, ct);
            if (!exists) throw new ArgumentException("Unknown requester.");
            requesterId = onBehalfOf;
        }

        Guid? teamId = null;
        if (actor.IsAgentOrAdmin && request.TeamId is { } wantedTeam)
        {
            var exists = await db.Teams
                .AnyAsync(t => t.Id == wantedTeam && t.WorkspaceId == actor.WorkspaceId, ct);
            if (!exists) throw new ArgumentException("Unknown team.");
            teamId = wantedTeam;
        }

        var ticket = new Ticket
        {
            WorkspaceId = actor.WorkspaceId,
            Subject = request.Subject.Trim(),
            Description = request.Description.Trim(),
            Priority = priority,
            CategoryId = categoryId,
            Channel = channel,
            TeamId = teamId,
            RequesterId = requesterId,
        };
        db.Tickets.Add(ticket);

        // Navigation property, not ticket.Id — the id isn't known until save.
        foreach (var tag in resolvedTags)
            db.TicketTags.Add(new TicketTag { Ticket = ticket, Tag = tag });

        // Scoped to the chosen department, so picking one actually routes the
        // ticket instead of only labelling it.
        var assigneeId = await PickRoundRobinAssigneeAsync(actor.WorkspaceId, teamId, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment
            {
                Ticket = ticket,
                AssignedTo = assigneeId.Value,
                AssignedBy = null, // auto-assigned
            });
        }

        // Automation may change priority/team/tags before SLA is computed.
        await automation.RunOnCreateAsync(ticket, ct);
        await sla.ApplyOnCreateAsync(ticket, ct);
        await db.SaveChangesAsync(ct);
        await notifications.OnTicketCreatedAsync(ticket.Id, ct);
        return (await GetAsync(actor, ticket.Id, ct))!;
    }

    // Get-or-create by name, so an agent can type a department that doesn't exist
    // yet on the new-ticket form instead of filing uncategorised and waiting for
    // an admin. Matching is case-insensitive: "Billing" and "billing" must not
    // become two departments that then split every report in two.
    //
    // Deliberately NOT the same as POST /api/categories, which stays admin-only
    // and 409s on a duplicate. That endpoint manages the taxonomy; this one just
    // needs a row to point at.
    private async Task<Category> ResolveCategoryAsync(
        Guid workspaceId, string rawName, CancellationToken ct)
    {
        var name = rawName.Trim();
        if (name.Length > 80) name = name[..80];

        var existing = await db.Categories
            .FirstOrDefaultAsync(c => c.WorkspaceId == workspaceId && c.Name.ToLower() == name.ToLower(), ct);
        if (existing is not null) return existing;

        var category = new Category { WorkspaceId = workspaceId, Name = name };
        db.Categories.Add(category);
        await db.SaveChangesAsync(ct);
        return category;
    }

    // Channel is matched verbatim by automation rules and mapped to an icon in the
    // list, so it is lower-cased and whitespace-collapsed before it is stored.
    // Without that, "Phone", "phone" and "phone " are three channels that no rule
    // written for any one of them will ever match.
    private static string NormalizeChannel(string raw)
    {
        var channel = string.Join(' ', raw.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .ToLowerInvariant();
        return channel.Length > 32 ? channel[..32] : channel;
    }

    // Active agent with the fewest open/pending tickets. Also used for guest tickets.
    // When teamId is given, only that team's members are considered (team routing).
    public async Task<Guid?> PickRoundRobinAssigneeAsync(
        Guid workspaceId, Guid? teamId, CancellationToken ct)
    {
        var candidates = db.Users
            .Where(u => u.WorkspaceId == workspaceId && u.IsActive && u.Role == TracklyRoles.Agent);
        if (teamId is not null)
            candidates = candidates.Where(u => db.TeamMembers.Any(m => m.TeamId == teamId && m.UserId == u.Id));

        return await candidates
            .Select(u => new
            {
                u.Id,
                OpenCount = db.Tickets.Count(t =>
                    t.AssigneeId == u.Id &&
                    (t.Status == TicketStatus.Open || t.Status == TicketStatus.Pending)),
            })
            .OrderBy(x => x.OpenCount)
            .ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(ct);
    }

    // ---- Update (agent/admin) ------------------------------------------------

    public async Task<TicketDetailDto?> UpdateAsync(
        Actor actor, Guid ticketId, UpdateTicketRequest request, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);
        if (ticket is null)
            return null;

        var previousStatus = ticket.Status;
        var previousAssignee = ticket.AssigneeId;
        var previousPriority = ticket.Priority;

        if (request.Subject is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Subject))
                throw new ArgumentException("Subject cannot be empty.");
            ticket.Subject = request.Subject.Trim();
        }

        if (request.Status is not null)
        {
            if (!TicketStatus.All.Contains(request.Status))
                throw new ArgumentException("Invalid status.");
            ticket.Status = request.Status;
            // Track the resolution time for analytics (Phase 7C). Resolved re-stamps;
            // Closed keeps an existing stamp (or sets one if closed directly);
            // reopening to Open/Pending clears it.
            if (ticket.Status != previousStatus)
                ticket.ResolvedAt = ticket.Status switch
                {
                    TicketStatus.Resolved => DateTime.UtcNow,
                    TicketStatus.Closed => ticket.ResolvedAt ?? DateTime.UtcNow,
                    _ => null,
                };
        }

        if (request.Priority is not null)
        {
            // Same configured set as create — otherwise a workspace's own
            // priority could be chosen on the form and rejected on edit.
            var allowed = await options.ActiveValuesAsync(
                actor.WorkspaceId, TicketOptionKind.Priority, ct);
            if (!allowed.Contains(request.Priority))
                throw new ArgumentException("Invalid priority.");
            ticket.Priority = request.Priority;
        }

        if (request.ClearRequester)
        {
            ticket.RequesterId = null;
        }
        else if (request.RequesterId is { } newRequester)
        {
            var requesterExists = await db.Users
                .AnyAsync(u => u.Id == newRequester && u.WorkspaceId == actor.WorkspaceId, ct);
            if (!requesterExists) throw new ArgumentException("Unknown requester.");
            ticket.RequesterId = newRequester;
            // The guest fields were only ever a stand-in for a person Trackly
            // didn't have on file. Once it has one they are stale, and leaving
            // them means two answers to "who reported this".
            ticket.GuestName = null;
            ticket.GuestEmail = null;
        }

        if (request.ClearCategory)
        {
            ticket.CategoryId = null;
        }
        else if (request.CategoryId is not null)
        {
            var exists = await db.Categories.AnyAsync(
                c => c.WorkspaceId == actor.WorkspaceId && c.Id == request.CategoryId, ct);
            if (!exists)
                throw new ArgumentException("Unknown category.");
            ticket.CategoryId = request.CategoryId;
        }

        if (request.ClearTeam)
        {
            ticket.TeamId = null;
        }
        else if (request.TeamId is not null && request.TeamId != ticket.TeamId)
        {
            var teamExists = await db.Teams.AnyAsync(
                t => t.WorkspaceId == actor.WorkspaceId && t.Id == request.TeamId, ct);
            if (!teamExists)
                throw new ArgumentException("Unknown team.");
            ticket.TeamId = request.TeamId;

            // Route: round-robin within the team (an explicit assignee below still wins).
            var teamAssignee = await PickRoundRobinAssigneeAsync(actor.WorkspaceId, request.TeamId, ct);
            if (teamAssignee is not null)
            {
                ticket.AssigneeId = teamAssignee;
                db.TicketAssignments.Add(new TicketAssignment
                {
                    TicketId = ticket.Id,
                    AssignedTo = teamAssignee.Value,
                    AssignedBy = actor.UserId,
                });
            }
        }

        if (request.Unassign)
        {
            ticket.AssigneeId = null;
        }
        else if (request.AssigneeId is not null && request.AssigneeId != ticket.AssigneeId)
        {
            var isAssignable = await db.Users.AnyAsync(u =>
                u.WorkspaceId == actor.WorkspaceId && u.Id == request.AssigneeId &&
                u.IsActive && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
            if (!isAssignable)
                throw new ArgumentException("Assignee must be an active agent or admin in this workspace.");
            ticket.AssigneeId = request.AssigneeId;
            db.TicketAssignments.Add(new TicketAssignment
            {
                TicketId = ticket.Id,
                AssignedTo = request.AssigneeId.Value,
                AssignedBy = actor.UserId,
            });
        }

        // SLA: recompute on priority change, pause/resume on status change.
        if (ticket.Priority != previousPriority)
            await sla.OnPriorityChangedAsync(ticket, ct);
        if (ticket.Status != previousStatus)
            sla.OnStatusChanged(ticket, previousStatus, ticket.Status);

        // Automation on update runs after the agent's change (its own mutations
        // are not re-evaluated, so rules can't loop).
        await automation.RunOnUpdateAsync(ticket, ct);

        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (ticket.Status != previousStatus)
        {
            if (ticket.Status == TicketStatus.Resolved)
            {
                // Issue a CSAT survey and fold its rating link into the resolution email.
                var csatToken = await csat.IssueForResolutionAsync(ticket, ct);
                await notifications.OnResolvedAsync(ticket.Id, csatToken, ct);
            }
            else
            {
                await notifications.OnStatusChangedAsync(ticket.Id, ticket.Status, ct);
            }
        }
        if (ticket.AssigneeId is { } newAssignee && newAssignee != previousAssignee)
            await notifications.OnAssignmentAsync(ticket.Id, newAssignee, reassigned: previousAssignee is not null, ct);

        return await GetAsync(actor, ticketId, ct);
    }

    // ---- Watchers -------------------------------------------------------------

    public async Task<bool> AddWatcherAsync(Actor actor, Guid ticketId, Guid agentId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var ticketExists = await db.Tickets.AnyAsync(
            t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);
        if (!ticketExists)
            return false;

        var isWatchable = await db.Users.AnyAsync(u =>
            u.WorkspaceId == actor.WorkspaceId && u.Id == agentId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (!isWatchable)
            throw new ArgumentException("Watcher must be an active agent or admin in this workspace.");

        var already = await db.TicketWatchers.AnyAsync(
            w => w.TicketId == ticketId && w.AgentId == agentId, ct);
        if (!already)
        {
            db.TicketWatchers.Add(new TicketWatcher
            {
                TicketId = ticketId,
                AgentId = agentId,
                AddedBy = actor.UserId,
            });
            await db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task<bool> RemoveWatcherAsync(Actor actor, Guid ticketId, Guid agentId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var ticketExists = await db.Tickets.AnyAsync(
            t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);
        if (!ticketExists)
            return false;

        await db.TicketWatchers
            .Where(w => w.TicketId == ticketId && w.AgentId == agentId)
            .ExecuteDeleteAsync(ct);
        return true;
    }

    // ---- Comments ---------------------------------------------------------------

    public async Task<IReadOnlyList<CommentDto>?> ListCommentsAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        var ticketVisible = await VisibleTickets(actor).AnyAsync(t => t.Id == ticketId, ct);
        if (!ticketVisible)
            return null;

        var comments = db.Comments.Where(c => c.TicketId == ticketId);
        // Private notes never reach customers — enforced here, not in the UI.
        if (!actor.IsAgentOrAdmin)
            comments = comments.Where(c => !c.IsInternal);

        var attachments = await db.Attachments
            .Where(a => a.TicketId == ticketId && a.CommentId != null)
            .ToListAsync(ct);

        var list = await comments
            .Include(c => c.Author)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);

        return list.Select(c => new CommentDto(
            c.Id,
            UserSummaryDto.From(c.Author),
            c.GuestEmail,
            c.Body,
            c.IsInternal,
            c.Source,
            attachments
                .Where(a => a.CommentId == c.Id)
                .Select(a => new AttachmentDto(a.Id, a.CommentId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt))
                .ToList(),
            c.CreatedAt)).ToList();
    }

    public async Task<CommentDto?> AddCommentAsync(
        Actor actor, Guid ticketId, CreateCommentRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Body))
            throw new ArgumentException("Comment body is required.");

        var ticket = await VisibleTickets(actor).SingleOrDefaultAsync(t => t.Id == ticketId, ct);
        if (ticket is null)
            return null;

        var comment = new Comment
        {
            TicketId = ticket.Id,
            AuthorId = actor.UserId,
            Body = request.Body.Trim(),
            // Customers can never create private notes — is_internal is forced off.
            IsInternal = actor.IsAgentOrAdmin && request.IsInternal,
        };
        db.Comments.Add(comment);
        ticket.UpdatedAt = DateTime.UtcNow;
        // First public agent reply stops the first-response SLA clock.
        if (actor.IsAgentOrAdmin && !comment.IsInternal)
            sla.OnAgentReply(ticket);
        await db.SaveChangesAsync(ct);

        // Internal notes stay internal — no external notification. External
        // replies notify the other party (agent → customer, customer → agents).
        if (!comment.IsInternal)
            await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent: actor.IsAgentOrAdmin, ct);

        var author = await db.Users.SingleAsync(u => u.Id == actor.UserId, ct);
        return new CommentDto(
            comment.Id, UserSummaryDto.From(author), null, comment.Body,
            comment.IsInternal, comment.Source, [], comment.CreatedAt);
    }

    // ---- Mapping -----------------------------------------------------------------

    private static TicketDetailDto ToDetail(Ticket t, bool isAgentOrAdmin) => new(
        t.Id, t.Subject, t.Description, t.Status, t.Priority, t.Channel,
        CategoryDto.From(t.Category),
        UserSummaryDto.From(t.Requester),
        t.GuestName, t.GuestEmail,
        UserSummaryDto.From(t.Assignee),
        t.Watchers.Select(w => new WatcherDto(UserSummaryDto.From(w.Agent)!, w.AddedAt)).ToList(),
        isAgentOrAdmin
            ? t.TicketTags.Select(tt => new TagDto(tt.Tag.Id, tt.Tag.Name, tt.Tag.Color)).ToList()
            : new List<TagDto>(),
        isAgentOrAdmin ? t.ProblemId : null,
        isAgentOrAdmin ? t.TeamId : null,
        isAgentOrAdmin ? t.Team?.Name : null,
        isAgentOrAdmin ? t.FirstResponseDueAt : null,
        isAgentOrAdmin ? t.ResolveDueAt : null,
        isAgentOrAdmin ? t.FirstResponseAt : null,
        t.CreatedAt, t.UpdatedAt);
}
