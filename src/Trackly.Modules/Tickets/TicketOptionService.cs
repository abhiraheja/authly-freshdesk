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

        var inUse = option.Kind == TicketOptionKind.Priority
            ? await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId && t.Priority == option.Value, ct)
            : await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId && t.Channel == option.Value, ct);
        if (inUse) return TicketOptionDeleteResult.InUse;

        if (await IsLastActiveAsync(workspaceId, option, ct)) return TicketOptionDeleteResult.LastActive;

        db.TicketOptions.Remove(option);
        await db.SaveChangesAsync(ct);
        return TicketOptionDeleteResult.Deleted;
    }

    private async Task<bool> IsLastActiveAsync(Guid workspaceId, TicketOption option, CancellationToken ct)
    {
        var anotherIsActive = await db.TicketOptions.AnyAsync(
            o => o.WorkspaceId == workspaceId && o.Kind == option.Kind && o.IsActive && o.Id != option.Id, ct);
        return !anotherIsActive;
    }

    private async Task EnsureSeededAsync(Guid workspaceId, string kind, CancellationToken ct)
    {
        if (await db.TicketOptions.AnyAsync(o => o.WorkspaceId == workspaceId && o.Kind == kind, ct))
            return;

        var defaults = kind == TicketOptionKind.Priority ? DefaultPriorities : DefaultChannels;
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
