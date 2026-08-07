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

public static class TicketOptionKind
{
    public const string Priority = "priority";
    public const string Channel = "channel";

    // Suggested key names for a customer's custom fields. Suggestions only —
    // CustomerRequest never rejects a key that isn't listed, because an agent
    // taking notes on a call must not be blocked by the configuration screen.
    public const string CustomerField = "customer_field";

    public static readonly string[] All = [Priority, Channel, CustomerField];
}
