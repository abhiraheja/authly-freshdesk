namespace Trackly.Core.Entities;

/// <summary>
/// An admin-configured choice for one of the ticket's fixed-vocabulary fields.
///
/// Priority and channel used to be compile-time constants. They are rows now so
/// a workspace can name its own — "Critical", "Walk-in", "Phone" — without a
/// deploy. Departments and categories already had their own tables and keep
/// them; this covers the two that did not.
///
/// <see cref="Value"/> is what lands on the ticket and what automation rules
/// match; <see cref="Label"/> is what people read. Splitting them is what lets
/// an admin rename "medium" to "Normal" without rewriting every rule and every
/// stored ticket.
/// </summary>
public class TicketOption
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>One of <see cref="TicketOptionKind"/>.</summary>
    public string Kind { get; set; } = null!;

    /// <summary>Stored on the ticket. Lower-case, stable, never edited after creation.</summary>
    public string Value { get; set; } = null!;

    /// <summary>Shown in the UI. Safe to change at any time.</summary>
    public string Label { get; set; } = null!;

    public string? Color { get; set; }
    public int SortOrder { get; set; }

    /// <summary>
    /// Inactive options stay valid on the tickets that already carry them but
    /// disappear from pickers. This is the honest way to retire a choice —
    /// deleting one would leave tickets pointing at a value nothing explains.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Shipped with Trackly. Can be relabelled, recoloured, reordered and
    /// deactivated, but never deleted: connectors and the seeder write these
    /// values directly, so the row has to keep explaining them.
    /// </summary>
    public bool IsSystem { get; set; }
}

/// <summary>
/// The cards the ticket view's right rail can draw.
///
/// The keys are Trackly's, not the admin's — the frontend switches on them to
/// decide what to render, so a workspace can reorder, relabel and hide them but
/// cannot invent one. That is why every seeded row is
/// <see cref="TicketOption.IsSystem"/>: a key with no renderer behind it would
/// be an entry in the settings screen that does nothing on the page.
/// </summary>
public static class TicketPanels
{
    public const string Info = "info";
    public const string Resolution = "resolution";
    public const string Sla = "sla";
    public const string Ai = "ai";
    public const string Customer = "customer";
    public const string Properties = "properties";
    public const string Related = "related";
    public const string Watchers = "watchers";
    public const string Time = "time";
    public const string Actions = "actions";

    /// <summary>Default order, top to bottom. Also what a new workspace is seeded with.</summary>
    public static readonly (string Value, string Label)[] Defaults =
    [
        (Info, "Ticket information"),
        (Resolution, "Resolution"),
        (Sla, "SLA timer"),
        (Customer, "Customer"),
        (Properties, "Properties"),
        (Related, "Related work"),
        (Time, "Time spent"),
        (Watchers, "Watchers"),
        (Actions, "Actions"),
        (Ai, "AI insights"),
    ];
}

public static class TicketOptionKind
{
    public const string Priority = "priority";
    public const string Channel = "channel";

    // Suggested key names for a customer's custom fields. Suggestions only —
    // CustomerRequest never rejects a key that isn't listed, because an agent
    // taking notes on a call must not be blocked by the configuration screen.
    public const string CustomerField = "customer_field";

    /// <summary>
    /// The cards in the ticket view's right rail: which are shown, and in what
    /// order. <see cref="TicketOption.Value"/> is a
    /// <see cref="TicketPanels">panel key</see>, <see cref="TicketOption.SortOrder"/>
    /// is the position, and <see cref="TicketOption.IsActive"/> is whether it is
    /// rendered at all.
    ///
    /// It shares this table because it is the same shape and the same admin
    /// screen — a per-workspace ordered list of labelled values. Hiding a panel
    /// only stops it being drawn; every field behind it is nullable and nothing
    /// on the ticket changes.
    /// </summary>
    public const string TicketPanel = "ticket_panel";

    public static readonly string[] All = [Priority, Channel, CustomerField, TicketPanel];
}
