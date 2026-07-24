namespace Trackly.Core.Entities;

// A workspace's single active SSO connection (OIDC or SAML). client_secret is
// AES-256-GCM encrypted; roles are never taken from the IdP token at request time
// — group->role mapping is applied only at login (invariant 2).
public class SsoConnection
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string ProviderName { get; set; } = null!;  // "Authly", "Okta", "Custom OIDC", ...
    public string Protocol { get; set; } = SsoProtocol.Oidc;

    // OIDC
    public string? DiscoveryEndpoint { get; set; }
    public string? ClientId { get; set; }
    public string? ClientSecretEncrypted { get; set; }

    // SAML
    public string? IdpMetadataUrl { get; set; }
    public string? IdpMetadataXml { get; set; }
    public string? SpEntityId { get; set; }

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
    public static readonly string[] All = [Oidc, Saml];
}

public static class SsoStatus
{
    public const string Pending = "pending";
    public const string Active = "active";
    public const string Error = "error";
    public static readonly string[] All = [Pending, Active, Error];
}
