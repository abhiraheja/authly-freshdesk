using Trackly.Core.Entities;

namespace Trackly.Modules.Tickets;

public record UserSummaryDto(Guid Id, string? Name, string? Email, string Role)
{
    public static UserSummaryDto? From(User? user) =>
        user is null ? null : new UserSummaryDto(user.Id, user.Name, user.Email, user.Role);
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
    DateTime CreatedAt,
    DateTime UpdatedAt);

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
    List<string>? Tags = null);

public record UpdateTicketRequest(
    string? Subject,
    string? Status,
    string? Priority,
    Guid? CategoryId,
    bool ClearCategory = false,
    Guid? AssigneeId = null,
    bool Unassign = false,
    Guid? TeamId = null,
    bool ClearTeam = false);

public record CreateCommentRequest(string Body, bool IsInternal);

public record TicketListQuery(
    string? Status,
    string? Priority,
    Guid? AssigneeId,
    string? Search,
    string? Tag,
    Guid? TeamId,
    int Page = 1,
    int PageSize = 25);
