using Trackly.Core.Entities;

namespace Trackly.Core.Sso;

/// <summary>
/// What Trackly already knows about each identity provider, so an admin only
/// ever types the things that are genuinely theirs — a client id, a secret, a
/// tenant. Endpoints, scopes and protocol are not configuration; getting them
/// wrong is a support ticket, not a preference.
///
/// The catalogue is also what the settings screen renders: the tiles, the field
/// list per provider, and the "where do I get this" link all come from here, so
/// adding a provider is one entry rather than a UI change plus a login change.
/// </summary>
public record SsoProviderDescriptor(
    string Provider,
    string DisplayName,
    string Protocol,
    /// Fixed discovery URL. Null when the admin supplies it (custom, Authly) or
    /// when it is built from a tenant.
    string? DiscoveryEndpoint = null,
    /// `{tenant}` is replaced with <see cref="SsoConnection.Tenant"/>.
    string? DiscoveryTemplate = null,
    string? DefaultTenant = null,
    /// <summary>
    /// The admin supplies a plain **base URL** and Trackly appends this to reach
    /// discovery. For a product that runs on the customer's own domain, asking
    /// for `https://login.acme.com` is a question they can answer; asking for
    /// `https://login.acme.com/.well-known/openid-configuration` is a path they
    /// have to be told, and mistyping it fails at a confusing distance.
    /// </summary>
    string? DiscoverySuffix = null,
    /// <summary>
    /// The tenant is a workspace slug sent to the authorize endpoint as
    /// `?tenant=`, not part of the discovery URL. Multi-tenant IdPs on one shared
    /// host need it: without the hint the login page cannot tell which tenant's
    /// users and branding to show, and the authorize call fails with
    /// "different workspace" once it reaches a client from another tenant.
    /// </summary>
    bool TenantAsAuthorizeParam = false,
    // OAuth 2.0 only — used when Protocol is oauth2.
    string? AuthorizeEndpoint = null,
    string? TokenEndpoint = null,
    string? UserInfoEndpoint = null,
    string DefaultScopes = "openid profile email",
    bool RequiresClientSecret = true,
    /// The IdP can send group/role claims, so group→role mapping is worth
    /// offering. Consumer logins cannot, and showing the section there only
    /// invites an admin to configure something that will never match.
    bool SupportsGroups = false,
    string? SetupDocsUrl = null);

public static class SsoProviderCatalog
{
    public static readonly SsoProviderDescriptor Google = new(
        SsoProviderKind.Google,
        "Google",
        SsoProtocol.Oidc,
        DiscoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
        DefaultScopes: "openid profile email",
        SetupDocsUrl: "https://console.cloud.google.com/apis/credentials");

