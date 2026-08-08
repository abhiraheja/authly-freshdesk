namespace Trackly.Core.Entities;

/// <summary>
/// One configured identity provider. A workspace may have several — "Continue
/// with Google" and "Continue with Microsoft" are two rows, not two settings on
/// one row — which is why this is no longer unique per workspace.
///
/// <see cref="Provider"/> is the *kind* (google, microsoft, …) and is immutable
/// once created: it selects the endpoints, the claim shapes and the brand mark.
/// <see cref="ProviderName"/> is the editable label on the button.
///
/// client_secret is AES-256-GCM encrypted (invariant 3); roles are never taken
/// from the IdP token at request time — group→role mapping is applied only at
/// login (invariant 2).
/// </summary>
public class SsoConnection
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// Which provider this is — see <see cref="SsoProviderKind"/>. Not editable
    /// after creation; changing it would silently repoint every linked identity.
    public string Provider { get; set; } = SsoProviderKind.Oidc;

    /// The button label. Defaults to the provider's own name, but an admin may
    /// call it "Acme SSO" instead.
    public string ProviderName { get; set; } = null!;

    public string Protocol { get; set; } = SsoProtocol.Oidc;

    // OIDC / OAuth2
    public string? DiscoveryEndpoint { get; set; }
    public string? ClientId { get; set; }
    public string? ClientSecretEncrypted { get; set; }

    /// Entra ID directory (tenant) id, or `common` / `organizations`. Only
    /// Microsoft uses it — it is what the discovery URL is built from, and it is
    /// kept as typed so the form can show it back.
    public string? Tenant { get; set; }

    /// Space-separated scope override. Null uses the provider's default.
    public string? Scopes { get; set; }

    // SAML
    public string? IdpMetadataUrl { get; set; }
    public string? IdpMetadataXml { get; set; }
    public string? SpEntityId { get; set; }

    /// <summary>
    /// Comma-separated email domains allowed through this connection, e.g.
    /// `acme.com, acme.co.uk`. Empty means any.
    ///
    /// This matters most for the consumer providers: a Google or Facebook button
    /// is open to every account those companies have ever issued, and JIT
    /// provisioning would happily create a Trackly customer for each one.
    /// </summary>
    public string? AllowedEmailDomains { get; set; }

    /// Off keeps the configuration but takes the button away — the way to pause a
    /// provider without retyping its secret.
    public bool IsEnabled { get; set; } = true;

    /// Shown on Trackly's own sign-in page (staff and anyone else who lands there).
    public bool ShowOnStaffLogin { get; set; } = true;

    /// Shown on workspace-branded, customer-facing sign-in. Off by default: an
    /// enterprise IdP knows staff, not customers (invariant 6's audience split).
    public bool ShowOnCustomerLogin { get; set; }

    /// Button order on the sign-in page. Ties break on CreatedAt.
    public int SortOrder { get; set; }

    public string Status { get; set; } = SsoStatus.Pending;
    public DateTime? TestedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<SsoGroupRoleMapping> GroupMappings { get; set; } = new List<SsoGroupRoleMapping>();
}

public static class SsoProtocol
{
    public const string Oidc = "oidc";
    public const string Saml = "saml";

    /// Plain OAuth 2.0 + a userinfo call. Only Facebook needs it: it publishes a
    /// discovery document but issues an id_token for mobile "Limited Login"
    /// only, so a web sign-in has to read the Graph API instead.
    public const string OAuth2 = "oauth2";

    public static readonly string[] All = [Oidc, Saml, OAuth2];
}

/// <summary>
/// The provider kinds an admin can pick from. Everything except the two
/// `custom*` kinds arrives pre-wired — see <c>SsoProviderCatalog</c>.
/// </summary>
public static class SsoProviderKind
{
    public const string Google = "google";
    public const string Microsoft = "microsoft";
    public const string Facebook = "facebook";
    public const string Authly = "authly";

    /// Any OIDC-compliant IdP, configured by discovery URL.
    public const string Oidc = "oidc";

    /// Any SAML 2.0 IdP, configured by metadata.
    public const string Saml = "saml";

    public static readonly string[] All = [Google, Microsoft, Facebook, Authly, Oidc, Saml];

    /// The two kinds an admin may configure more than once — two corporate IdPs
    /// is a real setup; two Googles is a mistake.
    public static readonly string[] Repeatable = [Oidc, Saml];
}

public static class SsoStatus
{
    public const string Pending = "pending";
    public const string Active = "active";
    public const string Error = "error";
    public static readonly string[] All = [Pending, Active, Error];
}
