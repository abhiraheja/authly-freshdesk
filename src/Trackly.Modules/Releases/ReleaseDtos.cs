using Trackly.Modules.Tickets;

namespace Trackly.Modules.Releases;

public record ReleaseSummaryDto(
    Guid Id,
    string Version,
    string? Title,
    string Status,
    DateTime? ScheduledAt,
    UserSummaryDto? ReleaseManager,
    int ComponentCount,
    int ComponentsDone,
    int StepCount,
    int StepsDone,
    int WorkItemCount,
    int WorkItemsTested,
    DateTime? ReleasedAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record ReleaseDetailDto(
    Guid Id,
    string Version,
    string? Title,
    string Status,
    DateTime? ScheduledAt,
    UserSummaryDto? ReleaseManager,
    string? Notes,
    string? RollbackPlan,
    DateTime? StartedAt,
    DateTime? ReleasedAt,
    UserSummaryDto? CreatedBy,
    IReadOnlyList<ReleaseComponentDto> Components,
    // Work items with no component — release-wide, and rendered last.
    IReadOnlyList<ReleaseWorkItemDto> LooseWorkItems,
    IReadOnlyList<ReleaseActivityDto> Activity,
    ReleaseReadinessDto Readiness,
    // Linked Trackly tickets still open. The number the "resolve them too?"
    // question needs — "are you sure?" without a count is a question nobody can
    // actually answer.
    int OpenTicketCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record ReleaseComponentDto(
    Guid Id,
    Guid? ServiceId,
    string Name,
    string? BuildVersion,
    string? PipelineUrl,
    UserSummaryDto? Owner,
    int Sequence,
    string Status,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    UserSummaryDto? CompletedBy,
    string? Notes,
    IReadOnlyList<ReleaseStepDto> Steps,
    IReadOnlyList<ReleaseWorkItemDto> WorkItems);

public record ReleaseStepDto(
    Guid Id,
    string Kind,
    string Title,
    string? Body,
    string? TargetEnv,
    string? Url,
    int Sequence,
    string Status,
    UserSummaryDto? DoneBy,
    DateTime? DoneAt,
    string? Result);

public record ReleaseWorkItemDto(
    Guid Id,
    Guid? ComponentId,
    string? ExternalKey,
    // Where to actually click. Either the explicit URL or the workspace's
    // template with the key substituted — resolved server-side so that every
    // client renders the same link and none of them has to know the template.
    string? Url,
    Guid? TicketId,
    string? TicketSubject,
    string Title,
    string TestStatus,
    UserSummaryDto? TestedBy,
    DateTime? TestedAt,
    string? TestNotes,
    string VerifyStatus,
    UserSummaryDto? VerifiedBy,
    DateTime? VerifiedAt,
    int Sequence);

public record ReleaseActivityDto(
    Guid Id,
    UserSummaryDto? Actor,
    string Action,
    string? Detail,
    DateTime CreatedAt);

/// <summary>
/// Why the release cannot be marked ready yet.
///
/// Codes, not sentences: the API has no idea what language the reader has
/// chosen, and a translated string coming out of the database is a string that
/// can never be translated again.
/// </summary>
public record ReleaseReadinessDto(bool CanMarkReady, IReadOnlyList<ReleaseBlockerDto> Blockers);

public record ReleaseBlockerDto(string Code, int Count);

public static class ReleaseBlocker
{
    public const string NoComponents = "no_components";
    public const string NoRollbackPlan = "no_rollback_plan";
    public const string UntestedItems = "untested_items";
    public const string FailedItems = "failed_items";
}

/// <summary>
/// <paramref name="WorkItemUrlTemplate"/> turns "55335" into a link. Must
/// contain <c>{id}</c>, or it would silently produce the same URL for every task.
/// </summary>
public record ReleaseSettingsDto(string? WorkItemUrlTemplate);

public record CreateReleaseRequest(
    string Version,
    string? Title,
    DateTime? ScheduledAt,
    Guid? ReleaseManagerId,
    string? Notes,
    string? RollbackPlan);

public record UpdateReleaseRequest(
    string? Version,
    string? Title,
    DateTime? ScheduledAt,
    bool ClearSchedule = false,
    Guid? ReleaseManagerId = null,
    bool ClearManager = false,
    string? Notes = null,
    string? RollbackPlan = null);

/// <summary>
/// <paramref name="ResolveTickets"/> only means anything on the move to
/// <c>released</c>: resolve every linked Trackly ticket and let its customer
/// know. Off by default — shipping the fix and telling the person who reported
/// it are two decisions, and only one of them is safe to make silently.
/// </summary>
public record SetReleaseStatusRequest(string Status, bool ResolveTickets = false);

public record AddComponentRequest(
    Guid? ServiceId,
    string? Name,
    string? BuildVersion,
    string? PipelineUrl,
    Guid? OwnerId);

public record UpdateComponentRequest(
    string? Name = null,
    string? BuildVersion = null,
    string? PipelineUrl = null,
    Guid? OwnerId = null,
    bool ClearOwner = false,
    string? Notes = null,
    int? Sequence = null);

public record SetComponentStatusRequest(string Status, string? Notes = null);

public record AddStepRequest(
    string Kind,
    string Title,
    string? Body,
    string? TargetEnv,
    string? Url);

public record UpdateStepRequest(
    string? Kind = null,
    string? Title = null,
    string? Body = null,
    string? TargetEnv = null,
    string? Url = null,
    int? Sequence = null);

/// <summary>
/// <paramref name="Force"/> is the answer to "an earlier step is still pending —
/// tick this one anyway?". The API refuses out-of-order without it and records
/// it in the activity log with it, which is the difference between a rule that
/// gets followed and a rule that gets worked around.
/// </summary>
public record SetStepStatusRequest(string Status, string? Result = null, bool Force = false);

public record AddWorkItemRequest(
    string Title,
    Guid? ComponentId = null,
    string? ExternalKey = null,
    string? ExternalUrl = null,
    Guid? TicketId = null);

public record UpdateWorkItemRequest(
    string? Title = null,
    Guid? ComponentId = null,
    bool ClearComponent = false,
    string? ExternalKey = null,
    string? ExternalUrl = null,
    Guid? TicketId = null,
    bool ClearTicket = false,
    int? Sequence = null);

/// <summary>Pre-deploy, on staging. Gates the release going <c>ready</c>.</summary>
public record SetWorkItemTestRequest(string Status, string? Notes = null);

/// <summary>Post-deploy, on production. Decides whether to roll back.</summary>
public record SetWorkItemVerifyRequest(string Status);

/// <summary>
/// Start the next release from this one. Copies the shape, never the record —
/// see <c>ReleaseService.CloneAsync</c> for exactly what carries over and why.
/// </summary>
public record CloneReleaseRequest(string Version, string? Title = null, DateTime? ScheduledAt = null);

/// <summary>
/// The request was well formed and the answer is "confirm first" — mapped to 409
/// so a client can put the question in front of the person instead of showing a
/// bare error. Same shape as <c>TicketWarningsException</c>, for the same reason.
/// </summary>
public class ReleaseConfirmException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    /// <summary>An earlier step in the same component has not been settled.</summary>
    public const string StepsOutOfOrder = "steps_out_of_order";
}