    public static readonly SsoProviderDescriptor Microsoft = new(
        SsoProviderKind.Microsoft,
        "Microsoft",
        SsoProtocol.Oidc,
        // `organizations` rather than `common`: a support desk's Entra app should
        // admit work accounts, not every personal Outlook address in existence.
        // An admin who wants one specific directory pastes its id instead.
        DiscoveryTemplate: "https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration",
        DefaultTenant: "organizations",
        DefaultScopes: "openid profile email",
        SupportsGroups: true,
        SetupDocsUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade");

    /// <summary>
    /// Facebook is the one provider that is not OIDC on the web. It publishes a
    /// discovery document, but the id_token it describes is only issued to the
    /// mobile "Limited Login" SDKs — a web authorization-code exchange returns an
    /// access token and nothing else. So this runs as plain OAuth 2.0 and reads
    /// the profile from the Graph API.
    /// </summary>
    public static readonly SsoProviderDescriptor Facebook = new(
        SsoProviderKind.Facebook,
        "Facebook",
        SsoProtocol.OAuth2,
        AuthorizeEndpoint: "https://www.facebook.com/v21.0/dialog/oauth",
        TokenEndpoint: "https://graph.facebook.com/v21.0/oauth/access_token",
        UserInfoEndpoint: "https://graph.facebook.com/v21.0/me?fields=id,name,email",
        DefaultScopes: "email public_profile",
        SetupDocsUrl: "https://developers.facebook.com/apps");

    /// <summary>
    /// Authly — a self-hosted, multi-tenant OIDC provider (OpenIddict).
    ///
    /// Three things it needs that a single-tenant IdP does not:
    /// - the admin gives a **base URL**, because an Authly deployment lives on
    ///   the customer's own domain;
    /// - a **tenant slug** on the authorize request when several tenants share
    ///   one host and that host is not a per-tenant custom domain;
    /// - the **`roles` scope**, or the `roles` claim never arrives and every
    ///   group→role mapping silently matches nothing.
    ///
    /// PKCE is mandatory at Authly for confidential clients too — which Trackly
    /// always sends, so a Web (confidential) client works as well as a public one.
    /// </summary>
    public static readonly SsoProviderDescriptor Authly = new(
        SsoProviderKind.Authly,
        "Authly",
        SsoProtocol.Oidc,
        DiscoverySuffix: "/.well-known/openid-configuration",
        TenantAsAuthorizeParam: true,
        DefaultScopes: "openid profile email roles",
        // Authly issues public SPA clients that authenticate with PKCE alone.
        RequiresClientSecret: false,
        SupportsGroups: true,
        SetupDocsUrl: "https://github.com/abhiraheja/authly#integrate-your-app-oauth2--oidc");

    public static readonly SsoProviderDescriptor Oidc = new(
        SsoProviderKind.Oidc,
        "Custom OIDC",
        SsoProtocol.Oidc,
        DefaultScopes: "openid profile email",
        RequiresClientSecret: false,
        SupportsGroups: true);

    public static readonly SsoProviderDescriptor Saml = new(
        SsoProviderKind.Saml,
        "Custom SAML",
        SsoProtocol.Saml,
        DefaultScopes: "",
        RequiresClientSecret: false,
        SupportsGroups: true);

    public static readonly IReadOnlyList<SsoProviderDescriptor> All =
        [Google, Microsoft, Facebook, Authly, Oidc, Saml];

    public static SsoProviderDescriptor? Find(string? provider) =>
        All.FirstOrDefault(p => string.Equals(p.Provider, provider, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The descriptor a connection runs on, or a fallback built from its protocol
    /// so a row written before this catalogue existed still resolves.
    /// </summary>
    public static SsoProviderDescriptor For(SsoConnection connection) =>
        Find(connection.Provider)
        ?? (connection.Protocol == SsoProtocol.Saml ? Saml : Oidc);

    /// <summary>
    /// The discovery URL to actually call: fixed, built from the tenant, or
    /// derived from the base URL the admin gave — otherwise what they typed.
    /// </summary>
    public static string? ResolveDiscoveryEndpoint(SsoConnection connection)
    {
        var descriptor = For(connection);
        if (descriptor.DiscoveryEndpoint is { Length: > 0 } fixedUrl) return fixedUrl;

        if (descriptor.DiscoveryTemplate is { Length: > 0 } template)
        {
            var tenant = connection.Tenant is { Length: > 0 } t ? t.Trim() : descriptor.DefaultTenant ?? "common";
            return template.Replace("{tenant}", Uri.EscapeDataString(tenant));
        }

        if (descriptor.DiscoverySuffix is { Length: > 0 } suffix
            && connection.DiscoveryEndpoint is { Length: > 0 } baseUrl)
        {
            // Tolerate an admin pasting the full discovery URL anyway — appending
            // the suffix to it would produce a 404 and a mystery.
            var trimmed = baseUrl.TrimEnd('/');
            return trimmed.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) ? trimmed : trimmed + suffix;
        }

        return connection.DiscoveryEndpoint;
    }

    /// <summary>
    /// Extra query parameters for the authorize redirect.
    ///
    /// Only the tenant hint today. It cannot ride on the discovery URL because a
    /// shared-host IdP publishes one discovery document for every tenant — the
    /// tenant is a property of the *request*, not of the document.
    /// </summary>
    public static IReadOnlyDictionary<string, string>? AuthorizeParameters(SsoConnection connection)
    {
        var descriptor = For(connection);
        if (!descriptor.TenantAsAuthorizeParam || connection.Tenant is not { Length: > 0 } tenant)
            return null;

        return new Dictionary<string, string> { ["tenant"] = tenant.Trim() };
    }

    public static string ResolveScopes(SsoConnection connection) =>
        connection.Scopes is { Length: > 0 } s ? s : For(connection).DefaultScopes;
}
