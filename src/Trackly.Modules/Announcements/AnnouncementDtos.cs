namespace Trackly.Modules.Announcements;

public record AnnouncementSummaryDto(
    Guid Id,
    string Type,
    string Subject,
    Guid? ProblemId,
    DateTime? ScheduledAt,
    DateTime? SentAt,
    int RecipientCount,
    int SuccessCount,
    int FailureCount,
    DateTime CreatedAt);

public record AnnouncementDetailDto(
    Guid Id,
    string Type,
    string Subject,
    string Body,
    Guid? ProblemId,
    DateTime? ScheduledAt,
    DateTime? SentAt,
    int RecipientCount,
    int SuccessCount,
    int FailureCount,
    DateTime CreatedAt);

public record CreateAnnouncementRequest(
    string Type,
    string Subject,
    string Body,
    Guid? ProblemId,
    DateTime? ScheduledAt);
