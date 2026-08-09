using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

/// <summary>
/// Authorization-code + PKCE against whichever mail provider the catalogue
/// describes, and the refresh that keeps the resulting credential alive.
///
/// One implementation for Google, Microsoft and Yahoo alike: they differ in their
/// endpoints and their scopes, both of which live in the catalogue, and not in
/// the protocol. The one real difference — Google needing
/// `access_type=offline&amp;prompt=consent` before it will part with a refresh
/// token — is a flag on the descriptor rather than a branch here.
/// </summary>
public class EmailOAuthClient(IHttpClientFactory httpClientFactory, ILogger<EmailOAuthClient> logger)
    : IEmailOAuthClient
{
    public string BuildAuthorizeUrl(EmailOAuthApp app, string redirectUri, string state, string codeChallenge)
    {
        var query = new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = app.ClientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = app.Provider.Scopes,
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
        };

        if (app.Provider.OfflineConsent)
        {
            // `prompt=consent` as well as `access_type=offline`: Google issues a
            // refresh token on the *first* consent only, so an admin reconnecting
            // an account they linked before would otherwise get an access token
            // that dies in an hour and nothing to renew it with — and the failure
            // surfaces later, in a background poll, as an expired credential.
            query["access_type"] = "offline";
            query["prompt"] = "consent";
        }

        return AppendQuery(app.AuthorizeEndpoint!, query);
    }

    public Task<OAuthTokens> ExchangeCodeAsync(
        EmailOAuthApp app, string redirectUri, string code, string codeVerifier,
        CancellationToken cancellationToken = default)
        => PostTokenAsync(app, new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["code_verifier"] = codeVerifier,
        }, cancellationToken);

    public Task<OAuthTokens> RefreshAsync(
        EmailOAuthApp app, string refreshToken, CancellationToken cancellationToken = default)
        => PostTokenAsync(app, new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, cancellationToken);

    public async Task RevokeAsync(
        EmailOAuthApp app, string refreshToken, CancellationToken cancellationToken = default)
    {
        if (app.Provider.RevokeEndpoint is not { Length: > 0 } endpoint) return;

        var form = new Dictionary<string, string>
        {
            ["token"] = refreshToken,
            ["client_id"] = app.ClientId,
        };
        if (!string.IsNullOrEmpty(app.ClientSecret)) form["client_secret"] = app.ClientSecret;

        try
        {
            var http = httpClientFactory.CreateClient("oidc");
            using var response = await http.PostAsync(
                endpoint, new FormUrlEncodedContent(form), cancellationToken);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning(
                    "Revoking the {Provider} mail grant returned {Status}",
                    app.Provider.Provider, (int)response.StatusCode);
        }
        catch (Exception ex)
        {
            // Swallowed on purpose. Disconnect's job is to stop Trackly holding
            // the credential, and it has to succeed even when the provider is
            // unreachable — otherwise an admin cannot remove a connection at the
            // exact moment something is wrong with it.
            logger.LogWarning(ex, "Revoking the {Provider} mail grant failed", app.Provider.Provider);
        }
    }

    // ---- The one request both grants make -----------------------------------

    private async Task<OAuthTokens> PostTokenAsync(
        EmailOAuthApp app, Dictionary<string, string> form, CancellationToken cancellationToken)
    {
        form["client_id"] = app.ClientId;
        // Form-encoded POST, never a query string: a client secret in a URL is
        // copied into every proxy and access log on the way.
        if (!string.IsNullOrEmpty(app.ClientSecret)) form["client_secret"] = app.ClientSecret;

        var http = httpClientFactory.CreateClient("oidc");
        using var response = await http.PostAsync(
            app.TokenEndpoint!, new FormUrlEncodedContent(form), cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            // The provider's own message is the useful part — "invalid_grant"
            // tells an admin their refresh token was revoked, which nothing
            // Trackly could write in its place would.
            throw new InvalidOperationException(
                $"{app.Provider.DisplayName} rejected the token request ({(int)response.StatusCode}): {Summarise(body)}");
        }

        var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: cancellationToken)
                    ?? throw new InvalidOperationException($"{app.Provider.DisplayName} returned an empty token response.");
        if (string.IsNullOrEmpty(token.AccessToken))
            throw new InvalidOperationException($"{app.Provider.DisplayName} returned no access token.");

        return new OAuthTokens(
            token.AccessToken,
            token.RefreshToken,
            // A minute short of the provider's own figure, so a token that is
            // about to expire is never handed to a connection that then takes
            // three seconds to open.
            DateTime.UtcNow.AddSeconds(Math.Max(60, token.ExpiresIn) - 60),
            token.Scope,
            EmailFromIdToken(token.IdToken));
    }

    /// <summary>
    /// The address out of the id_token, used only to label the card.
    ///
    /// **Unverified, and that is safe here for one specific reason:** this JWT
    /// came back on the response to a TLS request Trackly made directly to the
    /// provider's token endpoint, not from anything the browser handed over.
    /// There is no path by which an attacker substitutes it. It is never used to
    /// identify a *person* — that is <see cref="IOidcClient"/>'s job, and that
    /// one validates the signature, because there the token does arrive by way of
    /// a redirect.
    ///
    /// Three claims tried in order, because `email` is not the reliable one
    /// everywhere: Entra omits it for a work account whose directory has no mail
    /// attribute set, and hands back `preferred_username` (the UPN, and the same
    /// string XOAUTH2 authenticates as) instead. Trying only `email` is why a
    /// connected M365 card would read "Connected" with no name against it.
    /// </summary>
    private static string? EmailFromIdToken(string? idToken)
    {
        if (idToken is null) return null;
        var parts = idToken.Split('.');
        if (parts.Length < 2) return null;

        try
        {
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var json = JsonDocument.Parse(Convert.FromBase64String(payload));

            foreach (var claim in (string[])["email", "preferred_username", "upn"])
                if (json.RootElement.TryGetProperty(claim, out var value)
                    && value.ValueKind == JsonValueKind.String
                    && value.GetString() is { Length: > 0 } address)
                    return address;

            return null;
        }
        catch
        {
            // A card labelled "Connected" instead of "Connected as x@y" is a
            // cosmetic loss; failing the whole connection over it would not be.
            return null;
        }
    }

    /// Provider error bodies can be a wall of HTML when something is badly wrong.
    private static string Summarise(string body) =>
        body.Length <= 300 ? body : body[..300] + "…";

    private static string AppendQuery(string baseUrl, Dictionary<string, string?> query)
    {
        var pairs = query.Where(kv => !string.IsNullOrEmpty(kv.Value))
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}");
        var separator = baseUrl.Contains('?') ? "&" : "?";
        return baseUrl + separator + string.Join("&", pairs);
    }

    private sealed class TokenResponse
    {
        [JsonPropertyName("access_token")]
        public string? AccessToken { get; set; }

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

        [JsonPropertyName("scope")]
        public string? Scope { get; set; }

        [JsonPropertyName("id_token")]
        public string? IdToken { get; set; }
    }
}
