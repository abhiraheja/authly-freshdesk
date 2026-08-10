using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// The workspace's asset register and its service catalogue, plus the links from
/// a ticket to each.
///
/// One service for both because they are the same operations over two lists —
/// browse, add, retire, attach to a ticket — and the ticket screen shows them
/// side by side. Splitting them would double the file count without separating
/// anything that actually differs.
///
/// **Retire, never delete, once anything references it.** A ticket pointing at
/// an asset row that is gone renders as a blank chip, which reads as a bug
/// rather than as history.
/// </summary>
public class AssetService(TracklyDbContext db, ActivityLog activity)
{
    // ---- Asset register -------------------------------------------------------

    public async Task<IReadOnlyList<AssetDto>> ListAssetsAsync(
        Actor actor, string? search, bool includeInactive, CancellationToken ct)
    {
        var query = db.Assets.Where(a => a.WorkspaceId == actor.WorkspaceId);
        if (!includeInactive) query = query.Where(a => a.IsActive);

        // Name OR tag: half the time somebody is holding the machine and reading
        // the sticker on it, and half the time they only know what it is called.
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(a => a.Name.ToLower().Contains(term)
                                     || (a.Tag != null && a.Tag.ToLower().Contains(term)));
        }

        return await query
            .OrderBy(a => a.Name)
            .Take(200)
            .Select(a => new AssetDto(
                a.Id, a.Name, a.Kind, a.Tag, a.Location,
                UserSummaryDto.From(a.AssignedTo), a.Notes, a.IsActive,
                db.TicketAssets.Count(x => x.AssetId == a.Id),
                // Tickets about it right now. The lifetime count says "this
                // machine has a history"; this one says "this machine is a problem
                // today", and they are different questions with different answers.
                db.TicketAssets.Count(x =>
                    x.AssetId == a.Id
                    && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                    && x.Ticket.StatusCategory != TicketStatusCategory.Closed),
                // When it was last in trouble. Null for an asset nobody has ever
                // raised a ticket about — which is the best thing an asset can be.
                db.TicketAssets
                    .Where(x => x.AssetId == a.Id)
                    .Max(x => (DateTime?)x.AddedAt)))
            .ToListAsync(ct);
    }

    /// <summary>
    /// The register in aggregate: how many there are, how many are out with
    /// somebody, and where they are.
    ///
    /// The question behind it is an audit one — "what have we handed out, and to
    /// whom" — which nobody can answer by scrolling a list of two hundred rows.
    /// Grouped in the database; the client only draws it.
    ///
    /// Retired assets are excluded from every number here. They are kept so old
    /// tickets still render, not so they inflate a count of what the workspace owns.
    /// </summary>
    public async Task<AssetSummaryDto> AssetSummaryAsync(Actor actor, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var assets = db.Assets.Where(a => a.WorkspaceId == actor.WorkspaceId && a.IsActive);

        // Two plain counts rather than one grouped projection. A `GroupBy(_ => 1)`
        // with conditional aggregates inside it is the shape EF translates
        // inconsistently, and this endpoint runs once per page view — the round
        // trip it would save is not worth a query that fails on a version bump.
        var total = await assets.CountAsync(ct);
        var assigned = await assets.CountAsync(a => a.AssignedToId != null, ct);

        return new AssetSummaryDto(
            total,
            assigned,
            total - assigned,
            // Assets currently named on an unfinished ticket. Distinct, because one
            // laptop with three open tickets is one machine in trouble.
            await db.TicketAssets
                .Where(x => x.Asset!.WorkspaceId == actor.WorkspaceId
                            && x.Asset.IsActive
                            && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                            && x.Ticket.StatusCategory != TicketStatusCategory.Closed)
                .Select(x => x.AssetId)
                .Distinct()
                .CountAsync(ct),
            await BucketsAsync(assets, a => a.Kind, ct),
            await BucketsAsync(assets, a => a.Location, ct),
            await TopHoldersAsync(assets, ct));
    }

    /// <summary>
    /// Who is holding what, most first — so the row that needs explaining (one
    /// person with eleven laptops) is the first one read.
    ///
    /// Anonymous-type projection for the same reason as <see cref="BucketsAsync"/>:
    /// a grouping projected directly into a record constructor is a query EF
    /// accepts at compile time and refuses at run time.
    /// </summary>
    private static async Task<IReadOnlyList<AssetHolderDto>> TopHoldersAsync(
        IQueryable<Asset> assets, CancellationToken ct)
    {
        var rows = await assets
            .Where(a => a.AssignedToId != null)
            .GroupBy(a => new { a.AssignedToId, a.AssignedTo!.Name, a.AssignedTo.Email })
            .Select(g => new
            {
                Id = g.Key.AssignedToId,
                g.Key.Name,
                g.Key.Email,
                Count = g.Count(),
            })
            .OrderByDescending(g => g.Count)
            .Take(50)
            .ToListAsync(ct);

        // The fallback happens here rather than in the projection: `Name ?? Email`
        // inside the grouping key is a coalesce EF has to translate for no reason,
        // and Name is null for a member who was invited but has never signed in.
        return rows
            .Select(r => new AssetHolderDto(r.Id!.Value, r.Name ?? r.Email ?? "", r.Count))
            .ToList();
    }

    /// <summary>
    /// Every ticket ever raised about one asset, newest first.
    ///
    /// The drill-down behind the count. Without it the register says "this machine
    /// has had nine tickets" and gives no way to read them, which is exactly the
    /// moment somebody needs to.
    /// </summary>
    public async Task<IReadOnlyList<AssetTicketDto>?> AssetTicketsAsync(
        Actor actor, Guid assetId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await db.Assets.AnyAsync(
                a => a.Id == assetId && a.WorkspaceId == actor.WorkspaceId, ct))
            return null;

        return await db.TicketAssets
            .Where(x => x.AssetId == assetId)
            .OrderByDescending(x => x.Ticket!.CreatedAt)
            .Take(100)
            .Select(x => new AssetTicketDto(
                x.TicketId,
                x.Ticket!.Subject,
                x.Ticket.Status,
                db.TicketStatuses
                    .Where(s => s.WorkspaceId == x.Ticket!.WorkspaceId && s.Value == x.Ticket.Status)
                    .Select(s => s.Name)
                    .FirstOrDefault() ?? x.Ticket.Status,
                x.Ticket.StatusCategory,
                x.Ticket.Priority,
                UserSummaryDto.From(x.Ticket.Assignee),
                x.Ticket.CreatedAt))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Counts by one nullable text column, with the blanks folded into one bucket.
    ///
    /// Null and empty are the same thing to a reader — "nobody filled this in" — and
    /// two buckets that both mean that is a table nobody trusts.
    ///
    /// **The projection is an anonymous type, not the DTO.** EF cannot translate a
    /// grouping projected straight into a record constructor: it rewrites
    /// <c>g.Count()</c> as <c>g.AsQueryable().Count()</c> and then gives up, at
    /// runtime, on the first request. Grouping into an anonymous type translates,
    /// and the DTO is built from the rows afterwards.
    /// </summary>
    private static async Task<IReadOnlyList<AssetBucketDto>> BucketsAsync(
        IQueryable<Asset> assets,
        System.Linq.Expressions.Expression<Func<Asset, string?>> column,
        CancellationToken ct)
    {
        var rows = await assets
            .GroupBy(column)
            .Select(g => new { Value = g.Key, Count = g.Count() })
            // Ordered and capped in SQL, so a workspace with a thousand distinct
            // locations still sends fifty rows over the wire.
            .OrderByDescending(g => g.Count)
            .Take(50)
            .ToListAsync(ct);

        return rows.Select(r => new AssetBucketDto(r.Value, r.Count)).ToList();
    }

    public async Task<AssetDto> CreateAssetAsync(
        Actor actor, string name, string? kind, string? tag, string? location,
        Guid? assignedToId, string? notes, CancellationToken ct)
    {
        RequireAdmin(actor);
        name = Clean(name) ?? throw new ArgumentException("An asset needs a name.");
        tag = Clean(tag);

        if (tag is not null && await db.Assets.AnyAsync(
                a => a.WorkspaceId == actor.WorkspaceId && a.Tag == tag, ct))
            throw new ArgumentException($"An asset with the tag \"{tag}\" already exists.");

        var asset = new Asset
        {
            WorkspaceId = actor.WorkspaceId,
            Name = name,
            Kind = Clean(kind),
            Tag = tag,
            Location = Clean(location),
            AssignedToId = assignedToId,
            Notes = Clean(notes, 2000),
        };
        db.Assets.Add(asset);
        await db.SaveChangesAsync(ct);
        return Shape(asset, 0);
    }

    public async Task<AssetDto?> UpdateAssetAsync(
        Actor actor, Guid id, string? name, string? kind, string? tag, string? location,
        Guid? assignedToId, bool clearAssignee, string? notes, bool? isActive, CancellationToken ct)
    {
        RequireAdmin(actor);
        var asset = await db.Assets.SingleOrDefaultAsync(
            a => a.Id == id && a.WorkspaceId == actor.WorkspaceId, ct);
        if (asset is null) return null;

        if (Clean(name) is { } n) asset.Name = n;
        if (kind is not null) asset.Kind = Clean(kind);
        if (location is not null) asset.Location = Clean(location);
        if (notes is not null) asset.Notes = Clean(notes, 2000);
        if (clearAssignee) asset.AssignedToId = null;
        else if (assignedToId is not null) asset.AssignedToId = assignedToId;

        if (tag is not null)
        {
            var wanted = Clean(tag);
            if (wanted is not null && wanted != asset.Tag && await db.Assets.AnyAsync(
                    a => a.WorkspaceId == actor.WorkspaceId && a.Tag == wanted && a.Id != id, ct))
                throw new ArgumentException($"An asset with the tag \"{wanted}\" already exists.");
            asset.Tag = wanted;
        }

        if (isActive is not null) asset.IsActive = isActive.Value;
        asset.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var uses = await db.TicketAssets.CountAsync(x => x.AssetId == id, ct);
        return Shape(asset, uses);
    }

    /// <summary>
    /// Deletes only an asset no ticket references. Anything in use is retired
    /// instead — the API says so rather than 500ing on a constraint.
    /// </summary>
    public async Task<AssetDeleteResult> DeleteAssetAsync(Actor actor, Guid id, CancellationToken ct)
    {
        RequireAdmin(actor);
        var asset = await db.Assets.SingleOrDefaultAsync(
            a => a.Id == id && a.WorkspaceId == actor.WorkspaceId, ct);
        if (asset is null) return AssetDeleteResult.NotFound;
        if (await db.TicketAssets.AnyAsync(x => x.AssetId == id, ct)) return AssetDeleteResult.InUse;

        db.Assets.Remove(asset);
        await db.SaveChangesAsync(ct);
        return AssetDeleteResult.Deleted;
    }

    // ---- Assets on a ticket ---------------------------------------------------

    public async Task<IReadOnlyList<TicketAssetDto>?> TicketAssetsAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct)) return null;

        return await db.TicketAssets
            .Where(x => x.TicketId == ticketId)
            .OrderBy(x => x.AddedAt)
            .Select(x => new TicketAssetDto(
                x.AssetId, x.Asset!.Name, x.Asset.Kind, x.Asset.Tag, x.Asset.Location,
                UserSummaryDto.From(x.Asset.AssignedTo), x.AddedAt,
                // "Everything else raised about this machine" — the number that
                // turns a register into a diagnosis. Excludes this ticket.
                db.TicketAssets.Count(o => o.AssetId == x.AssetId && o.TicketId != ticketId)))
            .ToListAsync(ct);
    }

    public async Task<bool> AttachAssetAsync(Actor actor, Guid ticketId, Guid assetId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct)) return false;

        var asset = await db.Assets.SingleOrDefaultAsync(
            a => a.Id == assetId && a.WorkspaceId == actor.WorkspaceId, ct);
        if (asset is null) throw new ArgumentException("That asset is not in this workspace.");

        if (await db.TicketAssets.AnyAsync(x => x.TicketId == ticketId && x.AssetId == assetId, ct))
            return true;   // already there; saying so would be pedantic

        db.TicketAssets.Add(new TicketAsset { TicketId = ticketId, AssetId = assetId, AddedBy = actor.UserId });
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId, TicketActivityType.AssetAdded, asset.Name);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> DetachAssetAsync(Actor actor, Guid ticketId, Guid assetId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var link = await db.TicketAssets
            .Include(x => x.Asset)
            .SingleOrDefaultAsync(x => x.TicketId == ticketId && x.AssetId == assetId, ct);
        if (link is null) return false;

        db.TicketAssets.Remove(link);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.AssetRemoved, link.Asset?.Name);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- Service catalogue ----------------------------------------------------

    public async Task<IReadOnlyList<BusinessServiceDto>> ListServicesAsync(
        Actor actor, bool includeInactive, CancellationToken ct)
    {
        var query = db.BusinessServices.Where(s => s.WorkspaceId == actor.WorkspaceId);
        if (!includeInactive) query = query.Where(s => s.IsActive);

        var rows = await query
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
            .Select(s => new
            {
                s.Id, s.Name, s.Description, s.OwnerTeamId,
                OwnerTeamName = s.OwnerTeam != null ? s.OwnerTeam.Name : null,
                s.IsActive, s.SortOrder,
                // Open tickets currently hitting it — the number that makes the
                // catalogue an incident board rather than a list of nouns.
                OpenTickets = db.TicketImpactedServices.Count(x =>
                    x.ServiceId == s.Id
                    && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                    && x.Ticket.StatusCategory != TicketStatusCategory.Closed),
                // How badly, at worst, across those tickets.
                //
                // The WORST rather than the newest or the most common: a service
                // with four "degraded" reports and one "down" is down. Averaging or
                // taking the latest would let the one report that matters be
                // outvoted by the four that do not, which is exactly backwards for
                // deciding what to work on first.
                //
                // Compared as a rank, not as text — "degraded" sorts before "down"
                // alphabetically, so Min() on the raw string would confidently
                // answer the wrong question. Nullable because MIN over no rows is
                // NULL, and no rows is the healthy case rather than an error.
                WorstRank = db.TicketImpactedServices
                    .Where(x => x.ServiceId == s.Id
                                && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                                && x.Ticket.StatusCategory != TicketStatusCategory.Closed)
                    .Min(x => (int?)(x.Level == ServiceImpactLevel.Down ? 0
                                   : x.Level == ServiceImpactLevel.Degraded ? 1
                                   : 2)),
            })
            .ToListAsync(ct);

        // The rank is a SQL ordering trick and stops at the edge of this method.
        // Handing a client 0, 1, 2 would make it re-derive the meaning, and the
        // first thing to drift would be which end of the scale is worse.
        return rows
            .Select(s => new BusinessServiceDto(
                s.Id, s.Name, s.Description, s.OwnerTeamId, s.OwnerTeamName,
                s.IsActive, s.SortOrder, s.OpenTickets, LevelOf(s.WorstRank)))
            .ToList();
    }

    /// <summary>Rank back to the level it stood for. Null means nothing is wrong.</summary>
    private static string? LevelOf(int? rank) => rank switch
    {
        0 => ServiceImpactLevel.Down,
        1 => ServiceImpactLevel.Degraded,
        2 => ServiceImpactLevel.Minor,
        _ => null,
    };

    /// <summary>
    /// Every open ticket saying a service is in trouble, worst first.
    ///
    /// The drill-down from the status board: "payments is down" is only useful once
    /// somebody can see which five tickets say so and who is on them.
    /// </summary>
    public async Task<IReadOnlyList<ServiceTicketDto>?> ServiceTicketsAsync(
        Actor actor, Guid serviceId, bool includeFinished, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await db.BusinessServices.AnyAsync(
                s => s.Id == serviceId && s.WorkspaceId == actor.WorkspaceId, ct))
            return null;

        var query = db.TicketImpactedServices.Where(x => x.ServiceId == serviceId);
        if (!includeFinished)
            query = query.Where(x =>
                x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                && x.Ticket.StatusCategory != TicketStatusCategory.Closed);

        return await query
            .OrderBy(x => x.Level == ServiceImpactLevel.Down ? 0
                        : x.Level == ServiceImpactLevel.Degraded ? 1
                        : 2)
            .ThenByDescending(x => x.AddedAt)
            .Take(100)
            .Select(x => new ServiceTicketDto(
                x.TicketId,
                x.Ticket!.Subject,
                x.Ticket.Status,
                db.TicketStatuses
                    .Where(s => s.WorkspaceId == x.Ticket!.WorkspaceId && s.Value == x.Ticket.Status)
                    .Select(s => s.Name)
                    .FirstOrDefault() ?? x.Ticket.Status,
                x.Ticket.StatusCategory,
                x.Ticket.Priority,
                UserSummaryDto.From(x.Ticket.Assignee),
                x.Level,
                x.Impact,
                x.AddedAt))
            .ToListAsync(ct);
    }

    public async Task<BusinessServiceDto> CreateServiceAsync(
        Actor actor, string name, string? description, Guid? ownerTeamId, CancellationToken ct)
    {
        RequireAdmin(actor);
        name = Clean(name) ?? throw new ArgumentException("A service needs a name.");
        if (await db.BusinessServices.AnyAsync(
                s => s.WorkspaceId == actor.WorkspaceId && s.Name.ToLower() == name.ToLower(), ct))
            throw new ArgumentException("A service with that name already exists.");

        var next = await db.BusinessServices
            .Where(s => s.WorkspaceId == actor.WorkspaceId)
            .Select(s => (int?)s.SortOrder).MaxAsync(ct) ?? -1;

        var service = new BusinessService
        {
            WorkspaceId = actor.WorkspaceId,
            Name = name,
            Description = Clean(description, 1000),
            OwnerTeamId = ownerTeamId,
            SortOrder = next + 1,
        };
        db.BusinessServices.Add(service);
        await db.SaveChangesAsync(ct);
        // A service that did not exist a moment ago cannot be broken yet.
        return new BusinessServiceDto(service.Id, service.Name, service.Description,
            service.OwnerTeamId, null, service.IsActive, service.SortOrder, 0, null);
    }

    public async Task<BusinessServiceDto?> UpdateServiceAsync(
        Actor actor, Guid id, string? name, string? description,
        Guid? ownerTeamId, bool clearOwner, int? sortOrder, bool? isActive, CancellationToken ct)
    {
        RequireAdmin(actor);
        var service = await db.BusinessServices
            .Include(s => s.OwnerTeam)
            .SingleOrDefaultAsync(s => s.Id == id && s.WorkspaceId == actor.WorkspaceId, ct);
        if (service is null) return null;

        if (Clean(name) is { } n) service.Name = n;
        if (description is not null) service.Description = Clean(description, 1000);
        if (clearOwner) service.OwnerTeamId = null;
        else if (ownerTeamId is not null) service.OwnerTeamId = ownerTeamId;
        if (sortOrder is not null) service.SortOrder = sortOrder.Value;
        if (isActive is not null) service.IsActive = isActive.Value;
        service.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // Recomputed rather than carried over: renaming a service does not change
        // whether it is down, and the row the caller renders has to say so.
        var live = db.TicketImpactedServices.Where(x =>
            x.ServiceId == id
            && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
            && x.Ticket.StatusCategory != TicketStatusCategory.Closed);
        var open = await live.CountAsync(ct);
        var worst = await live.MinAsync(x => (int?)(
            x.Level == ServiceImpactLevel.Down ? 0
            : x.Level == ServiceImpactLevel.Degraded ? 1
            : 2), ct);
        return new BusinessServiceDto(service.Id, service.Name, service.Description,
            service.OwnerTeamId, service.OwnerTeam?.Name, service.IsActive, service.SortOrder,
            open, LevelOf(worst));
    }

    public async Task<AssetDeleteResult> DeleteServiceAsync(Actor actor, Guid id, CancellationToken ct)
    {
        RequireAdmin(actor);
        var service = await db.BusinessServices.SingleOrDefaultAsync(
            s => s.Id == id && s.WorkspaceId == actor.WorkspaceId, ct);
        if (service is null) return AssetDeleteResult.NotFound;
        if (await db.TicketImpactedServices.AnyAsync(x => x.ServiceId == id, ct))
            return AssetDeleteResult.InUse;

        db.BusinessServices.Remove(service);
        await db.SaveChangesAsync(ct);
        return AssetDeleteResult.Deleted;
    }

    // ---- Impacted services on a ticket ----------------------------------------

    public async Task<IReadOnlyList<TicketImpactedServiceDto>?> ImpactedAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct)) return null;

        return await db.TicketImpactedServices
            .Where(x => x.TicketId == ticketId)
            .OrderBy(x => x.AddedAt)
            .Select(x => new TicketImpactedServiceDto(
                x.ServiceId, x.Service!.Name, x.Impact, x.Level,
                x.Service.OwnerTeam != null ? x.Service.OwnerTeam.Name : null, x.AddedAt))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Records — or re-describes — a service this ticket has broken.
    ///
    /// Upsert on purpose: the first note during an incident is a guess, and
    /// "Payments — degraded" becoming "Payments — down, all regions" is an edit,
    /// not a second entry.
    /// </summary>
    public async Task<bool> SetImpactAsync(
        Actor actor, Guid ticketId, Guid serviceId, string? impact, string? level, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await TicketExistsAsync(actor, ticketId, ct)) return false;

        var service = await db.BusinessServices.SingleOrDefaultAsync(
            s => s.Id == serviceId && s.WorkspaceId == actor.WorkspaceId, ct);
        if (service is null) throw new ArgumentException("That service is not in this workspace.");

        var chosen = level ?? ServiceImpactLevel.Degraded;
        if (!ServiceImpactLevel.IsKnown(chosen))
            throw new ArgumentException("Unknown impact level.");

        var existing = await db.TicketImpactedServices
            .SingleOrDefaultAsync(x => x.TicketId == ticketId && x.ServiceId == serviceId, ct);

        if (existing is null)
        {
            db.TicketImpactedServices.Add(new TicketImpactedService
            {
                TicketId = ticketId,
                ServiceId = serviceId,
                Impact = Clean(impact, 500),
                Level = chosen,
                AddedBy = actor.UserId,
            });
            activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
                TicketActivityType.ServiceImpacted, $"{service.Name} — {chosen}");
        }
        else
        {
            existing.Impact = Clean(impact, 500);
            existing.Level = chosen;
        }

        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> ClearImpactAsync(Actor actor, Guid ticketId, Guid serviceId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();

        var row = await db.TicketImpactedServices
            .Include(x => x.Service)
            .SingleOrDefaultAsync(x => x.TicketId == ticketId && x.ServiceId == serviceId, ct);
        if (row is null) return false;

        db.TicketImpactedServices.Remove(row);
        activity.Happened(actor.WorkspaceId, ticketId, actor.UserId,
            TicketActivityType.ServiceRecovered, row.Service?.Name);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- Helpers ---------------------------------------------------------------

    private static void RequireAdmin(Actor actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();
    }

    private Task<bool> TicketExistsAsync(Actor actor, Guid ticketId, CancellationToken ct) =>
        db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);

    private static string? Clean(string? value, int max = 200)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    /// <summary>
    /// For the two write paths, which know the lifetime count and nothing else.
    ///
    /// An asset that was just created or edited is not being reported on — the
    /// caller is a form waiting for its row back. The open count and the last-seen
    /// date are register questions, and asking two more of the database on every
    /// keystroke of an admin screen would buy nothing anybody looks at.
    /// </summary>
    private static AssetDto Shape(Asset a, int ticketCount) =>
        new(a.Id, a.Name, a.Kind, a.Tag, a.Location,
            UserSummaryDto.From(a.AssignedTo), a.Notes, a.IsActive, ticketCount, 0, null);
}

