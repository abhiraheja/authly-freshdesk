using Trackly.Core.Entities;

namespace Trackly.Modules.Auth;

public record SendMagicLinkRequest(string Email, string? WorkspaceSlug);

public enum SendMagicLinkStatus { Sent, RateLimited, WorkspaceNotFound, EmailLoginDisabled }

public record VerifyMagicLinkRequest(
    string? Token,          // magic-link path
    string? Email,          // + Code: typed-code path
    string? Code,
    string? WorkspaceSlug); // disambiguates when the email belongs to several workspaces

public enum VerifyStatus
{
    Success,
    InvalidToken,       // unknown/expired/consumed token, or wrong code
    Locked,             // 5 failed code attempts
    EmailLoginDisabled,
    UserInactive,
    SignupRequired,     // email verified but no account anywhere → onboarding step 2
    ChooseWorkspace,    // email exists in several workspaces → caller re-verifies with a slug
}

public record VerifyResult(
    VerifyStatus Status,
    User? User = null,
    string? SessionToken = null,
    string? Email = null,
    IReadOnlyList<WorkspaceSummary>? Workspaces = null);

public record WorkspaceSummary(string Slug, string Name);

public record SignupRequest(
    string Email,
    string? Token,
    string? Code,
    string WorkspaceName,
    string WorkspaceSlug,
    string? Name);

public enum SignupStatus { Success, InvalidToken, Locked, SlugTaken, InvalidSlug }

public record SignupResult(
    SignupStatus Status,
    User? User = null,
    string? SessionToken = null);
