namespace Trackly.Modules.Widgets;

/// <summary>
/// The origins a snippet is written against. Passed in rather than read from
/// configuration inside the service, because the fallback when
/// <c>App:ApiBaseUrl</c> is unset is the current request's own scheme and host —
/// something only the controller can see.
/// </summary>
public record WidgetOrigins(string Api, string Frontend);

public record WidgetSummaryDto(
    Guid Id,
    string Name,
    string? Tagline,
    string PublicToken,
    bool IsActive,
    bool IdentityVerificationEnabled,
    string? PrimaryColor,
    Guid? TeamId,
    string? TeamName,
    // Derived from widget_visitors, not stored: a "last used" column would mean
    // a write on every public config read, which is the hottest path there is.
    DateTime? LastUsedAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record WidgetDetailDto(
    Guid Id,
    string Name,
    string? Tagline,
    string? Greeting,
    string PublicToken,
    bool IsActive,

    // Identity verification. SecretKeyMasked is all anyone ever sees after the
    // create/regenerate response that carried the plaintext once.
    bool IdentityVerificationEnabled,
    bool HasSecretKey,
    string? SecretKeyMasked,

    string? PrimaryColor,
    Guid? TeamId,
    string? TeamName,

    bool HideLauncher,
    bool LaunchWidget,
    bool ShowWidgetForm,
    bool ShowCloseButton,
    bool ShowSendButton,

    bool RequireEmailVerification,
    IReadOnlyList<string> AllowedOrigins,

    string EmbedType,
    System.Text.Json.JsonElement Fields,
    string Theme,

    string Snippet,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>
/// A create/regenerate response. <see cref="SecretKey"/> is the only time the
/// plaintext exists outside the database — there is no endpoint that reads it
/// back, so an admin who loses it regenerates.
/// </summary>
public record WidgetSecretDto(WidgetDetailDto Widget, string SecretKey);

/// <summary>
/// Create and update share a shape. Every field is optional on update; null
/// means "leave it alone" for the nullable ones and the existing value for the
/// rest, so a partial save from one tab cannot blank the other tab's fields.
/// </summary>
public record SaveWidgetRequest(
    string? Name = null,
    string? Tagline = null,
    string? Greeting = null,
    bool? IsActive = null,
    bool? IdentityVerificationEnabled = null,
    string? PrimaryColor = null,
    Guid? TeamId = null,
    bool? HideLauncher = null,
    bool? LaunchWidget = null,
    bool? ShowWidgetForm = null,
    bool? ShowCloseButton = null,
    bool? ShowSendButton = null,
    bool? RequireEmailVerification = null,
    IReadOnlyList<string>? AllowedOrigins = null,
    string? EmbedType = null,
    System.Text.Json.JsonElement? Fields = null,
    string? Theme = null,
    // Explicit clears, because null already means "unchanged" above.
    bool ClearTeam = false,
    bool ClearPrimaryColor = false);

public record VerifyJwtRequest(string Token);

/// <summary>
/// The Configuration tab's "Verify JWT" debug tool. It answers the one question
/// an integrator actually has — <i>would Trackly accept this token, and who does
/// it say the visitor is?</i> — so <see cref="Error"/> carries the real reason a
/// token was rejected rather than a generic failure.
/// </summary>
public record VerifyJwtResultDto(
    bool Valid,
    string? Error,
    string? UniqueId,
    DateTime? IssuedAt,
    DateTime? ExpiresAt,
    IReadOnlyDictionary<string, string> Claims);
