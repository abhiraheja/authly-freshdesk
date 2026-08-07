namespace Trackly.Core.Entities;

/// <summary>
/// Work elsewhere that this ticket is about — a user story, a PR, a runbook, a
/// design doc.
///
/// Many rows rather than the single <see cref="Ticket.ResolutionLink"/> column,
/// because a ticket usually touches more than one thing: the story it came from,
/// the PR that fixed it, and the incident it was raised under are three
/// different links and collapsing them into one loses two.
///
/// The resolve dialog still asks for one link, and that one is copied here so it
/// appears in the card with the rest. The column stays as "the link for the
/// resolution this ticket currently has" — it is cleared on reopen, and these
/// rows are not, because the work still happened.
///
/// **Agent-facing.** These are engineering references, on the same footing as a
/// private note (invariant 5), and never reach a customer or guest surface.
/// </summary>
public class TicketLink
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    /// <summary>Absolute http(s) URL. Validated on write — this is rendered as a link.</summary>
    public string Url { get; set; } = null!;

    /// <summary>What it points at. Falls back to the URL when nobody typed one.</summary>
    public string? Title { get; set; }

    /// <summary>
    /// One of <see cref="TicketLinkKind"/>. Free text, not an enum column: a
    /// workspace's own tracker has its own words for these, and an unknown kind
    /// should render as a neutral chip rather than be rejected.
    /// </summary>
    public string Kind { get; set; } = TicketLinkKind.Related;

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class TicketLinkKind
{
    public const string Related = "related";
    public const string UserStory = "story";
    public const string PullRequest = "pr";
    public const string Document = "doc";

    /// <summary>What Trackly offers in the picker. Never used as validation.</summary>
    public static readonly string[] All = [Related, UserStory, PullRequest, Document];
}
