namespace Trackly.Core.Entities;

/// <summary>
/// Server-side correlation for an in-flight "Connect Google" handshake — exactly
/// <see cref="SsoLoginState"/>'s job for a mail account rather than a person.
///
/// The `state` is echoed by the provider and is what makes the callback
/// trustworthy without a session cookie: the browser arrives from the provider's
/// domain, so a cookie-authenticated callback would be a cross-site request some
/// providers strip. Single-use, and consumed even when the exchange that follows
/// fails, so a replayed callback URL cannot mint a second grant.
///
/// The PKCE `code_verifier` must survive the redirect and must never reach the
/// browser, which is why this is a table and not a cookie.
/// </summary>
public class EmailOAuthState
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>See <see cref="EmailProviderKind"/>.</summary>
    public string Provider { get; set; } = null!;

    public string State { get; set; } = null!;
    public string CodeVerifier { get; set; } = null!;

    /// <summary>Where to send the admin back to once the grant lands.</summary>
    public string? ReturnUrl { get; set; }

    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
