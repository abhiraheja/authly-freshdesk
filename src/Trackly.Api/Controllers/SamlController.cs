using System.Security.Claims;
using ITfoxtec.Identity.Saml2;
using ITfoxtec.Identity.Saml2.MvcCore;
using ITfoxtec.Identity.Saml2.Schemas;
using ITfoxtec.Identity.Saml2.Schemas.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Modules.Sso;

namespace Trackly.Api.Controllers;

// Public SAML 2.0 SP endpoints (ITfoxtec). Per-workspace config is built at
// request time from the connection's IdP metadata; the response signature is
// validated against that IdP's published cert before any claims are trusted.
// JIT/session handling is shared with OIDC via SsoLoginService.FinishLoginAsync.
[ApiController]
public class SamlController(
    SsoLoginService sso, IConfiguration configuration, IHttpClientFactory httpClientFactory) : ControllerBase
{
    private string FrontendBaseUrl => configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";
    private string ApiBaseUrl => (configuration.GetNonEmpty("App:ApiBaseUrl") ?? $"{Request.Scheme}://{Request.Host}").TrimEnd('/');
    private string AcsUrl => $"{ApiBaseUrl}/api/auth/saml/acs";
    private string SpEntityId(SsoConnection conn, string slug) =>
        conn.SpEntityId is { Length: > 0 } id ? id : $"{ApiBaseUrl}/saml/{slug}";

    /// <param name="connection">
    /// Which SAML connection to start. Omitted by links written before a
    /// workspace could have more than one, which fall through to its first.
    /// </param>
    [HttpGet("api/auth/saml")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Start(
        [FromQuery] string workspace, [FromQuery] Guid? connection, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(workspace))
            return BadRequest(new { error = "workspace is required." });

        var conn = await sso.ResolveConnectionAsync(workspace, connection, SsoProtocol.Saml, ct);
        if (conn is null || conn.Protocol != SsoProtocol.Saml)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("SSO is not configured.")}");

        Saml2Configuration config;
        try
        {
            config = await BuildConfigAsync(conn, workspace, ct);
        }
        catch (Exception)
        {
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("Could not load IdP metadata.")}");
        }

        var binding = new Saml2RedirectBinding();
        binding.SetRelayStateQuery(new Dictionary<string, string> { { "cid", conn.Id.ToString() } });
        var authn = new Saml2AuthnRequest(config)
        {
            AssertionConsumerServiceUrl = new Uri(AcsUrl),
        };
        return binding.Bind(authn).ToActionResult();
    }

    [HttpPost("api/auth/saml/acs")]
    public async Task<IActionResult> Acs(CancellationToken ct)
    {
        // RelayState carries the connection id so we can load the right IdP config
        // before validating; the signature check below is what actually secures it.
        var connectionId = ParseCid(Request.Form["RelayState"].ToString());
        if (connectionId is null)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("Malformed SSO response.")}");

        var conn = await sso.GetConnectionByIdAsync(connectionId.Value, ct);
        if (conn is null || conn.Protocol != SsoProtocol.Saml)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("SSO connection not found.")}");

        OidcUserInfo claims;
        try
        {
            var config = await BuildConfigAsync(conn, conn.Workspace?.Slug ?? "", ct);
            var binding = new Saml2PostBinding();
            var saml2Response = new Saml2AuthnResponse(config);
            binding.ReadSamlResponse(Request.ToGenericHttpRequest(), saml2Response);
            if (saml2Response.Status != Saml2StatusCodes.Success)
                return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("The identity provider rejected the sign-in.")}");

            // Unbind validates the assertion signature against the IdP's cert.
            binding.Unbind(Request.ToGenericHttpRequest(), saml2Response);
            claims = ExtractClaims(saml2Response.ClaimsIdentity, saml2Response.NameId?.Value);
        }
        catch (Exception)
        {
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString("Sign-in failed. Please try again.")}");
        }

        var result = await sso.FinishLoginAsync(
            conn, claims,
            HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent, ct);
        if (!result.Ok)
            return Redirect($"{FrontendBaseUrl}/login?sso_error={Uri.EscapeDataString(result.Error!)}");

        TracklySession.AppendSessionCookie(Response, result.SessionToken!);
        return Redirect($"{FrontendBaseUrl}/auth/sso/complete");
    }

    // SP metadata the admin hands to their IdP.
    [HttpGet("api/auth/saml/metadata")]
    public async Task<IActionResult> Metadata(
        [FromQuery] string workspace, [FromQuery] Guid? connection, CancellationToken ct)
    {
        var conn = await sso.ResolveConnectionAsync(workspace, connection, SsoProtocol.Saml, ct);
        if (conn is null || conn.Protocol != SsoProtocol.Saml)
            return NotFound();

        var entityId = SpEntityId(conn, workspace);
        var config = new Saml2Configuration { Issuer = entityId };
        var spDescriptor = new SPSsoDescriptor
        {
            AssertionConsumerServices =
            [
                new AssertionConsumerService { Binding = ProtocolBindings.HttpPost, Location = new Uri(AcsUrl) },
            ],
            NameIDFormats = [NameIdentifierFormats.Persistent],
        };
        var metadata = new EntityDescriptor(config) { ValidUntil = null, SPSsoDescriptor = spDescriptor };
        return new Saml2Metadata(metadata).CreateMetadata().ToActionResult();
    }

    // ---- Helpers -------------------------------------------------------------

    private async Task<Saml2Configuration> BuildConfigAsync(SsoConnection conn, string slug, CancellationToken ct)
    {
        var xml = conn.IdpMetadataXml;
        if (string.IsNullOrWhiteSpace(xml) && !string.IsNullOrWhiteSpace(conn.IdpMetadataUrl))
        {
            var http = httpClientFactory.CreateClient("oidc");
            xml = await http.GetStringAsync(conn.IdpMetadataUrl!, ct);
        }
        if (string.IsNullOrWhiteSpace(xml))
            throw new InvalidOperationException("No IdP metadata configured.");

        var entityDescriptor = new EntityDescriptor();
        entityDescriptor.ReadIdPSsoDescriptor(xml);
        var idp = entityDescriptor.IdPSsoDescriptor
                  ?? throw new InvalidOperationException("IdP metadata has no SSO descriptor.");

        var config = new Saml2Configuration
        {
            Issuer = SpEntityId(conn, slug),
            SingleSignOnDestination = idp.SingleSignOnServices.First().Location,
            AllowedIssuer = entityDescriptor.EntityId,
            CertificateValidationMode = System.ServiceModel.Security.X509CertificateValidationMode.None,
            RevocationMode = System.Security.Cryptography.X509Certificates.X509RevocationMode.NoCheck,
        };
        config.SignatureValidationCertificates.AddRange(idp.SigningCertificates);
        config.AllowedAudienceUris.Add(config.Issuer);
        return config;
    }

    private static Guid? ParseCid(string relayState)
    {
        if (string.IsNullOrEmpty(relayState)) return null;
        foreach (var pair in Uri.UnescapeDataString(relayState).Split('&'))
        {
            var kv = pair.Split('=', 2);
            if (kv.Length == 2 && kv[0] == "cid" && Guid.TryParse(kv[1], out var g))
                return g;
        }
        return null;
    }

    private static OidcUserInfo ExtractClaims(ClaimsIdentity identity, string? nameId)
    {
        string? Get(params string[] types) =>
            types.Select(t => identity.FindFirst(t)?.Value).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

        var sub = nameId ?? Get(ClaimTypes.NameIdentifier)
                  ?? throw new InvalidOperationException("SAML assertion has no NameID.");
        var email = Get(ClaimTypes.Email, "email",
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress");
        var name = Get(ClaimTypes.Name, "name", "displayName",
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name");

        var groups = identity.FindAll(ClaimTypes.Role)
            .Concat(identity.FindAll("http://schemas.xmlsoap.org/claims/Group"))
            .Concat(identity.FindAll("groups"))
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new OidcUserInfo(sub, email, name, groups);
    }
}
