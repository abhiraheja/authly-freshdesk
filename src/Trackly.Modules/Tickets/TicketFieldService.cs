using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

/// <summary>
/// The workspace's own ticket properties: the definitions, and the answers.
///
/// Trackly's built-in properties are columns because the product reasons about
/// them. Anything a workspace invents cannot be reasoned about by code that has
/// never heard of it, so it is data — a definition row and an answer row.
///
/// **A select can learn.** Saving a value that is not on the list adds it, when
/// the field allows that. Without it, filling in a ticket means stopping to ask
/// an admin to add "Mumbai" to a list of offices, and the field gets left blank
/// instead.
/// </summary>
public class TicketFieldService(TracklyDbContext db, ActivityLog activity)
{
    // ---- Definitions -----------------------------------------------------------

    public async Task<IReadOnlyList<TicketFieldDto>> ListAsync(
        Actor actor, bool includeInactive, CancellationToken ct)
    {
        var query = db.TicketFields.Where(f => f.WorkspaceId == actor.WorkspaceId);
        if (!includeInactive) query = query.Where(f => f.IsActive);

        var fields = await query.OrderBy(f => f.SortOrder).ThenBy(f => f.Label).ToListAsync(ct);
        return fields.Select(Shape).ToList();
    }

    public async Task<TicketFieldDto> CreateAsync(
        Actor actor, string label, string type, string? helpText, string? options,
        bool allowNewOptions, bool isRequired, CancellationToken ct)
    {
        RequireAdmin(actor);
        label = Clean(label) ?? throw new ArgumentException("A field needs a label.");
        if (!TicketFieldType.IsKnown(type)) throw new ArgumentException("Unknown field type.");

        var key = Slugify(label);
        if (key.Length == 0)
            throw new ArgumentException("The label needs at least one letter or digit.");
        if (await db.TicketFields.AnyAsync(f => f.WorkspaceId == actor.WorkspaceId && f.Key == key, ct))
            throw new ArgumentException("A field with that name already exists.");

        // A select with nothing in it is a control that cannot be used — unless
        // it is allowed to learn, in which case the first answer fills it.
        var cleanedOptions = CleanOptions(options);
        if (TicketFieldType.HasOptions(type) && cleanedOptions is null && !allowNewOptions)
            throw new ArgumentException("Add at least one choice, or allow new values to be typed in.");

        var next = await db.TicketFields
            .Where(f => f.WorkspaceId == actor.WorkspaceId)
            .Select(f => (int?)f.SortOrder).MaxAsync(ct) ?? -1;

        var field = new TicketField
        {
            WorkspaceId = actor.WorkspaceId,
            Key = key,
            Label = label,
            Type = type,
            HelpText = Clean(helpText, 300),
            Options = cleanedOptions,
            AllowNewOptions = allowNewOptions,
            IsRequired = isRequired,
            SortOrder = next + 1,
        };
        db.TicketFields.Add(field);
        await db.SaveChangesAsync(ct);
        return Shape(field);
    }

    /// <summary>
    /// Edits a definition. **The key and the type are not editable.**
    ///
    /// The key is what every stored answer points at. The type is what those
    /// answers were written under — turning a text field into a checkbox would
    /// leave a column of sentences that render as neither ticked nor unticked,
    /// and there is no honest migration for that. Retire it and make a new one.
    /// </summary>
    public async Task<TicketFieldDto?> UpdateAsync(
        Actor actor, Guid id, string? label, string? helpText, string? options,
        bool? allowNewOptions, bool? isRequired, int? sortOrder, bool? isActive, CancellationToken ct)
    {
        RequireAdmin(actor);
        var field = await db.TicketFields.SingleOrDefaultAsync(
            f => f.Id == id && f.WorkspaceId == actor.WorkspaceId, ct);
        if (field is null) return null;

        if (Clean(label) is { } l) field.Label = l;
        if (helpText is not null) field.HelpText = Clean(helpText, 300);
        if (options is not null) field.Options = CleanOptions(options);
        if (allowNewOptions is not null) field.AllowNewOptions = allowNewOptions.Value;
        if (isRequired is not null) field.IsRequired = isRequired.Value;
        if (sortOrder is not null) field.SortOrder = sortOrder.Value;
        if (isActive is not null) field.IsActive = isActive.Value;
        field.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Shape(field);
    }

