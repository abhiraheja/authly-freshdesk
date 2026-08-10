using System.Text.Json.Serialization;

namespace Trackly.Modules.Widgets;

/// <summary>
/// Everything the loader and the panel need before a visitor has done anything.
/// Anonymous and cacheable, so it carries no visitor state and no secret.
/// </summary>
public record WidgetPublicConfigDto(
    string Token,
    string Name,
    string? Tagline,
    string? Greeting,

    // Branding: the widget's colour if it has one, else the workspace's
    // (invariant 6, plan § 4.2). Always light — there is no theme here on
    // purpose.
    string WorkspaceName,
    string PrimaryColor,
    string? LogoUrl,
    bool HidePoweredBy,

    bool HideLauncher,
    bool LaunchWidget,
    bool ShowWidgetForm,
    bool ShowCloseButton,
    bool ShowSendButton,

    /// <summary>The host page must supply a signed JWT for identity to count.</summary>
    bool IdentityVerificationEnabled,
    /// <summary>A visitor must confirm an emailed code before raising a conversation.</summary>
    bool RequireEmailVerification);

/// <summary>
/// What the host page claims about the visitor, plus the proof when there is
/// any.
///
/// <para>
/// Field names mirror the snippet's own spelling so the loader can forward its
/// config object without translating it. <c>unique_id</c> needs
/// <see cref="JsonPropertyNameAttribute"/> to do that — the serializer's default
/// camelCase would look for <c>uniqueId</c> and bind nothing, which fails
/// silently: an unmatched claim reads as "the page named nobody" rather than as
/// an error, so a mismatched signature would go unnoticed. <c>uniqueId</c> is
/// accepted too, for anyone calling this API by hand.
/// </para>
/// </summary>
public record WidgetIdentityRequest(
    [property: JsonPropertyName("unique_id")] string? UniqueId = null,
    string? Name = null,
    string? Mail = null,
    string? Number = null,
    Dictionary<string, string>? Variables = null,
    /// <summary>JWT signed with the widget's secret key. The only thing that proves anything.</summary>
    string? Token = null)
{
    /// <summary>The camelCase alias. Never read directly — <see cref="Identifier"/> is.</summary>
    [JsonPropertyName("uniqueId")]
    public string? UniqueIdAlias { get; init; }

    [JsonIgnore]
    public string? Identifier => string.IsNullOrWhiteSpace(UniqueId) ? UniqueIdAlias : UniqueId;
}

/// <summary>
/// The visitor as the panel should render them.
///
/// <para>
/// <see cref="VisitorToken"/> is present only on the response that mints it —
/// the frame stores it and sends it back in the <c>X-Trackly-Visitor</c> header
/// from then on. Only its SHA-256 hash is stored (invariant 4).
/// </para>
/// </summary>
public record WidgetSessionDto(
    string? VisitorToken,
    Guid VisitorId,
    bool IsVerified,
    string? Name,
    string? Email,
    string? Phone,
    string? ExternalId,
    /// <summary>
    /// The details form is shown when the widget asks for it and the host page
    /// did not identify the visitor. Re-asked per conversation (plan § 8.1), so
    /// this is advice for the first view, not a latch.
    /// </summary>
    bool ShowDetailsForm,
    /// <summary>
    /// Why an identity payload was not honoured, when one was supplied and
    /// rejected. Null when nothing was claimed or the claim was accepted — the
    /// panel stays usable either way, the visitor is simply not verified.
    /// </summary>
    string? IdentityError);

public record WidgetVerifyEmailRequest(string Email);
public record WidgetConfirmEmailRequest(string Email, string Code);

public record CreateWidgetConversationRequest(
    string Message,
    string? Subject = null,
    Guid? CategoryId = null);

public record WidgetConversationCreatedDto(
    Guid Id,
    string Reference,
    string Subject,
    string Status,
    DateTime CreatedAt);

/// <summary>
/// One row of the panel's home list (plan § 8.1, "Continue Conversations").
/// </summary>
public record WidgetConversationDto(
    Guid Id,
    string Reference,
    string Subject,
    string Status,
    /// <summary>
    /// The bucket the client branches on. <see cref="Status"/> is workspace
    /// vocabulary — a panel that switched on it would break the day an admin
    /// renamed one.
    /// </summary>
    string StatusCategory,
    /// <summary>Who wrote the last public message, for the `{sender}: {message}` line.</summary>
    string? LastSenderName,
    bool LastFromAgent,
    /// <summary>Plain text, truncated. HTML bodies are flattened — the row is one line.</summary>
    string Preview,
    /// <summary>
    /// Agent messages since this <i>visitor</i> last opened the thread. Derived,
    /// never stored.
    /// </summary>
    int UnreadCount,
    DateTime CreatedAt,
    DateTime LastMessageAt);

/// <summary>
/// A message in the panel's thread. Not <c>CommentDto</c>: that record carries
/// <c>IsInternal</c> and <c>Visibility</c>, and a customer-facing surface should
/// not be able to report a private note's existence even by echoing its label
/// back (invariant 5). The shape here has nowhere to put one.
/// </summary>
public record WidgetMessageDto(
    Guid Id,
    bool FromAgent,
    /// <summary>The agent's name, or the visitor's own. Never an email address.</summary>
    string? AuthorName,
    string Body,
    /// <summary>"text" or "html" — the client must branch, never sniff.</summary>
    string BodyFormat,
    IReadOnlyList<Trackly.Modules.Tickets.AttachmentDto> Attachments,
    DateTime CreatedAt);

public record WidgetThreadDto(
    Guid Id,
    string Reference,
    string Subject,
    string Status,
    string StatusCategory,
    /// <summary>The assigned agent, for the thread header's title block.</summary>
    string? AgentName,
    IReadOnlyList<WidgetMessageDto> Messages,
    int UnreadCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record WidgetReplyRequest(string Message);

