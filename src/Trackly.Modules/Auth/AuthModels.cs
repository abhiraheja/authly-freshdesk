using Trackly.Core.Entities;

namespace Trackly.Modules.Auth;

public record SendMagicLinkRequest(string Email, string? WorkspaceSlug);

public enum SendMagicLinkStatus { Sent, RateLimited, WorkspaceNotFound, EmailLoginDisabled }

public record VerifyMagicLinkRequest(
    string? Token,          // magic-link path
    string? Email,          // + Code: typed-code path
    string? Code,
    string? WorkspaceSlug); // optional: this installation has one workspace

public enum VerifyStatus
{
    Success,
    InvalidToken,       // unknown/expired/consumed token, or wrong code
    Locked,             // 5 failed code attempts
    EmailLoginDisabled,
    UserInactive,
    NotSetUp,           // no workspace exists yet — first-run setup hasn't run
}

public record VerifyResult(
    VerifyStatus Status,
    User? User = null,
    string? SessionToken = null,
    string? Email = null);
