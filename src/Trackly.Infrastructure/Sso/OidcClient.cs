using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Sso;

// Manual OIDC client. Discovery documents + JWKS are cached and auto-refreshed
// per issuer by a ConfigurationManager. id_tokens are validated against the
// issuer's published signing keys — Trackly never trusts an unsigned or
// wrong-audience token.
public class OidcClient(IHttpClientFactory httpClientFactory) : IOidcClient
{
    private readonly ConcurrentDictionary<string, ConfigurationManager<OpenIdConnectConfiguration>> _configs = new();

    public async Task<string> BuildAuthorizeUrlAsync(
        OidcClientConfig config, string redirectUri, string state, string nonce, string codeChallenge,
        CancellationToken cancellationToken = default)
    {
        var oidc = await GetConfigurationAsync(config.DiscoveryEndpoint, cancellationToken);

        var query = new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = config.ClientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = string.IsNullOrWhiteSpace(config.Scopes) ? "openid profile email" : config.Scopes,
            ["state"] = state,
            ["nonce"] = nonce,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
        };

        // Provider-specific extras (a tenant hint, today). Added last but never
        // allowed to overwrite a protocol parameter — a bad catalogue entry must
        // not be able to replace the state or the code challenge.
        foreach (var (key, value) in config.ExtraAuthorizeParameters ?? new Dictionary<string, string>())
            if (!query.ContainsKey(key))
                query[key] = value;

        return QueryHelpers(oidc.AuthorizationEndpoint, query);
    }

    public async Task<OidcUserInfo> ExchangeCodeAsync(
        OidcClientConfig config, string redirectUri, string code, string codeVerifier, string expectedNonce,
        CancellationToken cancellationToken = default)
    {
        var oidc = await GetConfigurationAsync(config.DiscoveryEndpoint, cancellationToken);

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
        using var response = await http.PostAsync(oidc.TokenEndpoint, new FormUrlEncodedContent(form), cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"OIDC token exchange failed ({(int)response.StatusCode}): {body}");
        }

        var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: cancellationToken)
                    ?? throw new InvalidOperationException("OIDC token endpoint returned no body.");
        if (string.IsNullOrEmpty(token.IdToken))
            throw new InvalidOperationException("OIDC token response had no id_token.");

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = oidc.Issuer,
            ValidAudience = config.ClientId,
            IssuerSigningKeys = oidc.SigningKeys,
            ValidateIssuerSigningKey = true,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(5),
        };

        // MapInboundClaims = false is load-bearing, not a tidy-up. Left on (the
        // default), JwtSecurityTokenHandler rewrites the OIDC claim names into
        // the legacy WS-* URIs on the way in: `sub` becomes
        // `…/claims/nameidentifier`, `email` and `name` likewise. Every lookup
        // below reads the real name, so `sub` came back null and the check under
        // it threw "id_token has no sub claim" — for every provider, on every
        // login. Off, the claims arrive spelled the way the id_token spells them.
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var principal = handler.ValidateToken(token.IdToken, parameters, out _);

        var nonce = principal.FindFirst("nonce")?.Value;
        if (nonce != expectedNonce)
            throw new SecurityTokenException("OIDC nonce mismatch — possible replay.");

        var sub = principal.FindFirst("sub")?.Value
                  ?? throw new SecurityTokenException("id_token has no sub claim.");
        var email = principal.FindFirst("email")?.Value;
        var name = principal.FindFirst("name")?.Value
                   ?? Join(principal.FindFirst("given_name")?.Value, principal.FindFirst("family_name")?.Value);

        // Groups may arrive as repeated claims or a JSON array, and providers do
        // not agree on the name. `role` singular is OpenIddict's spelling, which
        // is what Authly emits — omitting it made every Authly group→role
        // mapping match nothing, indistinguishable from a typo in the mapping.
        var groups = principal.FindAll("groups")
            .Concat(principal.FindAll("roles"))
            .Concat(principal.FindAll("role"))
            .Concat(principal.FindAll("group"))
            .SelectMany(c => ExpandClaim(c.Value))
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new OidcUserInfo(sub, email, name, groups);
    }

    private ConfigurationManager<OpenIdConnectConfiguration> ManagerFor(string discovery)
        => _configs.GetOrAdd(discovery, url =>
        {
            // Allow http only for loopback IdPs (local dev); require HTTPS otherwise.
            var loopback = url.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase)
                           || url.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase);
            var retriever = new HttpDocumentRetriever(httpClientFactory.CreateClient("oidc"))
            {
                RequireHttps = !loopback,
            };
            return new ConfigurationManager<OpenIdConnectConfiguration>(
                url, new OpenIdConnectConfigurationRetriever(), retriever);
        });

    private Task<OpenIdConnectConfiguration> GetConfigurationAsync(string discovery, CancellationToken ct)
        => ManagerFor(discovery).GetConfigurationAsync(ct);

    private static string QueryHelpers(string baseUrl, Dictionary<string, string?> query)
    {
        var pairs = query.Where(kv => kv.Value is not null)
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}");
        var sep = baseUrl.Contains('?') ? "&" : "?";
        return baseUrl + sep + string.Join("&", pairs);
    }

    private static string? Join(string? a, string? b)
    {
        var joined = string.Join(' ', new[] { a, b }.Where(s => !string.IsNullOrWhiteSpace(s)));
        return joined.Length == 0 ? null : joined;
    }

    private static IEnumerable<string> ExpandClaim(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith('['))
        {
            IEnumerable<string>? parsed = null;
            try { parsed = JsonSerializer.Deserialize<List<string>>(trimmed); }
            catch (JsonException) { }
            if (parsed is not null) return parsed;
        }
        return [value];
    }

    private sealed class TokenResponse
    {
        [System.Text.Json.Serialization.JsonPropertyName("id_token")]
        public string? IdToken { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("access_token")]
        public string? AccessToken { get; set; }
    }
}