public enum AssetDeleteResult { Deleted, NotFound, InUse }

/// <param name="TicketCount">Every ticket ever raised about it — its history.</param>
/// <param name="OpenTicketCount">Tickets about it that are still going — its state today.</param>
/// <param name="LastTicketAt">When it was last the subject of one. Null means never, which is good news.</param>
public record AssetDto(
    Guid Id, string Name, string? Kind, string? Tag, string? Location,
    UserSummaryDto? AssignedTo, string? Notes, bool IsActive,
    int TicketCount, int OpenTicketCount, DateTime? LastTicketAt);

/// <param name="Unassigned">On the shelf — the number that answers "what can I give somebody".</param>
/// <param name="InTrouble">Distinct assets named on an unfinished ticket right now.</param>
/// <param name="ByKind">Laptops, phones, printers — however the workspace labels them.</param>
/// <param name="ByLocation">Where they are. The blank bucket is assets nobody recorded a place for.</param>
/// <param name="TopHolders">Who is holding the most, largest first.</param>
public record AssetSummaryDto(
    int Total,
    int Assigned,
    int Unassigned,
    int InTrouble,
    IReadOnlyList<AssetBucketDto> ByKind,
    IReadOnlyList<AssetBucketDto> ByLocation,
    IReadOnlyList<AssetHolderDto> TopHolders);

