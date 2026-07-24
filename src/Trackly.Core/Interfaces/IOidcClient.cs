namespace Trackly.Core.Interfaces;

// Generic OIDC authorization-code + PKCE client. One instance serves every
// workspace; the per-workspace config is passed in per call, so there is no
// startup-time scheme registration (see the plan's OIDC caveat).
public interface IOidcClient
{
    // Reads the discovery document and returns the full authorize URL to redirect to.
    Task<string> BuildAuthorizeUrlAsync(
        OidcClientConfig config, string redirectUri, string state, string nonce, string codeChallenge,
        CancellationToken cancellationToken = default);

    // Exchanges the code at the token endpoint and validates the returned id_token
    // (issuer, audience=client_id, signature via JWKS, lifetime, nonce). Returns the
    // authenticated user's claims.
    Task<OidcUserInfo> ExchangeCodeAsync(
        OidcClientConfig config, string redirectUri, string code, string codeVerifier, string expectedNonce,
        CancellationToken cancellationToken = default);
}

public record OidcClientConfig(string DiscoveryEndpoint, string ClientId, string? ClientSecret);

public record OidcUserInfo(string Subject, string? Email, string? Name, IReadOnlyList<string> Groups);
