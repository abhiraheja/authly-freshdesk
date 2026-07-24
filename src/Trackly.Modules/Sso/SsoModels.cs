using Trackly.Core.Entities;

namespace Trackly.Modules.Sso;

public record SsoStartResult(bool Ok, string? AuthorizeUrl, string? Error)
{
    public static SsoStartResult NotConfigured => new(false, null, "SSO is not configured for this workspace.");
    public static SsoStartResult Redirect(string url) => new(true, url, null);
    public static SsoStartResult Fail(string error) => new(false, null, error);
}

public record SsoCallbackResult(bool Ok, User? User, string? SessionToken, string? Error)
{
    public static SsoCallbackResult Fail(string error) => new(false, null, null, error);
    public static SsoCallbackResult Success(User user, string sessionToken) => new(true, user, sessionToken, null);
}
