namespace Trackly.Core.Interfaces;

/// <summary>
/// Plain OAuth 2.0 authorization-code + PKCE, followed by a userinfo call.
///
/// This exists because not every "sign in with X" button is OIDC. Facebook is
/// the case in hand: its web flow returns an access token and no id_token, so
/// there is no signed assertion to validate — identity comes from calling the
/// provider's userinfo endpoint over TLS with that token. Weaker than OIDC, and
/// the reason a provider only lands here when it leaves us no choice.
/// </summary>
public interface IOAuth2Client
{
    /// No network call — an OAuth 2.0 provider has no discovery document, so the
    /// endpoints come from the catalogue.
    string BuildAuthorizeUrl(OAuth2ClientConfig config, string redirectUri, string state, string codeChallenge);

    Task<OidcUserInfo> ExchangeCodeAsync(
        OAuth2ClientConfig config, string redirectUri, string code, string codeVerifier,
        CancellationToken cancellationToken = default);
}

public record OAuth2ClientConfig(
    string AuthorizeEndpoint,
    string TokenEndpoint,
    string UserInfoEndpoint,
    string ClientId,
    string? ClientSecret,
    string Scopes);
