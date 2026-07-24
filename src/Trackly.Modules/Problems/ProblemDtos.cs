using Trackly.Modules.Tickets;

namespace Trackly.Modules.Problems;

public record ProblemSummaryDto(
    Guid Id,
    string Title,
    string Status,
    UserSummaryDto? Assignee,
    int TicketCount,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime? ResolvedAt);

public record ProblemDetailDto(
    Guid Id,
    string Title,
    string? Description,
    string Status,
    UserSummaryDto? Assignee,
    UserSummaryDto? CreatedBy,
    IReadOnlyList<TicketSummaryDto> Tickets,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime? ResolvedAt);

public record CreateProblemRequest(string Title, string? Description, Guid? AssigneeId);

public record UpdateProblemRequest(
    string? Title,
    string? Description,
    string? Status,
    Guid? AssigneeId,
    bool Unassign = false);

public record LinkTicketRequest(Guid TicketId);

public record ResolveProblemRequest(bool BulkResolveTickets = true);
