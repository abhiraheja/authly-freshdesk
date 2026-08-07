namespace Trackly.Core.Entities;

/// <summary>
/// A status a ticket can be in, as a workspace defines it.
///
/// **Trackly's rules never look at a status. They look at its
/// <see cref="Category"/>.** That split is the whole design: a workspace can
/// invent "Estimation required", "Testing", "Awaiting CAB" and Trackly still
/// knows whether the SLA clock should run, whether to ask for a resolution note,
/// whether to send a CSAT survey and whether the ticket counts as work in the
/// queue — because each of those questions is answered by the category, of which
/// there are exactly five and always will be.
///
/// The alternative — letting features test status names — is how a helpdesk ends
/// up with `if (status == "Done" || status == "Complete" || status == "Closed")`
/// scattered through it, one arm short in three places.
///
/// <see cref="Value"/> is what sits on the ticket and what automation matches;
/// <see cref="Name"/> is what people read. Splitting them lets an admin rename
/// "In progress" to "Working on it" without rewriting stored tickets.
/// </summary>
public class TicketStatus
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>One of <see cref="TicketStatusCategory"/>. Decides all behaviour.</summary>
    public string Category { get; set; } = TicketStatusCategory.Open;

    /// <summary>Stored on the ticket. Lower-case, stable, never edited after creation.</summary>
    public string Value { get; set; } = null!;

    /// <summary>Shown in the UI. Safe to change at any time.</summary>
    public string Name { get; set; } = null!;

    /// <summary>Overrides the category's default badge tone. Optional.</summary>
    public string? Color { get; set; }

    /// <summary>Position within its category.</summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// Inactive statuses stay valid on tickets that already carry them but
    /// disappear from pickers — the honest way to retire one. Deleting would
    /// leave tickets pointing at a value nothing explains.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Where a newly created ticket starts. Exactly one per workspace; the
    /// service moves the flag rather than letting two be set.
    /// </summary>
    public bool IsDefault { get; set; }

    /// <summary>
    /// Shipped with Trackly. Renameable, recolourable, reorderable, but never
    /// deletable: the seeder, the email connector and the chat widget all write
    /// these values directly, so the row has to keep explaining them.
    /// </summary>
    public bool IsSystem { get; set; }
}

/// <summary>
/// The five buckets every status falls into. **Fixed** — a workspace adds
/// statuses, never categories, because every rule in Trackly is written against
/// this list and a sixth would have undefined behaviour everywhere.
/// </summary>
public static class TicketStatusCategory
{
    /// <summary>Raised, nobody has started. The SLA response clock runs.</summary>
    public const string Open = "open";

    /// <summary>Waiting on somebody outside the team. The resolve clock pauses.</summary>
    public const string Pending = "pending";

    /// <summary>Being worked on. Clocks run.</summary>
    public const string Active = "active";

    /// <summary>Fixed. Stamps resolved_at, issues the CSAT survey, stops the clock.</summary>
    public const string Resolved = "resolved";

    /// <summary>Filed away. Stops the clock; no survey.</summary>
    public const string Closed = "closed";

    /// <summary>Display order, and the order the admin screen groups them in.</summary>
    public static readonly string[] All = [Open, Pending, Active, Resolved, Closed];

    /// <summary>The work is over. No clock, no queue, no "needs attention".</summary>
    public static bool IsTerminal(string category) => category is Resolved or Closed;

    /// <summary>Still somebody's problem — what a queue count means.</summary>
    public static bool IsOpen(string category) => !IsTerminal(category);

    /// <summary>The starting value Trackly seeds and falls back to.</summary>
    public const string DefaultValue = Open;
}

/// <summary>
/// One allowed move in the workflow: from a status to a status.
///
/// A null <see cref="FromStatusId"/> means "from anywhere" — Jira's ANY STATUS.
/// A workspace that has never touched the workflow is seeded entirely with those,
/// so every status reaches every other and the behaviour matches what Trackly did
/// before workflows existed.
///
/// **An empty transition table means everything is allowed, not nothing.** A
/// workspace whose rows were somehow all deleted must not become a place where
/// no ticket can ever change status again.
/// </summary>
public class TicketStatusTransition
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>Null = from any status.</summary>
    public Guid? FromStatusId { get; set; }
    public TicketStatus? FromStatus { get; set; }

    public Guid ToStatusId { get; set; }
    public TicketStatus ToStatus { get; set; } = null!;
}
