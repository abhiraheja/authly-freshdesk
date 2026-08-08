namespace Trackly.Core.Entities;

/// <summary>
/// A property this workspace tracks on its tickets, beyond the ones Trackly
/// ships.
///
/// Trackly's own properties — status, priority, department, category, assignee —
/// are columns, because the product reasons about them: SLA clocks, routing,
/// counts, permissions. Anything a workspace invents cannot be reasoned about by
/// code that has never heard of it, so it lives here as data.
///
/// **The key never changes.** It is derived from the label once, at creation,
/// and is what every stored value points at; renaming the label is safe and
/// renaming the key would orphan every answer ever given.
/// </summary>
public class TicketField
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>Stable slug, derived from the label at creation and never edited.</summary>
    public string Key { get; set; } = null!;

    /// <summary>What agents read. Safe to change at any time.</summary>
    public string Label { get; set; } = null!;

    /// <summary>One of <see cref="TicketFieldType"/>.</summary>
    public string Type { get; set; } = TicketFieldType.Text;

    /// <summary>Sentence under the field. For the rule an agent cannot guess.</summary>
    public string? HelpText { get; set; }

    /// <summary>
    /// Choices for select and radio, newline-separated.
    ///
    /// Newlines rather than JSON because an admin edits this in a textarea and a
    /// malformed array is a field nobody can fill in. Ignored for the other types.
    /// </summary>
    public string? Options { get; set; }

    /// <summary>
    /// Whether a select accepts a value that is not on the list yet, and
    /// remembers it for next time.
    ///
    /// This is what makes a select usable on day one: the alternative is an agent
    /// stopping mid-ticket to ask an admin to add "Mumbai" to a list of offices.
    /// Only meaningful for <see cref="TicketFieldType.Select"/>.
    /// </summary>
    public bool AllowNewOptions { get; set; } = true;

    /// <summary>
    /// Blocks saving the ticket when empty.
    ///
    /// Only ever enforced for agents editing a ticket. A required custom field
    /// can never block an inbound email or a chat transcript from becoming a
    /// ticket — the customer has no idea it exists, and dropping their message
    /// over a field they never saw is not a trade any workspace would choose.
    /// </summary>
    public bool IsRequired { get; set; }

    public int SortOrder { get; set; }

    /// <summary>Retired rather than deleted, so stored answers keep their label.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>The choices, parsed. Empty for types that do not have any.</summary>
    public IReadOnlyList<string> OptionList() =>
        string.IsNullOrWhiteSpace(Options)
            ? []
            : Options.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>
/// The four shapes a custom property can take.
///
/// One string per type, not a class hierarchy: the API stores every answer as
/// text and the client picks a control. A number type is deliberately absent —
/// it invites validation rules, ranges and formatting that nothing in Trackly
/// would then use, and a text field holds "12" perfectly well.
/// </summary>
public static class TicketFieldType
{
    /// <summary>Single-line free text.</summary>
    public const string Text = "text";

    /// <summary>A dropdown. May accept new values — see <see cref="TicketField.AllowNewOptions"/>.</summary>
    public const string Select = "select";

    /// <summary>Radio buttons: the same data as a select, all options visible at once.</summary>
    public const string Radio = "radio";

    /// <summary>A single checkbox. Stored as "true"/"false".</summary>
    public const string Checkbox = "checkbox";

    public static readonly string[] All = [Text, Select, Radio, Checkbox];
    public static bool IsKnown(string type) => All.Contains(type);

    /// <summary>Whether this type is filled in from a list of choices.</summary>
    public static bool HasOptions(string type) => type is Select or Radio;
}

/// <summary>
/// One ticket's answer to one custom field.
///
/// A row per answered field, not a JSON blob on the ticket: this is what lets a
/// value be filtered and counted in SQL, and what stops one malformed write
/// corrupting every other answer on the ticket.
///
/// **An empty answer is no row.** Clearing a field deletes it, so "never
/// answered" and "answered with nothing" cannot drift apart into two states that
/// look identical on screen and behave differently in a query.
/// </summary>
public class TicketFieldValue
{
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public Guid FieldId { get; set; }
    public TicketField? Field { get; set; }

    public string Value { get; set; } = null!;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
