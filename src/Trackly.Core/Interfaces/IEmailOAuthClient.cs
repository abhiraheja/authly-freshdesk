using Trackly.Core.Email;

namespace Trackly.Core.Interfaces;

/// <summary>
/// The OAuth 2.0 handshake for a *mail credential*.
///
/// **Deliberately not <see cref="IOidcClient"/> or <see cref="IOAuth2Client"/>.**
/// Those answer "who is this person", validate an assertion and throw the tokens
/// away the moment a session exists. This one answers "give me something I can
/// keep authenticating IMAP and SMTP with next week" — so the refresh token is
/// the point rather than a by-product, and there is no user to sign in.
///
/// Endpoints and scopes come from <see cref="EmailProviderCatalog"/> rather than
/// a second table here: one place where "Google's token URL" is written down is
/// the only way the card, the connect and the refresh can't disagree.
/// </summary>
public interface IEmailOAuthClient
{
    /// No network call — every provider Trackly cards has fixed, published endpoints.
    string BuildAuthorizeUrl(EmailOAuthApp app, string redirectUri, string state, string codeChallenge);

    Task<OAuthTokens> ExchangeCodeAsync(
        EmailOAuthApp app, string redirectUri, string code, string codeVerifier,
        CancellationToken cancellationToken = default);

    Task<OAuthTokens> RefreshAsync(
        EmailOAuthApp app, string refreshToken, CancellationToken cancellationToken = default);

    /// <summary>
    /// Invalidates the grant at the provider. Best-effort by contract: a provider
    /// that publishes no revocation endpoint, or one that is unreachable, must not
    /// stop an admin disconnecting — but leaving a live refresh token behind
    /// because the call was never attempted is a real leak.
    /// </summary>
    Task RevokeAsync(EmailOAuthApp app, string refreshToken, CancellationToken cancellationToken = default);
}

/// <param name="Provider">
/// The catalogue entry, which carries the endpoints and the scopes.
/// </param>
/// <param name="ClientId">The operator's own app registration — not Trackly's.</param>
/// <param name="TenantId">
/// The directory to route a tenant-scoped handshake through; null means `common`.
/// Microsoft only — see <see cref="EmailProviderCatalog.TenantPlaceholder"/>.
/// </param>
public record EmailOAuthApp(
    EmailProviderDescriptor Provider, string ClientId, string? ClientSecret, string? TenantId = null)
{
    /// <summary>
    /// The endpoints to actually call, tenant substituted.
    ///
    /// **Read these rather than <c>Provider.AuthorizeEndpoint</c>.** The
    /// catalogue's copy still holds the placeholder, and a request to a URL with
    /// a literal `{tenant}` in it fails at DNS-adjacent depth with nothing useful
    /// to show an admin.
    /// </summary>
    public string? AuthorizeEndpoint => EmailProviderCatalog.ResolveTenant(Provider.AuthorizeEndpoint, TenantId);

    public string? TokenEndpoint => EmailProviderCatalog.ResolveTenant(Provider.TokenEndpoint, TenantId);
}

/// <param name="RefreshToken">
/// Null on a refresh from a provider that does not rotate them — the caller keeps
/// the one it already holds. Null on an *exchange* means the grant is unusable
/// beyond the first hour, which callers must treat as a failure rather than
/// storing and discovering at the first expiry.
/// </param>
/// <param name="AccountEmail">
/// From the id_token's `email` claim when the provider returned one. It names the
/// mailbox that was actually consented with, which is not necessarily the address
/// the admin typed into the form.
/// </param>
public record OAuthTokens(
    string AccessToken,
    string? RefreshToken,
    DateTime ExpiresAt,
    string? Scope,
    string? AccountEmail);
