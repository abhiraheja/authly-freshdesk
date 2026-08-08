using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Text;
using Trackly.Modules.Csat;
using Trackly.Modules.Email;
using Trackly.Modules.Notifications;

namespace Trackly.Modules.Tickets;

public class TicketService(
    TracklyDbContext db, NotificationService notifications, SlaService sla, AutomationService automation,
    CsatService csat, TagService tags, TicketOptionService options, NotificationFeed feed,
    TicketStatusService statuses, ActivityLog activity)
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

    /// <summary>
    /// Applies the query's filters, optionally leaving one field out.
    ///
    /// <paramref name="except"/> is what makes the facet counts usable: a facet
    /// group has to be counted with every filter EXCEPT its own, or picking
    /// "Open" leaves every other status reading zero and there is no way to see
    /// what else exists — or to widen the selection to include it.
    /// </summary>
    private IQueryable<Ticket> Filtered(Actor actor, TicketListQuery query, string? except = null)
    {
        var tickets = VisibleTickets(actor);
        var agent = actor.IsAgentOrAdmin;

        if (except != "status" && query.Status is { Count: > 0 } statuses)
            tickets = tickets.Where(t => statuses.Contains(t.Status));
        // Shares the "status" facet key deliberately: both narrow the same
        // column of the rail, so counting one while the other is applied would
        // report numbers the results underneath do not match.
        if (except != "status" && query.Category is { Count: > 0 } statusCategories)
            tickets = tickets.Where(t => statusCategories.Contains(t.StatusCategory));
        if (except != "priority" && query.Priority is { Count: > 0 } priorities)
            tickets = tickets.Where(t => priorities.Contains(t.Priority));
        if (except != "channel" && query.Channel is { Count: > 0 } channels)
            tickets = tickets.Where(t => channels.Contains(t.Channel));

        if (agent && except != "assignee")
        {
            // Unassigned is its own flag because "nobody" has no id. When both
            // are given they are an OR: "mine or nobody's" is a real queue view.
            var wanted = query.AssigneeId;
            if (query.Unassigned && wanted is { Count: > 0 })
                tickets = tickets.Where(t => t.AssigneeId == null || wanted.Contains(t.AssigneeId!.Value));
            else if (query.Unassigned)
                tickets = tickets.Where(t => t.AssigneeId == null);
            else if (wanted is { Count: > 0 })
                tickets = tickets.Where(t => t.AssigneeId != null && wanted.Contains(t.AssigneeId!.Value));
        }

        if (agent && except != "tag" && query.Tag is { Count: > 0 } tagNames)
            tickets = tickets.Where(t => t.TicketTags.Any(tt => tagNames.Contains(tt.Tag.Name)));
        if (agent && except != "team" && query.TeamId is { Count: > 0 } teams)
            tickets = tickets.Where(t => t.TeamId != null && teams.Contains(t.TeamId!.Value));
        if (agent && except != "category" && query.CategoryId is { Count: > 0 } categories)
            tickets = tickets.Where(t => t.CategoryId != null && categories.Contains(t.CategoryId!.Value));

        if (query.RequesterId is not null && agent)
            tickets = tickets.Where(t => t.RequesterId == query.RequesterId);

        // Both are about the caller, not about an id they could pass. "Whose
        // mentions?" is never a question the client gets to answer.
        if (query.Mentioned && agent)
            tickets = tickets.Where(t => db.CommentMentions.Any(
                m => m.TicketId == t.Id && m.UserId == actor.UserId));
        if (query.Watching && agent)
            tickets = tickets.Where(t => t.Watchers.Any(w => w.AgentId == actor.UserId));
        if (query.Pinned && agent)
            tickets = tickets.Where(t => db.TicketPins.Any(
                p => p.TicketId == t.Id && p.AgentId == actor.UserId));
        // Not scoped to the caller, unlike the three above: a flag belongs to the
        // team, so "flagged" means flagged by anyone.
        if (query.Flagged && agent)
            tickets = tickets.Where(t => t.FlaggedAt != null);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = $"%{query.Search.Trim()}%";
            // Subject and description. Not the comments: a full-text search of
            // every reply is a different feature with different indexing, and
            // doing it with ILIKE would be a sequential scan of the workspace.
            tickets = tickets.Where(t =>
                EF.Functions.ILike(t.Subject, term) || EF.Functions.ILike(t.Description, term));
        }

        return tickets;
    }

    public async Task<(IReadOnlyList<TicketSummaryDto> Items, int Total)> ListAsync(
        Actor actor, TicketListQuery query, CancellationToken ct)
    {
        var tickets = Filtered(actor, query);

        var total = await tickets.CountAsync(ct);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var page = Math.Max(query.Page, 1);

        var items = await Sorted(tickets, query, actor.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new TicketSummaryDto(
                t.Id, t.Subject, t.Status, t.StatusCategory,
                // Inlined, not a helper method. EF refuses a projection that
                // calls an instance method — the expression tree would capture
                // this whole service, which it reports as a memory-leak risk.
                db.TicketStatuses
                    .Where(s => s.WorkspaceId == t.WorkspaceId && s.Value == t.Status)
                    .Select(s => s.Name)
                    .FirstOrDefault() ?? t.Status,
                t.Priority, t.Channel,
                CategoryDto.From(t.Category),
                actor.IsAgentOrAdmin ? t.TeamId : null,
                actor.IsAgentOrAdmin ? (t.Team != null ? t.Team.Name : null) : null,
                UserSummaryDto.From(t.Requester),
                t.GuestName, t.GuestEmail,
                UserSummaryDto.From(t.Assignee),
                t.Comments.Count(c => !c.IsInternal || actor.IsAgentOrAdmin),
                // The viewer's OWN pin. A customer surface gets false — a pin is
                // an agent's bookmark and means nothing to the person who raised
                // the ticket.
                actor.IsAgentOrAdmin
                    && db.TicketPins.Any(p => p.TicketId == t.Id && p.AgentId == actor.UserId),
                actor.IsAgentOrAdmin ? t.FlaggedAt : null,
                actor.IsAgentOrAdmin ? t.FlagReason : null,
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

    /// <summary>
    /// Applies the sort, always with a tie-break on id.
    ///
    /// The tie-break is not decoration. Without it two tickets updated in the
    /// same millisecond — which happens constantly, because automation touches
    /// several at once — can swap places between page 1 and page 2, so one is
    /// shown twice and another is never shown at all.
    /// </summary>
    /// <summary>
    /// Applies the sort, always with pins on top and a tie-break on id.
    ///
    /// **Pinned first, whatever the chosen sort.** A pin says "keep this in front
    /// of me", and a pin that vanished the moment somebody sorted by priority
    /// would not be worth setting. It is the agent's OWN pins — the join is on
    /// their id — so one person tidying their list never reorders anybody else's.
    ///
    /// The flag is deliberately NOT in the sort. It is a property of the ticket
    /// that everybody can see and filter on; forcing every flagged ticket to the
    /// top of every agent's list would make flagging an act of shouting, and the
    /// first response to that is for everyone to stop reading flags.
    /// </summary>
    private IQueryable<Ticket> Sorted(IQueryable<Ticket> tickets, TicketListQuery query, Guid viewerId)
    {
        var desc = query.Desc;

        // The PRIMARY key of the sort, with everything below chained onto it.
        // False sorts before true, so "is pinned" lands on top. Inlined for the
        // same reason as the status name and priority rank below: a helper method
        // here puts a reference to this service in the expression tree.
        var pinned = tickets.OrderBy(
            t => !db.TicketPins.Any(p => p.TicketId == t.Id && p.AgentId == viewerId));

        IOrderedQueryable<Ticket> ordered = query.Sort switch
        {
            TicketSort.Created => desc
                ? pinned.ThenByDescending(t => t.CreatedAt)
                : pinned.ThenBy(t => t.CreatedAt),

            TicketSort.Subject => desc
                ? pinned.ThenByDescending(t => t.Subject)
                : pinned.ThenBy(t => t.Subject),

            TicketSort.Status => desc
                ? pinned.ThenByDescending(t => t.Status)
                : pinned.ThenBy(t => t.Status),

            // The workspace's own order, not the alphabet: "high" sorting above
            // "urgent" is the kind of wrong that makes a queue useless. The rank
            // comes from the same ticket_options row the picker is built from.
            //
            // Inlined for the same reason as the status name above: a helper
            // method here puts a call to this service in the expression tree,
            // which EF cannot translate.
            TicketSort.Priority => desc
                ? pinned.ThenByDescending(t => db.TicketOptions
                    .Where(o => o.WorkspaceId == t.WorkspaceId
                                && o.Kind == TicketOptionKind.Priority
                                && o.Value == t.Priority)
                    .Select(o => (int?)o.SortOrder)
                    .FirstOrDefault() ?? int.MaxValue)
                : pinned.ThenBy(t => db.TicketOptions
                    .Where(o => o.WorkspaceId == t.WorkspaceId
                                && o.Kind == TicketOptionKind.Priority
                                && o.Value == t.Priority)
                    .Select(o => (int?)o.SortOrder)
                    .FirstOrDefault() ?? int.MaxValue),

            // Nulls last either way. A ticket with no SLA is not "the most
            // urgent" and it is not "the least" — it simply has no deadline, and
            // floating it to the top of a due-date sort would bury the ones that
            // do.
            TicketSort.Due => desc
                ? pinned.ThenBy(t => t.ResolveDueAt == null).ThenByDescending(t => t.ResolveDueAt)
                : pinned.ThenBy(t => t.ResolveDueAt == null).ThenBy(t => t.ResolveDueAt),

            _ => desc
                ? pinned.ThenByDescending(t => t.UpdatedAt)
                : pinned.ThenBy(t => t.UpdatedAt),
        };

        return ordered.ThenBy(t => t.Id);
    }

    // The status-name and priority-rank subqueries used to live here as helper
    // methods. They are inlined at their call sites instead: a method call in a
    // projection or an OrderBy puts a reference to this service into the
    // expression tree, and EF refuses it — "the client projection contains a
    // reference to a constant expression of TicketService through the instance
    // method". Tempting to reintroduce; do not.

    /// <summary>
    /// The counts behind the filter rail — agent-facing, like every other
    /// cross-workspace read.
    /// </summary>
    public async Task<TicketFacetsDto> FacetsAsync(
        Actor actor, TicketListQuery query, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        // Labels come from the same configured lists the pickers use, so a
        // renamed priority reads the same in both places.
        var priorityLabels = await LabelsAsync(actor.WorkspaceId, TicketOptionKind.Priority, ct);
        var channelLabels = await LabelsAsync(actor.WorkspaceId, TicketOptionKind.Channel, ct);

        var status = await CountBy(actor, query, "status", t => t.Status, ct);
        var priority = await CountBy(actor, query, "priority", t => t.Priority, ct);
        var channel = await CountBy(actor, query, "channel", t => t.Channel, ct);

        // Every grouped facet materialises into an anonymous type of primitives
        // and is shaped afterwards.
        //
        // EF translates the GROUP BY, but not a projection into a record it then
        // has to sort by — `GroupBy(...).Select(g => new FacetBucket(...))
        // .OrderByDescending(b => b.Count)` throws at query-compile time,
        // because by that point `Count` is a property of a CLR object rather
        // than an aggregate it can put in an ORDER BY. Grouping in SQL and
        // shaping in memory is the version that is both translatable and
        // obviously correct.
        var teamRows = await Filtered(actor, query, "team")
            .Where(t => t.TeamId != null)
            .GroupBy(t => new { Id = t.TeamId!.Value, t.Team!.Name })
            .Select(g => new { g.Key.Id, g.Key.Name, Count = g.Count() })
            .ToListAsync(ct);
        var team = teamRows
            .Select(r => new FacetBucket(r.Id.ToString(), r.Name, r.Count))
            .ToList();

        var categoryRows = await Filtered(actor, query, "category")
            .Where(t => t.CategoryId != null)
            .GroupBy(t => new { Id = t.CategoryId!.Value, t.Category!.Name })
            .Select(g => new { g.Key.Id, g.Key.Name, Count = g.Count() })
            .ToListAsync(ct);
        var category = categoryRows
            .Select(r => new FacetBucket(r.Id.ToString(), r.Name, r.Count))
            .ToList();

        var assigned = Filtered(actor, query, "assignee");
        var assigneeRows = await assigned
            .Where(t => t.AssigneeId != null)
            .GroupBy(t => new { Id = t.AssigneeId!.Value, t.Assignee!.Name, t.Assignee!.Email })
            .Select(g => new { g.Key.Id, g.Key.Name, g.Key.Email, Count = g.Count() })
            .ToListAsync(ct);
        var assignee = assigneeRows
            .Select(r => new FacetBucket(r.Id.ToString(), r.Name ?? r.Email ?? "—", r.Count))
            .OrderBy(b => b.Label)
            .ToList();

        // Unassigned is a bucket, not an absence. It is the most-used queue view
        // there is, and leaving it out of the rail means it can only be reached
        // by knowing the URL. First, because it is the one people look for.
        var unassignedCount = await assigned.CountAsync(t => t.AssigneeId == null, ct);
        if (unassignedCount > 0)
            assignee.Insert(0, new FacetBucket(UnassignedFacet, "Unassigned", unassignedCount));

        var tagRows = await Filtered(actor, query, "tag")
            .SelectMany(t => t.TicketTags)
            .GroupBy(tt => tt.Tag.Name)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        // Twenty most-used. A workspace can have hundreds of tags and a rail
        // listing all of them is a scrollbar, not a filter.
        var tag = tagRows
            .OrderByDescending(r => r.Count)
            .ThenBy(r => r.Name)
            .Take(20)
            .Select(r => new FacetBucket(r.Name, r.Name, r.Count))
            .ToList();

        // Status keeps its raw value as the label — the client translates the
        // four it owns. Priority and channel are workspace vocabulary, so their
        // labels have to come from the rows the pickers are built from.
        return new TicketFacetsDto(
            status,
            Relabel(priority, priorityLabels),
            Relabel(channel, channelLabels),
            Sort(team), Sort(category), assignee, tag);
    }

    private async Task<List<FacetBucket>> CountBy(
        Actor actor, TicketListQuery query, string field,
        System.Linq.Expressions.Expression<Func<Ticket, string>> selector, CancellationToken ct)
    {
        // Same rule as the grouped facets above: group in SQL, shape in memory.
        var rows = await Filtered(actor, query, field)
            .GroupBy(selector)
            .Select(g => new { Value = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return rows
            .OrderByDescending(r => r.Count)
            .ThenBy(r => r.Value)
            .Select(r => new FacetBucket(r.Value, r.Value, r.Count))
            .ToList();
    }

    /// <summary>The sentinel the assignee facet uses for "nobody".</summary>
    public const string UnassignedFacet = "none";

    private async Task<Dictionary<string, string>> LabelsAsync(
        Guid workspaceId, string kind, CancellationToken ct) =>
        await db.TicketOptions
            .Where(o => o.WorkspaceId == workspaceId && o.Kind == kind)
            .ToDictionaryAsync(o => o.Value, o => o.Label, ct);

    /// <summary>
    /// Swaps stored values for the workspace's own wording.
    ///
    /// A value with no row keeps itself as the label rather than disappearing: a
    /// ticket carrying a retired priority still exists, and a facet that hides
    /// it makes those tickets unreachable from the rail.
    /// </summary>
    private static IReadOnlyList<FacetBucket> Relabel(
        List<FacetBucket> buckets, Dictionary<string, string> labels) =>
        buckets
            .Select(b => labels.TryGetValue(b.Value, out var label) ? b with { Label = label } : b)
            .ToList();

    private static IReadOnlyList<FacetBucket> Sort(List<FacetBucket> buckets) =>
        buckets.OrderBy(b => b.Label).ToList();

    public async Task<TicketDetailDto?> GetAsync(Actor actor, Guid ticketId, CancellationToken ct)
    {
        var ticket = await VisibleTickets(actor)
            .Include(t => t.Category)
            .Include(t => t.SubCategory)
            .Include(t => t.Requester)
            .Include(t => t.Assignee)
            .Include(t => t.Watchers).ThenInclude(w => w.Agent)
            .Include(t => t.TicketTags).ThenInclude(tt => tt.Tag)
            .Include(t => t.Team)
            .Include(t => t.SubTeam)
            .Include(t => t.Problem)
            .Include(t => t.ResolvedBy)
            .SingleOrDefaultAsync(t => t.Id == ticketId, ct);
        // Problem grouping and tags are internal — never expose them to a customer.
        if (ticket is null) return null;

        // The status row carries the label; the ticket only carries the value.
        var status = await statuses.ResolveAsync(actor.WorkspaceId, ticket.Status, ct);
        // Only asked for an agent: a customer has no pins, and the row would
        // never exist for them.
        var isPinned = actor.IsAgentOrAdmin
            && await db.TicketPins.AnyAsync(
                p => p.TicketId == ticketId && p.AgentId == actor.UserId, ct);

        return ToDetail(ticket, status?.Name ?? ticket.Status, actor.IsAgentOrAdmin, isPinned);
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

        // Where new tickets start is the workspace's choice, not a constant.
        var start = await statuses.DefaultAsync(actor.WorkspaceId, ct);

        var ticket = new Ticket
        {
            WorkspaceId = actor.WorkspaceId,
            Status = start.Value,
            StatusCategory = start.Category,
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

        // Queued BEFORE automation runs, so "raised this ticket" is the first
        // line of the history rather than turning up underneath the rules that
        // fired on it. Entries are ordered by the moment they were queued and
        // these are all within the same millisecond, so insertion order is the
        // only thing keeping the story straight.
        //
        // Same SaveChanges as the ticket itself — the log commits with what it
        // describes, or not at all.
        activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
            TicketActivityType.Created, ticket.Subject);

        // Automation may change priority/team/tags before SLA is computed. Its
        // own entries are written with a null actor and read as "Trackly".
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
                    (t.StatusCategory != TicketStatusCategory.Resolved && t.StatusCategory != TicketStatusCategory.Closed)),
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

        // Category, Team and Assignee are included for the activity log: it
        // records the labels as they read at the time, and once a field has been
        // reassigned below there is no way back to what it used to say. Three
        // joins on a single-row lookup, once per save.
        var ticket = await db.Tickets
            .Include(t => t.Category)
            .Include(t => t.Team)
            .Include(t => t.Assignee)
            .SingleOrDefaultAsync(t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);
        if (ticket is null)
            return null;

        var previousStatus = ticket.Status;
        var previousCategory = ticket.StatusCategory;
        var previousAssignee = ticket.AssigneeId;
        var previousPriority = ticket.Priority;

        // Read now, before anything below overwrites the navigation.
        var wasCategory = ticket.Category?.Name;
        var wasTeam = ticket.Team?.Name;
        var wasAssignee = DisplayName(ticket.Assignee);
        var wasSubject = ticket.Subject;

        if (request.Subject is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Subject))
                throw new ArgumentException("Subject cannot be empty.");
            ticket.Subject = request.Subject.Trim();
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Subject, wasSubject, ticket.Subject);
        }

        if (request.Status is not null)
        {
            // The status has to be one this workspace defines, and the workflow
            // has to permit the move. Both are checked here rather than in the
            // picker: the picker only offers legal moves, but a picker is not a
            // rule — the whole point of a workflow is that it holds for anything
            // that can post JSON.
            var target = await statuses.ResolveAsync(actor.WorkspaceId, request.Status, ct)
                         ?? throw new ArgumentException("Unknown status.");
            if (!target.IsActive && target.Value != previousStatus)
                throw new ArgumentException($"\"{target.Name}\" has been retired and cannot be set.");
            if (!await statuses.CanTransitionAsync(actor.WorkspaceId, previousStatus, target.Value, ct))
                throw new ArgumentException($"This ticket cannot move straight to \"{target.Name}\".");

            // Every rule below is written against the CATEGORY. A workspace can
            // name its states anything; what Trackly needs to know is whether the
            // work is over, which is what the category answers.
            var wasOpen = TicketStatusCategory.IsOpen(previousCategory);
            var isEnding = TicketStatusCategory.IsTerminal(target.Category);
            var note = request.ResolutionNote?.Trim();

            // Only the transition OUT of an open state asks. Resolved → Closed is
            // the same outcome being filed away and already carries a note, so
            // demanding a second one would train people to type "." to get past it.
            if (wasOpen && isEnding)
            {
                if (string.IsNullOrWhiteSpace(note))
                    throw new ArgumentException("Say what was fixed before resolving or closing this ticket.");
                if (note.Length > MaxResolutionNoteLength)
                    throw new ArgumentException($"Keep the resolution under {MaxResolutionNoteLength} characters.");

                ticket.ResolutionNote = note;
                ticket.ResolutionLink = CleanLink(request.ResolutionLink);
                ticket.ResolvedById = actor.UserId;

                // Optional, unlike the note. Demanding two paragraphs to close a
                // ticket is how you get "." in both — the internal one is the
                // record that has to exist, and this is the courtesy that is
                // worth having when somebody takes the time.
                var summary = request.ResolutionSummary?.Trim();
                if (summary is { Length: > MaxResolutionNoteLength })
                    throw new ArgumentException(
                        $"Keep the customer summary under {MaxResolutionNoteLength} characters.");
                ticket.ResolutionSummary = string.IsNullOrWhiteSpace(summary) ? null : summary;
            }

            // Set together, always — the category is what every rule reads, and
            // a status without its matching category is a ticket the system will
            // reason about incorrectly.
            ticket.Status = target.Value;
            ticket.StatusCategory = target.Category;

            // Track the resolution time for analytics (Phase 7C). Resolved
            // re-stamps; Closed keeps an existing stamp (or sets one if closed
            // directly); reopening into any open category clears it.
            if (ticket.Status != previousStatus)
            {
                ticket.ResolvedAt = target.Category switch
                {
                    TicketStatusCategory.Resolved => DateTime.UtcNow,
                    TicketStatusCategory.Closed => ticket.ResolvedAt ?? DateTime.UtcNow,
                    _ => null,
                };

                // The status move itself, always — it is the entry people scan
                // the log for. The old status is resolved rather than remembered
                // because a retired one still has to render its name here.
                var previousName = (await statuses.ResolveAsync(actor.WorkspaceId, previousStatus, ct))?.Name
                                   ?? previousStatus;
                activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                    TicketActivityType.Status, previousName, target.Name);

                // Plus a second entry for crossing the line into or out of
                // "finished". Two rows for one change is deliberate: "resolved"
                // and "reopened" are the events a manager scans for, and making
                // them findable would otherwise mean knowing which of the
                // workspace's status names happen to be terminal ones.
                if (wasOpen && isEnding)
                    activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
                        TicketActivityType.Resolved, ticket.ResolutionNote);
                else if (!wasOpen && !isEnding)
                    activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
                        TicketActivityType.Reopened, target.Name);

                // Reopened: the resolution it had no longer describes it. The
                // internal comment written below stays, so the history survives
                // even though the field does not.
                if (!isEnding)
                {
                    ticket.ResolutionNote = null;
                    ticket.ResolutionLink = null;
                    ticket.ResolutionSummary = null;
                    ticket.ResolvedById = null;

                    // The SLA markers go with it. A ticket that breached, was
                    // closed, and is reopened a month later would otherwise run
                    // its whole second life with nobody ever told it was late.
                    SlaBreachService.ClearMarkers(ticket);
                }
            }
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
            // The raw value, not a label: priorities are a fixed vocabulary the
            // client already translates, so storing "urgent" keeps the entry
            // readable in whichever language the log is opened in.
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Priority, previousPriority, ticket.Priority);
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
            ticket.Category = null;
            // The narrower answer goes with it: a sub-category whose parent is
            // gone is a label with nothing above it, and leaving it would show a
            // ticket filed under a category it is no longer in.
            ticket.SubCategoryId = null;
            ticket.SubCategory = null;
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Category, wasCategory, null);
        }
        else if (request.CategoryId is not null)
        {
            var chosen = await db.Categories.SingleOrDefaultAsync(
                c => c.WorkspaceId == actor.WorkspaceId && c.Id == request.CategoryId, ct);
            if (chosen is null)
                throw new ArgumentException("Unknown category.");
            if (chosen.ParentId is not null)
                throw new ArgumentException("Pick a top-level category here, and its sub-category below.");

            // Changing the parent invalidates whatever was chosen under the old
            // one. Cleared first so the block below can set the new pair, and so
            // an agent who only changes the parent is left in a valid state
            // rather than with a mismatched pair.
            if (chosen.Id != ticket.CategoryId)
            {
                ticket.SubCategoryId = null;
                ticket.SubCategory = null;
            }
            ticket.CategoryId = request.CategoryId;
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Category, wasCategory, chosen.Name);
        }

        if (request.ClearSubCategory)
        {
            ticket.SubCategoryId = null;
            ticket.SubCategory = null;
        }
        else if (request.SubCategoryId is not null)
        {
            var sub = await db.Categories.SingleOrDefaultAsync(
                c => c.WorkspaceId == actor.WorkspaceId && c.Id == request.SubCategoryId, ct);
            if (sub is null) throw new ArgumentException("Unknown sub-category.");
            // Enforced here rather than trusted from the form: the pair is what
            // every report reads, and a sub-category under the wrong parent is a
            // row that will never add up.
            if (sub.ParentId != ticket.CategoryId)
                throw new ArgumentException($"\"{sub.Name}\" does not belong to the chosen category.");
            ticket.SubCategoryId = sub.Id;
        }

        if (request.ClearTeam)
        {
            ticket.TeamId = null;
            ticket.Team = null;
            ticket.SubTeamId = null;
            ticket.SubTeam = null;
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Team, wasTeam, null);
        }
        else if (request.TeamId is not null && request.TeamId != ticket.TeamId)
        {
            var team = await db.Teams.SingleOrDefaultAsync(
                t => t.WorkspaceId == actor.WorkspaceId && t.Id == request.TeamId, ct);
            if (team is null)
                throw new ArgumentException("Unknown team.");
            if (team.ParentId is not null)
                throw new ArgumentException("Pick a department here, and its sub-department below.");

            ticket.SubTeamId = null;
            ticket.SubTeam = null;
            ticket.TeamId = request.TeamId;
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Team, wasTeam, team.Name);

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

        if (request.ClearSubTeam)
        {
            ticket.SubTeamId = null;
            ticket.SubTeam = null;
        }
        else if (request.SubTeamId is not null)
        {
            var sub = await db.Teams.SingleOrDefaultAsync(
                t => t.WorkspaceId == actor.WorkspaceId && t.Id == request.SubTeamId, ct);
            if (sub is null) throw new ArgumentException("Unknown sub-department.");
            if (sub.ParentId != ticket.TeamId)
                throw new ArgumentException($"\"{sub.Name}\" does not belong to the chosen department.");
            ticket.SubTeamId = sub.Id;
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

        // Logged once, here, against the value the ticket ENDED UP with rather
        // than inside each branch above. Choosing a department round-robins an
        // assignee, and an explicit assignee in the same save overrides it — two
        // entries for one save would describe a state the ticket never had.
        if (ticket.AssigneeId != previousAssignee)
        {
            var nowAssigned = ticket.AssigneeId is { } id
                ? DisplayName(await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct))
                : null;
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Assignee, wasAssignee, nowAssigned);
        }

        // The resolution, written into the thread as an internal note.
        //
        // The ticket column answers "what is the fix?" for the ticket as it
        // stands; this answers "what happened, and when" after a reopen has
        // cleared the column. Internal, always: it is engineering detail, so it
        // is on the same footing as a private note and never reaches the
        // customer, the guest view or a connector (invariant 5).
        if (ticket.Status != previousStatus
            && TicketStatusCategory.IsOpen(previousCategory)
            && TicketStatusCategory.IsTerminal(ticket.StatusCategory)
            && ticket.ResolutionNote is { Length: > 0 } resolution)
        {
            var body = ticket.ResolutionLink is { Length: > 0 } link
                ? $"{resolution}\n\n{link}"
                : resolution;
            db.Comments.Add(new Comment
            {
                TicketId = ticket.Id,
                AuthorId = actor.UserId,
                Body = body,
                IsInternal = true,
            });

            // The link the agent typed also belongs in Related work, so the card
            // holds every reference for the ticket rather than one list plus a
            // stray field that only the resolution card knows about.
            if (ticket.ResolutionLink is { Length: > 0 } resolutionLink)
                await MirrorResolutionLinkAsync(ticket, actor, resolutionLink, ct);
        }

        // Time logged as part of resolving. Same transaction as the status
        // change on purpose — two calls could leave a ticket resolved with the
        // agent's time silently dropped.
        if (request.TimeSpentMinutes is { } minutes and > 0)
        {
            if (minutes > TicketTimeLimits.MaxMinutesPerEntry)
                throw new ArgumentException("A single time entry cannot exceed 24 hours.");
            db.TicketTimeEntries.Add(new TicketTimeEntry
            {
                WorkspaceId = actor.WorkspaceId,
                TicketId = ticket.Id,
                UserId = actor.UserId,
                Minutes = minutes,
                Note = request.ResolutionNote?.Trim(),
            });
            // The number only. The log says how much was booked and by whom; the
            // Time spent card is where the note and the breakdown live.
            activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.TimeLogged, minutes.ToString());
        }

        // SLA: recompute on priority change, pause/resume on status change.
        if (ticket.Priority != previousPriority)
            await sla.OnPriorityChangedAsync(ticket, ct);
        if (ticket.Status != previousStatus)
            sla.OnStatusChanged(ticket, previousCategory, ticket.StatusCategory);

        // Automation on update runs after the agent's change (its own mutations
        // are not re-evaluated, so rules can't loop).
        await automation.RunOnUpdateAsync(ticket, ct);

        // Watchers hear about every change, which is what watching means. One
        // row per save, not one per field: an agent who fixes the priority and
        // the department in the same breath made one change, and three bell rows
        // for it is how people turn the bell off.
        var changes = DescribeChanges(ticket, previousStatus, previousPriority, previousAssignee);
        if (changes.Count > 0)
        {
            var watchers = await feed.InterestedAsync(ticket.Id, ct);
            // The new assignee gets their own row, so it is excluded from this
            // one — "the ticket changed" and "the ticket is now yours" are not
            // the same message, and receiving both says neither clearly.
            var newlyAssigned = ticket.AssigneeId != previousAssignee ? ticket.AssigneeId : null;
            var interested = watchers.Where(id => id != newlyAssigned).ToList();
            if (interested.Count > 0)
                feed.Queue(actor.WorkspaceId, interested, NotificationType.Watching,
                    actor.UserId, ticket.Id, preview: string.Join(" · ", changes));

            if (newlyAssigned is { } assignee)
                feed.Queue(actor.WorkspaceId, [assignee], NotificationType.Assigned,
                    actor.UserId, ticket.Id, preview: ticket.Subject);
        }

        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (ticket.Status != previousStatus)
        {
            if (ticket.StatusCategory == TicketStatusCategory.Resolved)
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

    // ---- Time spent -----------------------------------------------------------
    //
    // Agent-facing throughout. A customer has no business seeing how long their
    // ticket took, so every method here refuses a non-agent outright rather than
    // filtering the result.

    public async Task<IReadOnlyList<TimeEntryDto>?> TimeEntriesAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct))
            return null;

        var entries = await db.TicketTimeEntries
            .Where(e => e.WorkspaceId == actor.WorkspaceId && e.TicketId == ticketId)
            .Include(e => e.User)
            // Newest first, then by insert order — two entries logged for the
            // same day must not swap places between reloads.
            .OrderByDescending(e => e.SpentAt)
            .ThenByDescending(e => e.CreatedAt)
            .ToListAsync(ct);

        return entries.Select(ToTimeEntry).ToList();
    }

    public async Task<TimeEntryDto?> LogTimeAsync(
        Actor actor, Guid ticketId, LogTimeRequest request, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();
        ValidateMinutes(request.Minutes);
        if (!await TicketExistsAsync(actor, ticketId, ct))
            return null;

        var entry = new TicketTimeEntry
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticketId,
            UserId = actor.UserId,
            Minutes = request.Minutes,
            Note = Trim(request.Note),
            SpentAt = request.SpentAt ?? DateTime.UtcNow,
        };
        db.TicketTimeEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        // Re-read for the author, which the caller renders and the insert does
        // not populate.
        await db.Entry(entry).Reference(e => e.User).LoadAsync(ct);
        return ToTimeEntry(entry);
    }

    public async Task<TimeEntryDto?> UpdateTimeAsync(
        Actor actor, Guid ticketId, Guid entryId, LogTimeRequest request, CancellationToken ct)
    {
        ValidateMinutes(request.Minutes);
        var entry = await FindEditableEntryAsync(actor, ticketId, entryId, ct);
        if (entry is null) return null;

        entry.Minutes = request.Minutes;
        entry.Note = Trim(request.Note);
        if (request.SpentAt is { } spentAt) entry.SpentAt = spentAt;
        entry.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ToTimeEntry(entry);
    }

    public async Task<bool> DeleteTimeAsync(Actor actor, Guid ticketId, Guid entryId, CancellationToken ct)
    {
        var entry = await FindEditableEntryAsync(actor, ticketId, entryId, ct);
        if (entry is null) return false;

        db.TicketTimeEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Your own entry, or anyone's if you are an admin.
    ///
    /// An agent editing a colleague's logged hours is how a timesheet stops
    /// being evidence of anything. An admin can, because someone has to be able
    /// to fix a fat-fingered 8-hour entry after the person has left.
    /// </summary>
    private async Task<TicketTimeEntry?> FindEditableEntryAsync(
        Actor actor, Guid ticketId, Guid entryId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var entry = await db.TicketTimeEntries
            .Include(e => e.User)
            .SingleOrDefaultAsync(
                e => e.Id == entryId && e.TicketId == ticketId && e.WorkspaceId == actor.WorkspaceId, ct);
        if (entry is null) return null;
        if (entry.UserId != actor.UserId && !actor.IsAdmin)
            throw new UnauthorizedAccessException();
        return entry;
    }

    private Task<bool> TicketExistsAsync(Actor actor, Guid ticketId, CancellationToken ct) =>
        db.Tickets.AnyAsync(t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);

    private static void ValidateMinutes(int minutes)
    {
        if (minutes <= 0)
            throw new ArgumentException("Time spent must be at least one minute.");
        if (minutes > TicketTimeLimits.MaxMinutesPerEntry)
            throw new ArgumentException("A single time entry cannot exceed 24 hours.");
    }

    private static string? Trim(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// How a person is written into the activity log. Name, or the email when
    /// there is no name — never an id, which tells the reader nothing.
    ///
    /// Captured at the time of the change on purpose: the log records what
    /// happened, and an entry that silently follows a later rename is describing
    /// something other than the event it is a record of.
    /// </summary>
    private static string? DisplayName(User? user) =>
        user is null ? null : Trim(user.Name) ?? user.Email;

    private static TimeEntryDto ToTimeEntry(TicketTimeEntry e) =>
        new(e.Id, UserSummaryDto.From(e.User)!, e.Minutes, e.Note, e.SpentAt, e.CreatedAt);

    /// <summary>
    /// What actually moved, in words, for the watchers' bell row.
    ///
    /// Only the three fields anybody watches a ticket *for*. A subject typo or a
    /// tag being tidied is a change; it is not news, and treating it as news is
    /// how a useful notification becomes noise.
    ///
    /// The assignee is reported as "reassigned" rather than by name: resolving
    /// the name is another query, and the row links to the ticket where it is
    /// already on screen.
    /// </summary>
    private static List<string> DescribeChanges(
        Ticket ticket, string previousStatus, string previousPriority, Guid? previousAssignee)
    {
        var changes = new List<string>();
        if (ticket.Status != previousStatus)
            changes.Add($"Status: {previousStatus} → {ticket.Status}");
        if (ticket.Priority != previousPriority)
            changes.Add($"Priority: {previousPriority} → {ticket.Priority}");
        if (ticket.AssigneeId != previousAssignee)
            changes.Add(ticket.AssigneeId is null ? "Unassigned" : "Reassigned");
        return changes;
    }

    // ---- Related work ---------------------------------------------------------
    //
    // ---- Pin and flag ------------------------------------------------------------

    /// <summary>
    /// Pins or unpins for the CALLING agent only.
    ///
    /// No id for whose pin it is, on purpose: there is no such thing as pinning
    /// a ticket to somebody else's list, and an endpoint that took an agent id
    /// would be an endpoint for reordering a colleague's queue.
    /// </summary>
    public async Task<bool> SetPinnedAsync(Actor actor, Guid ticketId, bool pinned, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct)) return false;

        var existing = await db.TicketPins
            .SingleOrDefaultAsync(p => p.TicketId == ticketId && p.AgentId == actor.UserId, ct);

        if (pinned && existing is null)
            db.TicketPins.Add(new TicketPin { TicketId = ticketId, AgentId = actor.UserId });
        else if (!pinned && existing is not null)
            db.TicketPins.Remove(existing);
        else
            return true;   // already in the wanted state; saying so would be pedantic

        // No activity entry. A pin is one person's private bookmark, and writing
        // it into a log every agent reads would make it neither private nor
        // worth having.
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Flags or clears the flag, for the whole team.
    ///
    /// Anyone can do either. A flag that only its author could clear becomes a
    /// permanent mark the moment they go on leave, and the team stops trusting
    /// what the flag means.
    /// </summary>
    public async Task<bool> SetFlaggedAsync(
        Actor actor, Guid ticketId, bool flagged, string? reason, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (ticket is null) return false;

        var was = ticket.FlaggedAt is not null;

        if (flagged)
        {
            // Re-flagging an already-flagged ticket edits the reason rather than
            // re-stamping who and when: the first person to raise it is the one
            // the team should be asking about it.
            ticket.FlagReason = Trim(reason) is { Length: > 200 } long_ ? long_[..200] : Trim(reason);
            if (!was)
            {
                ticket.FlaggedAt = DateTime.UtcNow;
                ticket.FlaggedById = actor.UserId;
            }
        }
        else
        {
            ticket.FlaggedAt = null;
            ticket.FlaggedById = null;
            ticket.FlagReason = null;
        }

        // Unlike a pin, this IS logged: it is a shared statement about the
        // ticket, and "who decided this mattered, and when" is exactly what the
        // feed exists to answer.
        if (was != flagged)
            activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
                flagged ? TicketActivityType.Flagged : TicketActivityType.Unflagged,
                flagged ? ticket.FlagReason : null);

        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// The ticket's audit trail, or null when the caller cannot see the ticket.
    ///
    /// Routed through here rather than straight to <see cref="ActivityLog"/> so
    /// the visibility check is the same one every other read on this ticket
    /// goes through — one place that decides who can see what.
    /// </summary>
    public async Task<IReadOnlyList<TicketActivityDto>?> ActivityAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct))
            return null;
        return await activity.ForTicketAsync(actor.WorkspaceId, ticketId, ct);
    }

    // Agent-facing, like time and private notes: these are engineering
    // references, and a customer has no business reading the PR that fixed their
    // ticket (invariant 5).

    public async Task<IReadOnlyList<TicketLinkDto>?> LinksAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct))
            return null;

        var links = await db.TicketLinks
            .Where(l => l.WorkspaceId == actor.WorkspaceId && l.TicketId == ticketId)
            .Include(l => l.CreatedBy)
            .OrderBy(l => l.CreatedAt)
            .ToListAsync(ct);

        return links.Select(ToLink).ToList();
    }

    public async Task<TicketLinkDto?> AddLinkAsync(
        Actor actor, Guid ticketId, AddTicketLinkRequest request, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var url = CleanLink(request.Url)
                  ?? throw new ArgumentException("A link is required.");
        if (!await TicketExistsAsync(actor, ticketId, ct))
            return null;

        // The unique index would catch this too, but a 409 from the database
        // reads as a server fault; the agent just needs to be told it is already
        // in the list.
        var existing = await db.TicketLinks
            .Include(l => l.CreatedBy)
            .SingleOrDefaultAsync(l => l.TicketId == ticketId && l.Url == url, ct);
        if (existing is not null)
            throw new ArgumentException("That link is already on this ticket.");

        var link = new TicketLink
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticketId,
            Url = url,
            Title = Trim(request.Title) is { Length: > 0 } title
                ? (title.Length > MaxLinkTitleLength ? title[..MaxLinkTitleLength] : title)
                : null,
            Kind = Trim(request.Kind)?.ToLowerInvariant() ?? TicketLinkKind.Related,
            CreatedById = actor.UserId,
        };
        db.TicketLinks.Add(link);
        // The title if there is one, otherwise the URL — the log has to say
        // WHICH link was added, and a row reading only "added a link" sends the
        // reader to the card to work it out.
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.LinkAdded, link.Title ?? link.Url);
        await db.SaveChangesAsync(ct);

        await db.Entry(link).Reference(l => l.CreatedBy).LoadAsync(ct);
        return ToLink(link);
    }

    public async Task<bool> DeleteLinkAsync(Actor actor, Guid ticketId, Guid linkId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        // Any agent may remove any link: a wrong reference on a ticket everyone
        // reads is worse than the small chance of one being taken off in error,
        // and unlike a time entry it is not a record of anyone's work.
        //
        // Loaded first so the activity entry can name what went. Removing it
        // through the tracker keeps the delete and the log in one transaction —
        // ExecuteDelete would commit on its own and could leave the link gone
        // with nothing in the history saying who took it.
        var link = await db.TicketLinks.SingleOrDefaultAsync(
            l => l.Id == linkId && l.TicketId == ticketId && l.WorkspaceId == actor.WorkspaceId, ct);
        if (link is null) return false;

        db.TicketLinks.Remove(link);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.LinkRemoved, link.Title ?? link.Url);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Files the resolve dialog's single link into the related-work list.
    ///
    /// Best-effort on purpose: a duplicate URL, or a link the agent already added
    /// by hand, must not fail the resolution itself. The ticket column is set
    /// either way — this only makes the link visible in the card next to the rest.
    /// </summary>
    private async Task MirrorResolutionLinkAsync(Ticket ticket, Actor actor, string url, CancellationToken ct)
    {
        var already = await db.TicketLinks.AnyAsync(l => l.TicketId == ticket.Id && l.Url == url, ct);
        if (already) return;

        db.TicketLinks.Add(new TicketLink
        {
            WorkspaceId = actor.WorkspaceId,
            TicketId = ticket.Id,
            Url = url,
            Kind = TicketLinkKind.UserStory,
            CreatedById = actor.UserId,
        });
    }

    private const int MaxLinkTitleLength = 200;

    private static TicketLinkDto ToLink(TicketLink l) =>
        new(l.Id, l.Url, l.Title, l.Kind, UserSummaryDto.From(l.CreatedBy), l.CreatedAt);

    // ---- Watchers -------------------------------------------------------------

    public async Task<bool> AddWatcherAsync(Actor actor, Guid ticketId, Guid agentId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin)
            throw new UnauthorizedAccessException();

        var ticketExists = await db.Tickets.AnyAsync(
            t => t.WorkspaceId == actor.WorkspaceId && t.Id == ticketId, ct);
        if (!ticketExists)
            return false;

        var watcher = await db.Users.SingleOrDefaultAsync(u =>
            u.WorkspaceId == actor.WorkspaceId && u.Id == agentId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (watcher is null)
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
            activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
                TicketActivityType.WatcherAdded, DisplayName(watcher));
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

        // Through the tracker, so the removal and its log entry share one
        // transaction and the entry can still name who stopped watching.
        var watching = await db.TicketWatchers
            .Include(w => w.Agent)
            .SingleOrDefaultAsync(w => w.TicketId == ticketId && w.AgentId == agentId, ct);
        if (watching is not null)
        {
            db.TicketWatchers.Remove(watching);
            activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
                TicketActivityType.WatcherRemoved, DisplayName(watching.Agent));
            await db.SaveChangesAsync(ct);
        }
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
        // Two filters, both here rather than in the UI (invariant 5):
        //
        //  · a customer sees only public comments;
        //  · a note marked private is its author's alone — including from an
        //    admin. A note nobody else can see is only worth writing if that is
        //    actually true, and an agent who doubts it stops writing them.
        if (!actor.IsAgentOrAdmin)
            comments = comments.Where(c => !c.IsInternal);
        else
            comments = comments.Where(
                c => c.Visibility != CommentVisibility.Private || c.AuthorId == actor.UserId);

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
            c.BodyFormat,
            c.IsInternal,
            c.Visibility,
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

        // Sanitised here rather than trusted from the composer. The body arrives
        // as an HTTP field, so anything that can post JSON can put anything in
        // it, and it leaves for three surfaces with three different escaping
        // rules (email, the guest view, the model). One gate, on write.
        var wantsHtml = request.BodyFormat == CommentBodyFormat.Html;
        var body = wantsHtml ? RichText.SanitizeHtml(request.Body) : request.Body.Trim();
        if (string.IsNullOrWhiteSpace(body))
            throw new ArgumentException("Comment body is required.");

        var visibility = ResolveVisibility(actor, request);

        var ticket = await VisibleTickets(actor).SingleOrDefaultAsync(t => t.Id == ticketId, ct);
        if (ticket is null)
            return null;

        // Mentions are read out of the body, never taken from a field beside it.
        // Two lists that can disagree is one too many: deleting "@Priya" from a
        // note and sending it would still ping her, and a hand-written request
        // could ping anyone without naming them at all.
        var named = wantsHtml ? RichText.ExtractMentions(body) : [];
        var mentioned = named.Count > 0
            ? await MentionableAsync(actor, named, ct)
            : [];

        if (visibility == CommentVisibility.Private && named.Count > 0)
        {
            // A note only you can read cannot notify anyone, so the chip would be
            // a live-looking control that did nothing. The names stay as words.
            body = RichText.StripMentionMarkup(body);
            mentioned = [];
        }

        var comment = new Comment
        {
            TicketId = ticket.Id,
            AuthorId = actor.UserId,
            Body = body,
            BodyFormat = wantsHtml ? CommentBodyFormat.Html : CommentBodyFormat.Text,
            Visibility = visibility,
            // Kept in step with Visibility, and still what every customer-facing
            // filter tests — see the note on Comment.IsInternal.
            IsInternal = CommentVisibility.HiddenFromCustomer(visibility),
            Source = CommentSource.Web,
        };
        db.Comments.Add(comment);
        ticket.UpdatedAt = DateTime.UtcNow;
        // First public agent reply stops the first-response SLA clock.
        if (actor.IsAgentOrAdmin && !comment.IsInternal)
            sla.OnAgentReply(ticket);

        foreach (var userId in mentioned)
            db.CommentMentions.Add(new CommentMention
            {
                Comment = comment,
                UserId = userId,
                TicketId = ticket.Id,
            });

        // Bell rows are queued into the same SaveChanges as the comment, so one
        // can never announce something the other failed to write.
        var preview = comment.BodyFormat == CommentBodyFormat.Html
            ? RichText.ToPlainText(comment.Body)
            : comment.Body;

        if (mentioned.Count > 0)
            feed.Queue(actor.WorkspaceId, mentioned, NotificationType.Mention,
                actor.UserId, ticket.Id, preview: preview);

        // The activity entry says a reply or a note happened, and nothing more.
        //
        // **No preview.** The feed is agent-facing but a private note is not —
        // it is readable only by whoever wrote it (invariant 5), and copying its
        // text into a row every agent can read would defeat the whole point of
        // the setting. The thread already holds the words for anyone allowed to
        // see them; this only records that something was said and when.
        activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
            visibility == CommentVisibility.Public
                ? TicketActivityType.Replied
                : TicketActivityType.Noted);

        // Watchers hear about everything on the ticket, except a note nobody but
        // its author can read. Anyone already told they were mentioned is not
        // told a second time.
        if (visibility != CommentVisibility.Private)
        {
            var watchers = (await feed.InterestedAsync(ticket.Id, ct))
                .Except(mentioned)
                .ToList();
            if (watchers.Count > 0)
                feed.Queue(actor.WorkspaceId, watchers,
                    visibility == CommentVisibility.Public ? NotificationType.Reply : NotificationType.Watching,
                    actor.UserId, ticket.Id, preview: preview);
        }

        await db.SaveChangesAsync(ct);

        // Internal notes stay internal — no external notification. External
        // replies notify the other party (agent → customer, customer → agents).
        if (!comment.IsInternal)
            await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent: actor.IsAgentOrAdmin, ct);
        // A mention also emails, because the whole point is that it reaches you
        // whether or not you happen to be looking at Trackly.
        if (mentioned.Count > 0)
            await notifications.OnMentionedAsync(ticket.Id, mentioned, actor.UserId, preview, ct);

        var author = await db.Users.SingleAsync(u => u.Id == actor.UserId, ct);
        return new CommentDto(
            comment.Id, UserSummaryDto.From(author), null, comment.Body, comment.BodyFormat,
            comment.IsInternal, comment.Visibility, comment.Source, [], comment.CreatedAt);
    }

    /// <summary>
    /// What a caller is actually allowed to create.
    ///
    /// A customer's comment is always public — not rejected, forced. The portal
    /// has no note UI, so anything asking for one is either a stale client or a
    /// probe, and neither is worth a 400 that a customer would then see.
    /// </summary>
    private static string ResolveVisibility(Actor actor, CreateCommentRequest request)
    {
        if (!actor.IsAgentOrAdmin) return CommentVisibility.Public;

        var wanted = request.Visibility;
        if (wanted is not null && CommentVisibility.All.Contains(wanted)) return wanted;
        // Older clients send only the boolean. Honour it so a deploy in either
        // order keeps working.
        return request.IsInternal ? CommentVisibility.Internal : CommentVisibility.Public;
    }

    /// <summary>
    /// Narrows named ids to real colleagues.
    ///
    /// Re-checked against the workspace because the id came out of an HTTP body:
    /// without this, a crafted request would notify — and grant a "you were
    /// mentioned" ticket view to — any user id in the system.
    /// </summary>
    private async Task<List<Guid>> MentionableAsync(
        Actor actor, IReadOnlyList<Guid> ids, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) return [];
        return await db.Users
            .Where(u => ids.Contains(u.Id)
                        && u.WorkspaceId == actor.WorkspaceId
                        && u.IsActive
                        && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }

    // ---- Mapping -----------------------------------------------------------------

    private static TicketDetailDto ToDetail(
        Ticket t, string statusName, bool isAgentOrAdmin, bool isPinned) => new(
        t.Id, t.Subject, t.Description, t.Status, t.StatusCategory, statusName,
        t.Priority, t.Channel,
        CategoryDto.From(t.Category),
        CategoryDto.From(t.SubCategory),
        UserSummaryDto.From(t.Requester),
        t.GuestName, t.GuestEmail,
        UserSummaryDto.From(t.Assignee),
        // Passed in rather than read off the ticket: whose pin it is, is a
        // question about the CALLER, and the entity has no idea who is asking.
        isAgentOrAdmin && isPinned,
        isAgentOrAdmin ? t.FlaggedAt : null,
        isAgentOrAdmin ? t.FlagReason : null,
        t.Watchers.Select(w => new WatcherDto(UserSummaryDto.From(w.Agent)!, w.AddedAt)).ToList(),
        isAgentOrAdmin
            ? t.TicketTags.Select(tt => new TagDto(tt.Tag.Id, tt.Tag.Name, tt.Tag.Color)).ToList()
            : new List<TagDto>(),
        // The problem this ticket belongs to is internal grouping, and its title
        // usually describes an outage affecting other customers.
        isAgentOrAdmin ? t.ProblemId : null,
        isAgentOrAdmin ? t.Problem?.Title : null,
        isAgentOrAdmin ? t.TeamId : null,
        isAgentOrAdmin ? t.Team?.Name : null,
        isAgentOrAdmin ? t.SubTeamId : null,
        isAgentOrAdmin ? t.SubTeam?.Name : null,
        isAgentOrAdmin ? t.FirstResponseDueAt : null,
        isAgentOrAdmin ? t.ResolveDueAt : null,
        isAgentOrAdmin ? t.FirstResponseAt : null,
        // Agent-facing only. A customer sees that their ticket was resolved, not
        // the root cause or the work item it was fixed under.
        isAgentOrAdmin ? t.ResolutionNote : null,
        isAgentOrAdmin ? t.ResolutionLink : null,
        // The exception, and the reason the field exists: this one is WRITTEN for
        // the customer, so it goes to everyone.
        t.ResolutionSummary,
        isAgentOrAdmin ? UserSummaryDto.From(t.ResolvedBy) : null,
        isAgentOrAdmin ? t.ResolvedAt : null,
        t.CreatedAt, t.UpdatedAt);

    private const int MaxResolutionNoteLength = 4000;

    /// <summary>
    /// Keeps an http(s) URL, drops anything else.
    ///
    /// The field is rendered as a link, so `javascript:` and `data:` are not
    /// merely wrong values — they are a stored payload waiting for the next
    /// agent to click it.
    /// </summary>
    private static string? CleanLink(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
               && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? trimmed
            : throw new ArgumentException("The link must be a full http(s) URL.");
    }
}
