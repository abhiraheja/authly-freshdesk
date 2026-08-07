using Trackly.Core.Entities;

namespace Trackly.Modules.Tickets;

public record UserSummaryDto(Guid Id, string? Name, string? Email, string Role, string? AvatarUrl)
{
    /// <param name="withAvatar">
    /// False on customer-facing surfaces that have no session. The avatar path
    /// needs one, so sending it there would render a broken image instead of the
    /// initials fallback — worse than no photo.
    /// </param>
    public static UserSummaryDto? From(User? user, bool withAvatar = true) =>
        user is null
            ? null
            : new UserSummaryDto(
                user.Id, user.Name, user.Email, user.Role,
                withAvatar ? UserAvatar.UrlFor(user) : null);
}

public record CategoryDto(Guid Id, string Name, string? Color)
{
    public static CategoryDto? From(Category? category) =>
        category is null ? null : new CategoryDto(category.Id, category.Name, category.Color);
}

public record TagDto(Guid Id, string Name, string? Color);

public record TicketSummaryDto(
    Guid Id,
    string Subject,
    string Status,
    string Priority,
    string Channel,
    CategoryDto? Category,
    UserSummaryDto? Requester,
    string? GuestName,
    string? GuestEmail,
    UserSummaryDto? Assignee,
    int CommentCount,
    IReadOnlyList<TagDto> Tags,
    DateTime? FirstResponseDueAt,
    DateTime? ResolveDueAt,
    DateTime? FirstResponseAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record WatcherDto(UserSummaryDto Agent, DateTime AddedAt);

public record TicketDetailDto(
    Guid Id,
    string Subject,
    string Description,
    string Status,
    string Priority,
    string Channel,
    CategoryDto? Category,
    UserSummaryDto? Requester,
    string? GuestName,
    string? GuestEmail,
    UserSummaryDto? Assignee,
    IReadOnlyList<WatcherDto> Watchers,
    IReadOnlyList<TagDto> Tags,
    Guid? ProblemId,
    Guid? TeamId,
    string? TeamName,
    DateTime? FirstResponseDueAt,
    DateTime? ResolveDueAt,
    DateTime? FirstResponseAt,
    // Agent-facing only. Never projected onto a guest or customer surface —
    // this is engineering detail, on the same footing as a private note.
    string? ResolutionNote,
    string? ResolutionLink,
    UserSummaryDto? ResolvedBy,
    DateTime? ResolvedAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Work elsewhere that this ticket is about. Agent-facing.</summary>
public record TicketLinkDto(
    Guid Id,
    string Url,
    string? Title,
    string Kind,
    UserSummaryDto? CreatedBy,
    DateTime CreatedAt);

public record AddTicketLinkRequest(string Url, string? Title, string? Kind);

/// <summary>One sitting of work on a ticket.</summary>
public record TimeEntryDto(
    Guid Id,
    UserSummaryDto User,
    int Minutes,
    string? Note,
    DateTime SpentAt,
    DateTime CreatedAt);

public record LogTimeRequest(int Minutes, string? Note, DateTime? SpentAt);

public record CommentDto(
    Guid Id,
    UserSummaryDto? Author,
    string? GuestEmail,
    string Body,
    /// <summary>
    /// "text" or "html". The client MUST branch on this rather than sniffing the
    /// body: rendering plain text as markup turns a customer's "&lt;3" into a
    /// broken tag, and rendering markup as text shows them the tags.
    /// </summary>
    string BodyFormat,
    bool IsInternal,
    /// <summary>
    /// "public", "internal" or "private". `IsInternal` stays as the coarse
    /// customer-facing flag every existing filter tests; this is the finer one
    /// the agent UI styles by.
    /// </summary>
    string Visibility,
    string Source,
    IReadOnlyList<AttachmentDto> Attachments,
    DateTime CreatedAt);

public record AttachmentDto(
    Guid Id,
    Guid? CommentId,
    string FileName,
    string ContentType,
    long SizeBytes,
    DateTime CreatedAt);

// CategoryName, Channel and Tags are free text that the server resolves — an
// existing row is reused, a genuinely new value is created. They are honoured
// for agents and admins ONLY: POST /api/tickets is open to customers via the
// portal, and letting a customer's payload mint workspace categories and tags
// would hand tenant taxonomy to whoever can open a ticket.
//
// CategoryId stays for callers that already hold one (the portal picker). When
// both are sent the id wins, since it is the unambiguous one.
public record CreateTicketRequest(
    string Subject,
    string Description,
    Guid? CategoryId,
    string? Priority,
    string? CategoryName = null,
    string? Channel = null,
    List<string>? Tags = null,
    Guid? TeamId = null,
    // Files the ticket on someone else's behalf — the agent logging a phone
    // call. Agent/admin only, and the id must belong to the same workspace, or
    // this is a way to attach a ticket to any user in the system.
    Guid? RequesterId = null);

public record UpdateTicketRequest(
    string? Subject,
    string? Status,
    string? Priority,
    Guid? CategoryId,
    bool ClearCategory = false,
    Guid? AssigneeId = null,
    bool Unassign = false,
    Guid? TeamId = null,
    bool ClearTeam = false,
    // Re-points the ticket at a real customer — the usual case is a guest
    // submission or a logged call an agent has now matched to a person.
    Guid? RequesterId = null,
    // Detaches the customer without putting another in their place: the ticket
    // was linked to the wrong person and the right one isn't known yet.
    bool ClearRequester = false,

    // ── Resolving ───────────────────────────────────────────────────────────
    // Required when Status moves out of open/pending into resolved or closed.
    // Rejected server-side, not just hidden behind a dialog: a rule that only
    // lives in the UI is not a rule, and this one exists so that six months
    // later "why was this closed?" has an answer.
    string? ResolutionNote = null,
    /// <summary>Work item, PR or user story it was fixed under. Optional.</summary>
    string? ResolutionLink = null,
    // Logged in the same request as the resolution rather than by a second call,
    // so a ticket can never end up resolved with its time entry lost in between.
    int? TimeSpentMinutes = null);

/// <param name="BodyFormat">
/// "html" for the rich composer, anything else (including absent) for plain
/// text. HTML is sanitised server-side against a small allowlist before it is
/// stored — the composer is the convenience, never the control.
/// </param>
/// <param name="Visibility">
/// "public", "internal" or "private". Absent falls back to
/// <paramref name="IsInternal"/>, so a client deployed before this field still
/// works. A customer's comment is forced public whatever this says.
/// </param>
public record CreateCommentRequest(
    string Body,
    bool IsInternal,
    string? BodyFormat = null,
    string? Visibility = null);

/// <summary>
/// Everything the list can be narrowed by.
///
/// The multi-value fields are lists so the facet rail can express "open OR
/// pending" — which is the whole point of facets, and something a single value
/// per field cannot say. `?status=open` still binds to a one-element list, so
/// every caller written before this keeps working unchanged.
/// </summary>
public record TicketListQuery(
    List<string>? Status,
    List<string>? Priority,
    List<Guid>? AssigneeId,
    string? Search,
    List<string>? Tag,
    List<Guid>? TeamId,
    List<string>? Channel,
    List<Guid>? CategoryId,
    // Every ticket raised by one customer — the customer profile's history.
    // Agent/admin only, like the other cross-workspace filters: a customer
    // reading someone else's id here would be reading their tickets.
    Guid? RequesterId,
    /// <summary>
    /// Nobody is on it. Its own flag because "no assignee" cannot be expressed
    /// as an id, and it is the single most-used queue view there is.
    /// </summary>
    bool Unassigned = false,
    // Tickets where the caller was named in a comment, and tickets they watch.
    // Both are about the CALLER, never about an id they pass — asking "whose
    // mentions?" would be asking to read someone else's inbox.
    bool Mentioned = false,
    bool Watching = false,
    /// <summary>One of <see cref="TicketSort"/>. Anything else falls back to Updated.</summary>
    string? Sort = null,
    bool Desc = true,
    int Page = 1,
    int PageSize = 25);

public static class TicketSort
{
    public const string Updated = "updated";
    public const string Created = "created";
    public const string Priority = "priority";
    public const string Status = "status";
    public const string Subject = "subject";
    /// <summary>The resolve deadline. Nulls last in both directions — see the service.</summary>
    public const string Due = "due";

    public static readonly string[] All = [Updated, Created, Priority, Status, Subject, Due];
}

/// <summary>One value of one field, with how many tickets currently carry it.</summary>
public record FacetBucket(string Value, string Label, int Count);

/// <summary>
/// The counts behind the filter rail.
///
/// Each group is counted with every filter applied **except its own**. That is
/// what makes a facet usable: with its own filter included, picking "Open" would
/// leave the status group reading "Open 42" and every other status at zero, so
/// there would be no way to see what else is there — or to widen the selection
/// to include it.
/// </summary>
public record TicketFacetsDto(
    IReadOnlyList<FacetBucket> Status,
    IReadOnlyList<FacetBucket> Priority,
    IReadOnlyList<FacetBucket> Channel,
    IReadOnlyList<FacetBucket> Team,
    IReadOnlyList<FacetBucket> Category,
    IReadOnlyList<FacetBucket> Assignee,
    IReadOnlyList<FacetBucket> Tag);
