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
    bool IsInternal,
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

public record CreateCommentRequest(string Body, bool IsInternal);

public record TicketListQuery(
    string? Status,
    string? Priority,
    Guid? AssigneeId,
    string? Search,
    string? Tag,
    Guid? TeamId,
    // Every ticket raised by one customer — the customer profile's history.
    // Agent/admin only, like the other cross-workspace filters: a customer
    // reading someone else's id here would be reading their tickets.
    Guid? RequesterId,
    int Page = 1,
    int PageSize = 25);
