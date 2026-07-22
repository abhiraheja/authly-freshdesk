using Trackly.Modules.Tickets;

namespace Trackly.Modules.Guest;

public enum GuestOtpStatus { Sent, RateLimited, WorkspaceNotFound }

public record GuestOtpVerifyResult(bool Success, bool Locked, string? SubmissionToken);

public record CreateGuestTicketRequest(
    string SubmissionToken,
    string Name,
    string Subject,
    string Description,
    Guid? CategoryId);

public record GuestTicketCreated(Guid TicketId, string Reference, string GuestToken);

public record GuestTicketView(
    Guid Id,
    string Reference,
    string Subject,
    string Description,
    string Status,
    CategoryDto? Category,
    string GuestName,
    string GuestEmail,
    IReadOnlyList<CommentDto> Comments,
    IReadOnlyList<AttachmentDto> TicketAttachments,
    DateTime CreatedAt,
    DateTime UpdatedAt);