/// <param name="Value">Null or empty means the column was never filled in.</param>
public record AssetBucketDto(string? Value, int Count);

public record AssetHolderDto(Guid Id, string Name, int Count);

/// <summary>One ticket in an asset's history. Deliberately thin — this is a drill-down list.</summary>
public record AssetTicketDto(
    Guid Id, string Subject, string Status, string StatusName, string StatusCategory,
    string Priority, UserSummaryDto? Assignee, DateTime CreatedAt);

/// <param name="OtherTicketCount">Other tickets about the same asset — the number that turns a register into a diagnosis.</param>
public record TicketAssetDto(
    Guid Id, string Name, string? Kind, string? Tag, string? Location,
    UserSummaryDto? AssignedTo, DateTime AddedAt, int OtherTicketCount);

/// <param name="WorstLevel">
/// The worst impact reported by any open ticket — one of
/// <see cref="ServiceImpactLevel"/>, or null when nothing is wrong. This is the
/// field the status board colours by; <paramref name="OpenTicketCount"/> is how
/// many people are saying it.
/// </param>
public record BusinessServiceDto(
    Guid Id, string Name, string? Description, Guid? OwnerTeamId, string? OwnerTeamName,
    bool IsActive, int SortOrder, int OpenTicketCount, string? WorstLevel);

/// <param name="Level">How badly this particular ticket says the service is affected.</param>
/// <param name="Impact">The agent's own words, if they wrote any.</param>
public record ServiceTicketDto(
    Guid Id, string Subject, string Status, string StatusName, string StatusCategory,
    string Priority, UserSummaryDto? Assignee, string Level, string? Impact, DateTime AddedAt);

public record TicketImpactedServiceDto(
    Guid Id, string Name, string? Impact, string Level, string? OwnerTeamName, DateTime AddedAt);
