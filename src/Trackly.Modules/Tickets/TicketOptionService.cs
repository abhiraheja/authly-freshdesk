using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// Admin-configured vocabularies for priority and channel.
///
/// Every read seeds Trackly's built-ins first if the workspace has none. That is
/// deliberately lazy rather than a data migration: it fixes existing workspaces
/// and new ones by the same path, and a workspace that has customised its list
/// is never touched again because the check is "has any row of this kind", not
/// "has this particular row".
/// </summary>
public class TicketOptionService(TracklyDbContext db)
{
    // Trackly's own values. Order is the order they appear in every picker.
    private static readonly (string Value, string Label, string? Color)[] DefaultPriorities =
    [
        ("low", "Low", null),
        ("medium", "Medium", null),
        ("high", "High", null),
        ("urgent", "Urgent", null),
    ];

    private static readonly (string Value, string Label, string? Color)[] DefaultChannels =
    [
        ("web", "Web", null),
        ("email", "Email", null),
        ("widget", "Widget", null),
        ("chat", "Live chat", null),
        ("whatsapp", "WhatsApp", null),
        ("slack", "Slack", null),
        ("teams", "Microsoft Teams", null),
    ];

    public async Task<IReadOnlyList<TicketOptionDto>> ListAsync(
        Guid workspaceId, string kind, bool includeInactive, CancellationToken ct)
    {
        Require(kind);
        await EnsureSeededAsync(workspaceId, kind, ct);

        var options = db.TicketOptions.Where(o => o.WorkspaceId == workspaceId && o.Kind == kind);
        if (!includeInactive) options = options.Where(o => o.IsActive);

        return await options
            .OrderBy(o => o.SortOrder).ThenBy(o => o.Label)
            .Select(o => new TicketOptionDto(o.Id, o.Kind, o.Value, o.Label, o.Color, o.SortOrder, o.IsActive, o.IsSystem))
            .ToListAsync(ct);
    }

