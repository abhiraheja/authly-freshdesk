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
