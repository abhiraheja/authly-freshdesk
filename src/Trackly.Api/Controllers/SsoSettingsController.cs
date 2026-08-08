using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Core.Sso;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

/// <summary>
/// Admin-only SSO configuration — the settings screen's backing API.
///
/// A workspace holds a list of connections, not one: "Continue with Google" and
/// "Continue with Microsoft" are separate rows with separate secrets, separate
/// audiences and separate statuses.
///
/// Three things this controller decides rather than accepts:
/// - **protocol** comes from the catalogue, never the request. Whether Facebook
///   is OAuth 2.0 is not an admin's opinion.
/// - **provider** is immutable after creation. Changing it under a live
///   connection would silently repoint every linked identity at a new IdP.
/// - **the redirect URI** is computed here from ApiBaseUrl. The screen used to
///   build it from the browser's origin, which is simply wrong whenever the API
///   is not on the same host — and produces an IdP registration that fails at
///   the last step of a login, where it is hardest to diagnose.
///
/// Client secrets are write-only: the response carries hasClientSecret, never
/// the value (invariant 3).
/// </summary>
[ApiController]
[Authorize(Policy = "Admin")]
public class SsoSettingsController(
    TracklyDbContext db, ISecretProtector secrets, IConfiguration configuration) : ControllerBase
{
    public record GroupMappingDto(string GroupName, string TracklyRole);

    public record SaveSsoRequest(
        string? Provider,
        string? ProviderName,
        string? DiscoveryEndpoint,
        string? ClientId,
        string? ClientSecret,
        string? Tenant,
        string? Scopes,
        string? AllowedEmailDomains,
        string? IdpMetadataUrl,
        string? IdpMetadataXml,
        string? SpEntityId,
        bool? IsEnabled,
        bool? ShowOnStaffLogin,
        bool? ShowOnCustomerLogin,
        int? SortOrder,
        List<GroupMappingDto>? GroupMappings);

    private string ApiBaseUrl =>
        (configuration.GetNonEmpty("App:ApiBaseUrl") ?? $"{Request.Scheme}://{Request.Host}").TrimEnd('/');

    // ---- Read ----------------------------------------------------------------

    /// The catalogue travels with the list so the screen can render its provider
    /// tiles, per-provider field sets and help links without a second round trip
    /// or a second copy of the same facts in TypeScript.
    [HttpGet("api/admin/sso")]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);

        var connections = await db.SsoConnections
            .Include(c => c.GroupMappings)
            .Where(c => c.WorkspaceId == workspaceId)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);

        return Ok(new
        {
            catalogue = SsoProviderCatalog.All.Select(ToCatalogueEntry),
            // One redirect URI for every OIDC and OAuth 2.0 provider — the same
            // string an admin pastes into Google, Entra and Facebook alike.
            redirectUri = $"{ApiBaseUrl}/api/auth/sso/callback",
            samlAcsUrl = $"{ApiBaseUrl}/api/auth/saml/acs",
            connections = connections.Select(c => ToResponse(c, slug)),
        });
    }

    // ---- Create --------------------------------------------------------------

    [HttpPost("api/admin/sso")]
    public async Task<IActionResult> Create([FromBody] SaveSsoRequest req, CancellationToken ct)
    {
        var descriptor = SsoProviderCatalog.Find(req.Provider);
        if (descriptor is null)
            return BadRequest(new { error = "Unknown provider." });

        var workspaceId = User.GetWorkspaceId();

        // The DB has a filtered unique index for this; catching it here turns a
        // 500 into a sentence that says what to do instead.
        if (!SsoProviderKind.Repeatable.Contains(descriptor.Provider)
            && await db.SsoConnections.AnyAsync(c => c.WorkspaceId == workspaceId && c.Provider == descriptor.Provider, ct))
        {
            return BadRequest(new { error = $"{descriptor.DisplayName} is already configured. Edit that connection instead." });
        }

        var conn = new SsoConnection
        {
            WorkspaceId = workspaceId,
            Provider = descriptor.Provider,
            ProviderName = descriptor.DisplayName,
            Protocol = descriptor.Protocol,
            SortOrder = await db.SsoConnections.CountAsync(c => c.WorkspaceId == workspaceId, ct),
        };

        var error = Apply(conn, descriptor, req);
        if (error is not null) return BadRequest(new { error });

        db.SsoConnections.Add(conn);
        await db.SaveChangesAsync(ct);

        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);
        return StatusCode(201, ToResponse(conn, slug));
    }

    // ---- Update --------------------------------------------------------------

    [HttpPut("api/admin/sso/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveSsoRequest req, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var conn = await db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.Id == id && c.WorkspaceId == workspaceId, ct);
        if (conn is null) return NotFound();

        // Provider is fixed at creation — see the class comment.
        if (req.Provider is { Length: > 0 } requested
            && !string.Equals(requested, conn.Provider, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { error = "A connection's provider cannot be changed. Delete it and add the other provider." });
        }

        var descriptor = SsoProviderCatalog.For(conn);

        // Switching a working provider off is the same lockout risk as switching
        // password sign-in off, and gets the same refusal (invariant 8).
        var turningOff = req.IsEnabled == false && conn.IsEnabled;
        var hidingFromStaff = req.ShowOnStaffLogin == false && conn.ShowOnStaffLogin;
        if ((turningOff || hidingFromStaff) && await IsLastWayInAsync(workspaceId, conn, ct))
            return BadRequest(new { error = LockoutMessage });

        var error = Apply(conn, descriptor, req);
        if (error is not null) return BadRequest(new { error });

        conn.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);
        return Ok(ToResponse(conn, slug));
    }

    /// <summary>
    /// Just the switches — enabled, the two audiences, order.
    ///
    /// Separate from PUT because PUT is a *full* save and validates the whole
    /// connection. A row's on/off switch sends one field, and running it through
    /// the full save would read every absent field as "clear it" and then refuse
    /// the result for missing a client ID.
    /// </summary>
    [HttpPatch("api/admin/sso/{id:guid}")]
    public async Task<IActionResult> SetState(Guid id, [FromBody] SsoStateRequest req, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var conn = await db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.Id == id && c.WorkspaceId == workspaceId, ct);
        if (conn is null) return NotFound();

        var turningOff = req.IsEnabled == false && conn.IsEnabled;
        var hidingFromStaff = req.ShowOnStaffLogin == false && conn.ShowOnStaffLogin;
        if ((turningOff || hidingFromStaff) && await IsLastWayInAsync(workspaceId, conn, ct))
            return BadRequest(new { error = LockoutMessage });

        if (req.IsEnabled is { } enabled) conn.IsEnabled = enabled;
        if (req.ShowOnStaffLogin is { } staff) conn.ShowOnStaffLogin = staff;
        if (req.ShowOnCustomerLogin is { } customer) conn.ShowOnCustomerLogin = customer;
        if (req.SortOrder is { } order) conn.SortOrder = order;
        conn.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);
        return Ok(ToResponse(conn, slug));
    }

    public record SsoStateRequest(
        bool? IsEnabled, bool? ShowOnStaffLogin, bool? ShowOnCustomerLogin, int? SortOrder);

    // ---- Delete --------------------------------------------------------------

    [HttpDelete("api/admin/sso/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var conn = await db.SsoConnections.SingleOrDefaultAsync(c => c.Id == id && c.WorkspaceId == workspaceId, ct);
        if (conn is null) return NotFound();

        if (await IsLastWayInAsync(workspaceId, conn, ct))
            return BadRequest(new { error = LockoutMessage });

        db.SsoConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---- Shared --------------------------------------------------------------

    private const string LockoutMessage =
        "This is the only sign-in method that works. Turn on password sign-in, or prove email delivery, before removing it.";

    /// <summary>
    /// Whether removing or hiding <paramref name="conn"/> would leave nobody able
    /// to sign in. Same rule as LoginSettingsController: a method counts only
    /// when it is *proven* — a delivered test email, a completed SSO login —
    /// never merely configured. Self-hosted means no support desk and no
    /// recovery link, so a lockout here is permanent.
    /// </summary>
    private async Task<bool> IsLastWayInAsync(Guid workspaceId, SsoConnection conn, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);
        if (workspace.PasswordLoginEnabled) return false;

        var emailWorks = workspace.EmailLoginEnabled
                         && await db.EmailConfigs.AnyAsync(c => c.WorkspaceId == workspaceId && c.LastVerifiedAt != null, ct);
        if (emailWorks) return false;

        var otherActive = await db.SsoConnections.AnyAsync(
            c => c.WorkspaceId == workspaceId
                 && c.Id != conn.Id
                 && c.IsEnabled
                 && c.ShowOnStaffLogin
                 && c.Status == SsoStatus.Active,
            ct);
        if (otherActive) return false;

        // Only a connection that has actually carried a login is holding the
        // door open; a pending one was never a way in to begin with.
        return conn.Status == SsoStatus.Active;
    }

    /// Copies a request onto a connection, validating what this provider needs.
    /// Returns an error message, or null when the connection is good to save.
    private string? Apply(SsoConnection conn, SsoProviderDescriptor descriptor, SaveSsoRequest req)
    {
        if (req.ProviderName is { Length: > 0 } name) conn.ProviderName = name.Trim();
        if (string.IsNullOrWhiteSpace(conn.ProviderName)) conn.ProviderName = descriptor.DisplayName;

        conn.Tenant = NullIfEmpty(req.Tenant);
        conn.Scopes = NullIfEmpty(req.Scopes);
        conn.AllowedEmailDomains = NullIfEmpty(req.AllowedEmailDomains);
        if (req.IsEnabled is { } enabled) conn.IsEnabled = enabled;
        if (req.ShowOnStaffLogin is { } staff) conn.ShowOnStaffLogin = staff;
        if (req.ShowOnCustomerLogin is { } customer) conn.ShowOnCustomerLogin = customer;
        if (req.SortOrder is { } order) conn.SortOrder = order;

        // null keeps the stored secret, "" clears it, any value is encrypted.
        conn.ClientSecretEncrypted = req.ClientSecret switch
        {
            null => conn.ClientSecretEncrypted,
            "" => null,
            _ => secrets.Protect(req.ClientSecret),
        };

        if (descriptor.Protocol == SsoProtocol.Saml)
        {
            conn.IdpMetadataUrl = NullIfEmpty(req.IdpMetadataUrl);
            conn.IdpMetadataXml = NullIfEmpty(req.IdpMetadataXml);
            conn.SpEntityId = NullIfEmpty(req.SpEntityId);
            if (conn.IdpMetadataUrl is null && conn.IdpMetadataXml is null)
                return "SAML requires IdP metadata — a URL or the XML itself.";
            if (conn.IdpMetadataUrl is { } metadataUrl && !Uri.TryCreate(metadataUrl, UriKind.Absolute, out _))
                return "The IdP metadata URL must be an absolute URL.";
        }
        else
        {
            conn.ClientId = NullIfEmpty(req.ClientId);
            if (conn.ClientId is null)
                return $"{descriptor.DisplayName} needs a client ID.";

            // Only ask for discovery where the catalogue does not already know it.
            var needsDiscovery = descriptor.DiscoveryEndpoint is null
                                 && descriptor.DiscoveryTemplate is null
                                 && descriptor.Protocol == SsoProtocol.Oidc;
            if (needsDiscovery)
            {
                conn.DiscoveryEndpoint = NullIfEmpty(req.DiscoveryEndpoint);
                if (conn.DiscoveryEndpoint is null)
                {
                    return descriptor.DiscoverySuffix is null
                        ? "This provider needs its OpenID Connect discovery endpoint."
                        : $"{descriptor.DisplayName} needs its base URL, e.g. https://login.example.com.";
                }
                if (!Uri.TryCreate(conn.DiscoveryEndpoint, UriKind.Absolute, out _))
                    return "That must be an absolute URL, starting with https://.";
            }
            else
            {
                // Derived from the catalogue (and the tenant) at login time, so a
                // stale value left here would only ever mislead.
                conn.DiscoveryEndpoint = null;
            }

            if (descriptor.RequiresClientSecret && string.IsNullOrEmpty(conn.ClientSecretEncrypted))
                return $"{descriptor.DisplayName} needs a client secret.";
        }

        foreach (var m in req.GroupMappings ?? [])
            if (!TracklyRoles.All.Contains(m.TracklyRole))
                return $"Invalid role in mapping: {m.TracklyRole}.";

        // Replace mappings wholesale.
        db.SsoGroupRoleMappings.RemoveRange(conn.GroupMappings);
        conn.GroupMappings = (req.GroupMappings ?? [])
            .Where(m => !string.IsNullOrWhiteSpace(m.GroupName))
            .Select(m => new SsoGroupRoleMapping { GroupName = m.GroupName.Trim(), TracklyRole = m.TracklyRole })
            .ToList();

        return null;
    }

    private static object ToCatalogueEntry(SsoProviderDescriptor d) => new
    {
        provider = d.Provider,
        displayName = d.DisplayName,
        protocol = d.Protocol,
        // True when the admin has to supply the URL themselves.
        needsDiscoveryEndpoint = d.DiscoveryEndpoint is null
                                 && d.DiscoveryTemplate is null
                                 && d.Protocol == SsoProtocol.Oidc,
        // Non-null when they give a base URL and Trackly appends this to reach
        // discovery. The screen uses it for both the label and the live preview
        // of the URL that will actually be called.
        discoverySuffix = d.DiscoverySuffix,
        needsTenant = d.DiscoveryTemplate is not null || d.TenantAsAuthorizeParam,
        // A workspace slug on the authorize call, not a directory id in a URL —
        // different question, so the screen has to ask it differently.
        tenantIsSlug = d.TenantAsAuthorizeParam,
        defaultTenant = d.DefaultTenant,
        requiresClientSecret = d.RequiresClientSecret,
        supportsGroups = d.SupportsGroups,
        defaultScopes = d.DefaultScopes,
        setupDocsUrl = d.SetupDocsUrl,
        repeatable = SsoProviderKind.Repeatable.Contains(d.Provider),
    };

    private object ToResponse(SsoConnection c, string workspaceSlug)
    {
        var startPath = c.Protocol == SsoProtocol.Saml ? "/api/auth/saml" : "/api/auth/sso";
        return new
        {
            id = c.Id,
            provider = c.Provider,
            providerName = c.ProviderName,
            protocol = c.Protocol,
            discoveryEndpoint = c.DiscoveryEndpoint,
            // What will actually be called — with the tenant filled in. Worth
            // showing: "organizations" vs a directory id is the single thing
            // people get wrong about Entra, and it is invisible otherwise.
            resolvedDiscoveryEndpoint = SsoProviderCatalog.ResolveDiscoveryEndpoint(c),
            clientId = c.ClientId,
            hasClientSecret = !string.IsNullOrEmpty(c.ClientSecretEncrypted),
            tenant = c.Tenant,
            scopes = c.Scopes,
            allowedEmailDomains = c.AllowedEmailDomains,
            idpMetadataUrl = c.IdpMetadataUrl,
            idpMetadataXml = c.IdpMetadataXml,
            spEntityId = c.SpEntityId,
            spMetadataUrl = c.Protocol == SsoProtocol.Saml
                ? $"{ApiBaseUrl}/api/auth/saml/metadata?workspace={workspaceSlug}&connection={c.Id}"
                : null,
            isEnabled = c.IsEnabled,
            showOnStaffLogin = c.ShowOnStaffLogin,
            showOnCustomerLogin = c.ShowOnCustomerLogin,
            sortOrder = c.SortOrder,
            status = c.Status,
            testedAt = c.TestedAt,
            // Open it in a private window to test — the flow signs you in, so
            // there is no way to "test" it without actually doing it.
            startUrl = $"{startPath}?workspace={workspaceSlug}&connection={c.Id}",
            groupMappings = c.GroupMappings
                .Select(m => new { groupName = m.GroupName, tracklyRole = m.TracklyRole })
                .ToList(),
        };
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