    /// <summary>Active values only — what a create/update request is allowed to set.</summary>
    public async Task<HashSet<string>> ActiveValuesAsync(Guid workspaceId, string kind, CancellationToken ct)
    {
        Require(kind);
        await EnsureSeededAsync(workspaceId, kind, ct);
        var values = await db.TicketOptions
            .Where(o => o.WorkspaceId == workspaceId && o.Kind == kind && o.IsActive)
            .Select(o => o.Value)
            .ToListAsync(ct);
        return values.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public async Task<TicketOptionDto> CreateAsync(
        Guid workspaceId, string kind, string label, string? color, CancellationToken ct)
    {
        Require(kind);
        if (string.IsNullOrWhiteSpace(label))
            throw new ArgumentException("A label is required.");

        // Panel keys are Trackly's — the rail switches on them to pick a
        // renderer, so an invented one would be a row in the settings screen
        // that draws nothing at all.
        if (kind == TicketOptionKind.TicketPanel)
            throw new ArgumentException("Ticket panels are built in. Reorder, rename or hide them instead.");

        await EnsureSeededAsync(workspaceId, kind, ct);

        // The value is derived from the label once, at creation. After that the
        // label is free to change while the value — which is sitting on tickets
        // and inside automation rules — stays put.
        var value = Slugify(label);
        if (value.Length == 0)
            throw new ArgumentException("The label needs at least one letter or digit.");

        if (await db.TicketOptions.AnyAsync(
                o => o.WorkspaceId == workspaceId && o.Kind == kind && o.Value == value, ct))
            throw new ArgumentException($"A {kind} with that name already exists.");

        var nextOrder = await db.TicketOptions
            .Where(o => o.WorkspaceId == workspaceId && o.Kind == kind)
            .Select(o => (int?)o.SortOrder)
            .MaxAsync(ct) ?? -1;

        var option = new TicketOption
        {
            WorkspaceId = workspaceId,
            Kind = kind,
            Value = value,
            Label = label.Trim(),
            Color = color,
            SortOrder = nextOrder + 1,
        };
        db.TicketOptions.Add(option);
        await db.SaveChangesAsync(ct);
        return ToDto(option);
    }

    public async Task<TicketOptionDto?> UpdateAsync(
        Guid workspaceId, Guid id, string? label, string? color, int? sortOrder, bool? isActive,
        CancellationToken ct)
    {
        var option = await db.TicketOptions
            .SingleOrDefaultAsync(o => o.Id == id && o.WorkspaceId == workspaceId, ct);
        if (option is null) return null;

        if (!string.IsNullOrWhiteSpace(label)) option.Label = label.Trim();
        if (color is not null) option.Color = color.Length == 0 ? null : color;
        if (sortOrder is not null) option.SortOrder = sortOrder.Value;

        if (isActive is not null)
        {
            // Refusing to deactivate the last one is not fussiness: an empty
            // picker makes the field unfillable and every new ticket invalid.
            if (!isActive.Value && await IsLastActiveAsync(workspaceId, option, ct))
                throw new ArgumentException($"At least one {option.Kind} must stay active.");
            option.IsActive = isActive.Value;
        }

        await db.SaveChangesAsync(ct);
        return ToDto(option);
    }

    /// <summary>
    /// Deletes only when nothing depends on the value. A used option is retired
    /// by deactivating it — removing the row would leave tickets carrying a
    /// value with no label, which reads as corrupt data rather than as history.
    /// </summary>
    public async Task<TicketOptionDeleteResult> DeleteAsync(Guid workspaceId, Guid id, CancellationToken ct)
    {
        var option = await db.TicketOptions
            .SingleOrDefaultAsync(o => o.Id == id && o.WorkspaceId == workspaceId, ct);
        if (option is null) return TicketOptionDeleteResult.NotFound;

        if (option.IsSystem) return TicketOptionDeleteResult.SystemOption;

        var inUse = option.Kind switch
        {
            TicketOptionKind.Priority =>
                await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId && t.Priority == option.Value, ct),
            TicketOptionKind.Channel =>
                await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId && t.Channel == option.Value, ct),
            // A customer field is only a suggested key name. Nothing stores it,
            // so removing it can't orphan anything — the values already on a
            // customer keep their own keys.
            _ => false,
        };
        if (inUse) return TicketOptionDeleteResult.InUse;

        if (await IsLastActiveAsync(workspaceId, option, ct)) return TicketOptionDeleteResult.LastActive;

