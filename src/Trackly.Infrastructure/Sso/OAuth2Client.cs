using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Sso;

/// <summary>
/// OAuth 2.0 authorization-code + PKCE with a userinfo lookup — the fallback for
/// providers that never issue an id_token on the web (today: Facebook).
///
/// There is no signature to check here, because there is no signed token. What
/// makes the result trustworthy is that the access token is exchanged over TLS
/// directly with the provider and immediately spent against the provider's own
/// userinfo endpoint; nothing the browser handed us is believed.
/// </summary>
public class OAuth2Client(IHttpClientFactory httpClientFactory) : IOAuth2Client
{
    public string BuildAuthorizeUrl(OAuth2ClientConfig config, string redirectUri, string state, string codeChallenge)
    {
        var query = new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = config.ClientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = config.Scopes,
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
        };
        return AppendQuery(config.AuthorizeEndpoint, query);
    }

    public async Task<OidcUserInfo> ExchangeCodeAsync(
        OAuth2ClientConfig config, string redirectUri, string code, string codeVerifier,
        CancellationToken cancellationToken = default)
    {
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["client_id"] = config.ClientId,
            ["code_verifier"] = codeVerifier,
        };
        if (!string.IsNullOrEmpty(config.ClientSecret))
            form["client_secret"] = config.ClientSecret;

        var http = httpClientFactory.CreateClient("oidc");

        // POST rather than the GET Facebook's docs show: a client secret in a
        // query string ends up in every proxy and access log between here and
        // Menlo Park. Graph accepts the form-encoded POST.
        using var response = await http.PostAsync(
            config.TokenEndpoint, new FormUrlEncodedContent(form), cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"OAuth2 token exchange failed ({(int)response.StatusCode}): {body}");
        }

        var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: cancellationToken)
                    ?? throw new InvalidOperationException("OAuth2 token endpoint returned no body.");
        if (string.IsNullOrEmpty(token.AccessToken))
            throw new InvalidOperationException("OAuth2 token response had no access_token.");

        using var request = new HttpRequestMessage(HttpMethod.Get, config.UserInfoEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        using var profileResponse = await http.SendAsync(request, cancellationToken);
        if (!profileResponse.IsSuccessStatusCode)
        {
            var body = await profileResponse.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"OAuth2 userinfo failed ({(int)profileResponse.StatusCode}): {body}");
        }

        using var profile = JsonDocument.Parse(
            await profileResponse.Content.ReadAsStringAsync(cancellationToken));
        var root = profile.RootElement;

        // `sub` is the OIDC spelling, `id` the Graph one — read either.
        var subject = Read(root, "sub") ?? Read(root, "id")
            ?? throw new InvalidOperationException("OAuth2 userinfo returned no subject.");
        var email = Read(root, "email");
        var name = Read(root, "name") ?? Join(Read(root, "first_name"), Read(root, "last_name"));

        // No groups: a consumer login has none, which is why the catalogue does
        // not offer group→role mapping for these providers.
        return new OidcUserInfo(subject, email, name, []);
    }

    private static string? Read(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? Join(string? a, string? b)
    {
        var joined = string.Join(' ', new[] { a, b }.Where(s => !string.IsNullOrWhiteSpace(s)));
        return joined.Length == 0 ? null : joined;
    }

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
    }
}
