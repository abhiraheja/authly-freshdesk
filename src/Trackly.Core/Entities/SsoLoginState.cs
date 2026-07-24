namespace Trackly.Core.Entities;

// Server-side correlation for an in-flight SSO login. The `state` is echoed by
// the IdP; the nonce and PKCE code_verifier must survive the redirect but must
// never reach the browser, so they live here — single-use and short-lived — not
// in a cookie. Consumed on callback.
public class SsoLoginState
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ConnectionId { get; set; }
    public string State { get; set; } = null!;
    public string Nonce { get; set; } = null!;
    public string CodeVerifier { get; set; } = null!;
    public string? ReturnUrl { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