        db.TicketOptions.Remove(option);
        await db.SaveChangesAsync(ct);
        return TicketOptionDeleteResult.Deleted;
    }

    /// <remarks>
    /// Only applies to the kinds a ticket must carry. An empty customer-field
    /// list is a perfectly good state — the suggestions are optional and an
    /// agent can always type their own key — so guarding the last one would
    /// trap the admin with a field they never wanted.
    /// </remarks>
    private async Task<bool> IsLastActiveAsync(Guid workspaceId, TicketOption option, CancellationToken ct)
    {
        if (option.Kind == TicketOptionKind.CustomerField) return false;
        // A workspace that wants an empty rail is entitled to one. Every field
        // behind a panel is nullable, so hiding them all changes what is drawn
        // and nothing else.
        if (option.Kind == TicketOptionKind.TicketPanel) return false;

        var anotherIsActive = await db.TicketOptions.AnyAsync(
            o => o.WorkspaceId == workspaceId && o.Kind == option.Kind && o.IsActive && o.Id != option.Id, ct);
        return !anotherIsActive;
    }

    private async Task EnsureSeededAsync(Guid workspaceId, string kind, CancellationToken ct)
    {
        // Panels are topped up rather than seeded once. The keys belong to
        // Trackly, so a card added in a later release has to appear in every
        // existing workspace — the all-or-nothing check below would hide it from
        // everyone who had already opened this screen once.
        if (kind == TicketOptionKind.TicketPanel)
        {
            await TopUpPanelsAsync(workspaceId, ct);
            return;
        }

        if (await db.TicketOptions.AnyAsync(o => o.WorkspaceId == workspaceId && o.Kind == kind, ct))
            return;

        // Must stay exhaustive. A two-way ternary here silently seeded
        // customer_field with the CHANNEL list, so the admin screen showed
        // "Web, Email, Widget…" as customer fields — and marked IsSystem, so
        // they couldn't be deleted either. Any new kind needs its own arm.
        (string Value, string Label, string? Color)[] defaults = kind switch
        {
            TicketOptionKind.Priority => DefaultPriorities,
            TicketOptionKind.Channel => DefaultChannels,
            // The rail's cards. Trackly owns the keys — the renderer switches on
            // them — so these are seeded as system rows: reorderable, hideable,
            // relabelable, never deletable and never addable.
            TicketOptionKind.TicketPanel =>
                TicketPanels.Defaults.Select(p => (p.Value, p.Label, (string?)null)).ToArray(),
            // Customer fields have no built-ins on purpose: what a workspace
            // records about a customer is its own business, and a seeded guess
            // would put words in the admin's mouth.
            _ => [],
        };
        if (defaults.Length == 0) return;

        for (var i = 0; i < defaults.Length; i++)
        {
            var (value, label, color) = defaults[i];
            db.TicketOptions.Add(new TicketOption
            {
                WorkspaceId = workspaceId,
                Kind = kind,
                Value = value,
                Label = label,
                Color = color,
                SortOrder = i,
                IsSystem = true,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Adds any panel key the workspace does not have yet, at the end of the
    /// list and switched on. Existing rows are left exactly as the admin left
    /// them — order, label and visibility included.
    /// </summary>
    private async Task TopUpPanelsAsync(Guid workspaceId, CancellationToken ct)
    {
        var have = await db.TicketOptions
            .Where(o => o.WorkspaceId == workspaceId && o.Kind == TicketOptionKind.TicketPanel)
            .Select(o => o.Value)
            .ToListAsync(ct);
        var known = have.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var missing = TicketPanels.Defaults.Where(p => !known.Contains(p.Value)).ToList();
        if (missing.Count == 0) return;

        // A first seed keeps the default order; a top-up appends, so a new card
        // never pushes itself above what the admin arranged.
        var nextOrder = have.Count == 0
            ? 0
            : (await db.TicketOptions
                .Where(o => o.WorkspaceId == workspaceId && o.Kind == TicketOptionKind.TicketPanel)
                .Select(o => (int?)o.SortOrder)
                .MaxAsync(ct) ?? -1) + 1;

        foreach (var (value, label) in missing)
        {
            db.TicketOptions.Add(new TicketOption
            {
                WorkspaceId = workspaceId,
                Kind = TicketOptionKind.TicketPanel,
                Value = value,
                Label = label,
                SortOrder = nextOrder++,
                IsSystem = true,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static void Require(string kind)
    {
        if (!TicketOptionKind.All.Contains(kind))
            throw new ArgumentException("Unknown option kind.");
    }

    // Lower-case, non-alphanumerics collapsed to a single dash. Matches the shape
    // of the built-in values so a custom option is indistinguishable from one.
    private static string Slugify(string label)
    {
        var chars = label.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();
        var slug = string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return slug.Length > 64 ? slug[..64] : slug;
    }

    private static TicketOptionDto ToDto(TicketOption o) =>
        new(o.Id, o.Kind, o.Value, o.Label, o.Color, o.SortOrder, o.IsActive, o.IsSystem);
}

public enum TicketOptionDeleteResult
{
    Deleted,
    NotFound,
    SystemOption,
    InUse,
    LastActive,
}

public record TicketOptionDto(
    Guid Id,
    string Kind,
    string Value,
    string Label,
    string? Color,
    int SortOrder,
    bool IsActive,
    bool IsSystem);
