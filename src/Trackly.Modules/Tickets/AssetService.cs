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
                db.TicketAssets.Count(x => x.AssetId == a.Id)))
            .ToListAsync(ct);
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

        return await query
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
            .Select(s => new BusinessServiceDto(
                s.Id, s.Name, s.Description, s.OwnerTeamId,
                s.OwnerTeam != null ? s.OwnerTeam.Name : null,
                s.IsActive, s.SortOrder,
                // Open tickets currently hitting it — the number that makes the
                // catalogue an incident board rather than a list of nouns.
                db.TicketImpactedServices.Count(x =>
                    x.ServiceId == s.Id
                    && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
                    && x.Ticket.StatusCategory != TicketStatusCategory.Closed)))
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
        return new BusinessServiceDto(service.Id, service.Name, service.Description,
            service.OwnerTeamId, null, service.IsActive, service.SortOrder, 0);
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

        var open = await db.TicketImpactedServices.CountAsync(x =>
            x.ServiceId == id
            && x.Ticket!.StatusCategory != TicketStatusCategory.Resolved
            && x.Ticket.StatusCategory != TicketStatusCategory.Closed, ct);
        return new BusinessServiceDto(service.Id, service.Name, service.Description,
            service.OwnerTeamId, service.OwnerTeam?.Name, service.IsActive, service.SortOrder, open);
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

    private static AssetDto Shape(Asset a, int ticketCount) =>
        new(a.Id, a.Name, a.Kind, a.Tag, a.Location,
            UserSummaryDto.From(a.AssignedTo), a.Notes, a.IsActive, ticketCount);
}

public enum AssetDeleteResult { Deleted, NotFound, InUse }

public record AssetDto(
    Guid Id, string Name, string? Kind, string? Tag, string? Location,
    UserSummaryDto? AssignedTo, string? Notes, bool IsActive, int TicketCount);

/// <param name="OtherTicketCount">Other tickets about the same asset — the number that turns a register into a diagnosis.</param>
public record TicketAssetDto(
    Guid Id, string Name, string? Kind, string? Tag, string? Location,
    UserSummaryDto? AssignedTo, DateTime AddedAt, int OtherTicketCount);

public record BusinessServiceDto(
    Guid Id, string Name, string? Description, Guid? OwnerTeamId, string? OwnerTeamName,
    bool IsActive, int SortOrder, int OpenTicketCount);

public record TicketImpactedServiceDto(
    Guid Id, string Name, string? Impact, string Level, string? OwnerTeamName, DateTime AddedAt);