    /// <summary>
    /// Deletes a field and every answer to it — which is why it is refused once
    /// anything has been answered. Retiring keeps the answers and takes the field
    /// off the form.
    /// </summary>
    public async Task<AssetDeleteResult> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        RequireAdmin(actor);
        var field = await db.TicketFields.SingleOrDefaultAsync(
            f => f.Id == id && f.WorkspaceId == actor.WorkspaceId, ct);
        if (field is null) return AssetDeleteResult.NotFound;
        if (await db.TicketFieldValues.AnyAsync(v => v.FieldId == id, ct)) return AssetDeleteResult.InUse;

        db.TicketFields.Remove(field);
        await db.SaveChangesAsync(ct);
        return AssetDeleteResult.Deleted;
    }

    // ---- Answers -----------------------------------------------------------------

    /// <summary>
    /// Every active field with this ticket's answer, so the form can be rendered
    /// from one call rather than joining two lists in the client.
    ///
    /// Retired fields still appear **when this ticket has an answer to them** —
    /// hiding it would silently drop information the ticket is carrying, and the
    /// agent would have no idea it was ever there.
    /// </summary>
    public async Task<IReadOnlyList<TicketFieldAnswerDto>?> ForTicketAsync(
        Actor actor, Guid ticketId, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct))
            return null;

        var fields = await db.TicketFields
            .Where(f => f.WorkspaceId == actor.WorkspaceId)
            .OrderBy(f => f.SortOrder).ThenBy(f => f.Label)
            .ToListAsync(ct);
        var answers = await db.TicketFieldValues
            .Where(v => v.TicketId == ticketId)
            .ToDictionaryAsync(v => v.FieldId, v => v.Value, ct);

        return fields
            .Where(f => f.IsActive || answers.ContainsKey(f.Id))
            .Select(f => new TicketFieldAnswerDto(
                f.Id, f.Key, f.Label, f.Type, f.HelpText, f.OptionList(),
                f.AllowNewOptions, f.IsRequired, f.IsActive, answers.GetValueOrDefault(f.Id)))
            .ToList();
    }

    /// <summary>
    /// Writes answers. Keyed by field id; an empty or whitespace value deletes
    /// the row.
    ///
    /// Deleting rather than storing "" is what keeps "never answered" and
    /// "answered with nothing" from becoming two states that look identical on
    /// screen and behave differently in a query.
    /// </summary>
    public async Task<IReadOnlyList<TicketFieldAnswerDto>?> SaveAsync(
        Actor actor, Guid ticketId, IReadOnlyDictionary<Guid, string?> values, CancellationToken ct)
    {
        if (!actor.IsAgentOrAdmin) throw new UnauthorizedAccessException();
        if (!await db.Tickets.AnyAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct))
            return null;

        var fields = await db.TicketFields
            .Where(f => f.WorkspaceId == actor.WorkspaceId && values.Keys.Contains(f.Id))
            .ToListAsync(ct);
        if (fields.Count != values.Count)
            throw new ArgumentException("One of those fields is not in this workspace.");

        var existing = await db.TicketFieldValues
            .Where(v => v.TicketId == ticketId)
            .ToDictionaryAsync(v => v.FieldId, ct);

        foreach (var field in fields)
        {
            var raw = values[field.Id];
            var value = Normalize(field, raw);

            if (value is null)
            {
                if (field.IsRequired && field.IsActive)
                    throw new ArgumentException($"\"{field.Label}\" is required.");
                if (existing.TryGetValue(field.Id, out var gone))
                {
                    db.TicketFieldValues.Remove(gone);
                    activity.Changed(actor.WorkspaceId, ticketId, actor.UserId,
                        TicketActivityType.FieldChanged, $"{field.Label}: {gone.Value}", field.Label);
                }
                continue;
            }

            // A select that is allowed to learn remembers what was typed, so the
            // next agent picks it off the list instead of typing it again —
            // which is how one office becomes "Mumbai", "mumbai" and "Mumbai ".
            if (TicketFieldType.HasOptions(field.Type) && !field.OptionList().Contains(value))
            {
                if (!field.AllowNewOptions)
                    throw new ArgumentException($"\"{value}\" is not one of the choices for {field.Label}.");
                field.Options = string.IsNullOrWhiteSpace(field.Options)
                    ? value
                    : field.Options.TrimEnd('\n') + "\n" + value;
                field.UpdatedAt = DateTime.UtcNow;
            }

            if (existing.TryGetValue(field.Id, out var row))
            {
                if (row.Value == value) continue;   // no-op: not a change, not an entry
                activity.Changed(actor.WorkspaceId, ticketId, actor.UserId,
                    TicketActivityType.FieldChanged, $"{field.Label}: {row.Value}", $"{field.Label}: {value}");
                row.Value = value;
                row.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                db.TicketFieldValues.Add(new TicketFieldValue
                {
                    TicketId = ticketId,
                    FieldId = field.Id,
                    Value = value,
                });
                activity.Changed(actor.WorkspaceId, ticketId, actor.UserId,
                    TicketActivityType.FieldChanged, field.Label, $"{field.Label}: {value}");
            }
        }

        await db.SaveChangesAsync(ct);
        return await ForTicketAsync(actor, ticketId, ct);
    }

    /// <summary>
    /// Every required, active field this ticket has not answered.
    ///
    /// Returned rather than thrown so the caller decides. An agent saving a
    /// ticket should be stopped; an inbound email should not be — the customer
    /// has never seen these fields, and dropping their message over one is not a
    /// trade any workspace would make.
    /// </summary>
    public async Task<IReadOnlyList<string>> MissingRequiredAsync(
        Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var required = await db.TicketFields
            .Where(f => f.WorkspaceId == workspaceId && f.IsActive && f.IsRequired)
            .Select(f => new { f.Id, f.Label })
            .ToListAsync(ct);
        if (required.Count == 0) return [];

        var answered = await db.TicketFieldValues
            .Where(v => v.TicketId == ticketId)
            .Select(v => v.FieldId)
            .ToListAsync(ct);

        return required.Where(f => !answered.Contains(f.Id)).Select(f => f.Label).ToList();
    }

    // ---- Helpers -------------------------------------------------------------------

    private static void RequireAdmin(Actor actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();
    }

    /// <summary>
    /// Turns a raw answer into what gets stored, or null for "no answer".
    ///
    /// A checkbox is the odd one: unticked is a real answer, not an absence, so
    /// it stores "false" rather than deleting the row. Otherwise a required
    /// checkbox could never be satisfied by saying no.
    /// </summary>
    private static string? Normalize(TicketField field, string? raw)
    {
        if (field.Type == TicketFieldType.Checkbox)
            return raw is "true" or "True" ? "true" : "false";
        return Clean(raw, 1000);
    }

    private static string? Clean(string? value, int max = 200)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    /// <summary>One choice per line, blanks and duplicates dropped.</summary>
    private static string? CleanOptions(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var lines = raw
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(l => l.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(200)
            .ToList();
        return lines.Count == 0 ? null : string.Join('\n', lines);
    }

    private static string Slugify(string label)
    {
        var chars = label.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();
        var slug = string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return slug.Length > 64 ? slug[..64] : slug;
    }

    private static TicketFieldDto Shape(TicketField f) =>
        new(f.Id, f.Key, f.Label, f.Type, f.HelpText, f.OptionList(),
            f.AllowNewOptions, f.IsRequired, f.SortOrder, f.IsActive);
}

public record TicketFieldDto(
    Guid Id, string Key, string Label, string Type, string? HelpText,
    IReadOnlyList<string> Options, bool AllowNewOptions, bool IsRequired,
    int SortOrder, bool IsActive);

/// <param name="IsActive">False means retired — shown only because this ticket answered it.</param>
public record TicketFieldAnswerDto(
    Guid Id, string Key, string Label, string Type, string? HelpText,
    IReadOnlyList<string> Options, bool AllowNewOptions, bool IsRequired,
    bool IsActive, string? Value);
