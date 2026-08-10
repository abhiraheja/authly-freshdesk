namespace Trackly.Core.Entities;

/// <summary>
/// One ticket's relationship to another.
///
/// **Stored once, read from both ends.** A "duplicates" link written on A is the
/// same fact as "duplicated by" on B, and storing both rows would mean two
/// records that can disagree — delete one and the pair goes half-broken. The
/// service reads the row from whichever side is asking and flips the label.
///
/// Distinct from <see cref="TicketLink"/>, which points OUT of Trackly at a PR
/// or a doc. This points at another ticket, which means it can be navigated,
/// counted, and closed alongside.
/// </summary>
public class TicketRelation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>The ticket the relationship was written on.</summary>
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    /// <summary>The ticket it points at.</summary>
    public Guid RelatedTicketId { get; set; }
    public Ticket? RelatedTicket { get; set; }

    /// <summary>One of <see cref="TicketRelationKind"/>, read from TicketId's side.</summary>
    public string Kind { get; set; } = TicketRelationKind.Relates;

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The kinds of link, and the label each one takes when read from the other end.
///
/// Kept short on purpose. Jira ships a dozen and teams use three; every extra
/// one is another choice at the moment somebody just wants to say "these two are
/// the same thing".
/// </summary>
public static class TicketRelationKind
{
    /// <summary>Symmetric — reads the same from both ends.</summary>
    public const string Relates = "relates";

    public const string Duplicates = "duplicates";
    public const string DuplicatedBy = "duplicated_by";
    public const string Blocks = "blocks";
    public const string BlockedBy = "blocked_by";
    public const string CausedBy = "caused_by";
    public const string Causes = "causes";

    public static readonly string[] All =
        [Relates, Duplicates, DuplicatedBy, Blocks, BlockedBy, CausedBy, Causes];

    /// <summary>
    /// The pair is the same report twice, so the two tickets end together.
    ///
    /// Both directions, because "A duplicates B" and "B duplicated by A" are one
    /// fact — resolving either end resolves the other, and a rule that only fired
    /// from the side the row happened to be written on would depend on which
    /// agent typed it first.
    ///
    /// Nothing here resolves anything on its own: the agent is shown the list and
    /// ticks what follows (see <c>TicketResolveGuard</c>). Silent propagation
    /// would send a resolution email to customers nobody chose to answer.
    /// </summary>
    public static readonly string[] Duplicate = [Duplicates, DuplicatedBy];

    /// <summary>
    /// Read on a ticket, means: **this one holds the other up.** Resolving this
    /// one is what lets the other start, so the other's assignee is told.
    ///
    /// <see cref="Causes"/> sits here with <see cref="Blocks"/> because the
    /// working consequence is identical — the other ticket cannot move until this
    /// one does. The two words differ in what they say about *why*, which is a
    /// fact for the agent reading the link, not a second behaviour.
    /// </summary>
    public static readonly string[] Blocking = [Blocks, Causes];

    /// <summary>
    /// Read on a ticket, means: **this one is held up by the other.** The ticket
    /// carries a banner while the other is open, and resolving it asks first.
    /// </summary>
    public static readonly string[] Blocked = [BlockedBy, CausedBy];

    /// <summary>Status moves together — see <see cref="Duplicate"/>.</summary>
    public static bool SyncsStatus(string kind) => Duplicate.Contains(kind);

    /// <summary>This ticket holds the other up.</summary>
    public static bool BlocksOther(string kind) => Blocking.Contains(kind);

    /// <summary>This ticket is held up by the other.</summary>
    public static bool IsBlockedByOther(string kind) => Blocked.Contains(kind);

    /// <summary>
    /// What this relationship is called from the other ticket's point of view.
    ///
    /// This is why only one row is stored: the inverse is a pure function of the
    /// kind, so it can never drift out of step with the row it describes.
    /// </summary>
    public static string Inverse(string kind) => kind switch
    {
        Duplicates => DuplicatedBy,
        DuplicatedBy => Duplicates,
        Blocks => BlockedBy,
        BlockedBy => Blocks,
        CausedBy => Causes,
        Causes => CausedBy,
        _ => Relates,
    };

    public static bool IsKnown(string kind) => All.Contains(kind);
}
