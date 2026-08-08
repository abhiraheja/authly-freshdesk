using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Core.Sso;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Sso;

// Drives the redirect-based logins: builds the authorize URL, then on callback
// validates what came back, JIT-provisions the Trackly user, applies group->role
// mapping, links any guest tickets, and issues a Trackly session. Roles come
// from our DB + the mapping, never from the raw IdP token (invariant 2).
//
// A workspace can have several connections, so every flow is keyed on a
// connection id carried through `state` (OIDC/OAuth2) or RelayState (SAML) —
// never on "the workspace's SSO", which no longer means anything.
public class SsoLoginService(
    TracklyDbContext db,
    IOidcClient oidc,
    IOAuth2Client oauth2,
    ISecretProtector secrets,
    AuthService authService,
    ILogger<SsoLoginService> logger)
{
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);

    // ---- Reading connections -------------------------------------------------

    /// <summary>
    /// The buttons a sign-in page should show, in order.
    ///
    /// `customerFacing` picks the audience: a branded surface offers only the
    /// providers an admin marked for customers, because an enterprise IdP knows
    /// staff and would reject — or worse, silently provision — everyone else.
    /// Connections in `error` are held back: a button that is known not to work
    /// is worse than one fewer way in.
    /// </summary>
    public async Task<List<SsoConnection>> ListForLoginAsync(Guid workspaceId, bool customerFacing, CancellationToken ct)
    {
        var query = db.SsoConnections
            .Where(c => c.WorkspaceId == workspaceId && c.IsEnabled && c.Status != SsoStatus.Error);

        query = customerFacing
            ? query.Where(c => c.ShowOnCustomerLogin)
            : query.Where(c => c.ShowOnStaffLogin);

        return await query
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);
    }

    public Task<SsoConnection?> GetConnectionByIdAsync(Guid connectionId, CancellationToken ct)
        => db.SsoConnections
            .Include(c => c.GroupMappings)
            .Include(c => c.Workspace)
            .SingleOrDefaultAsync(c => c.Id == connectionId, ct);

    /// <summary>
    /// The connection a login should start on: the one asked for by id, or —
    /// when a caller predates multi-provider links — the first enabled one that
    /// speaks the given protocol.
    /// </summary>
    public async Task<SsoConnection?> ResolveConnectionAsync(
        string slug, Guid? connectionId, string? protocol, CancellationToken ct)
    {
        if (connectionId is { } id)
        {
            var byId = await GetConnectionByIdAsync(id, ct);
            // The slug is part of the link, so a mismatch is a tampered or stale
            // URL rather than a lookup miss.
            return byId is not null && byId.Workspace?.Slug == slug && byId.IsEnabled ? byId : null;
        }

        return await db.SsoConnections
            .Include(c => c.GroupMappings)
            .Include(c => c.Workspace)
            .Where(c => c.Workspace!.Slug == slug && c.IsEnabled)
            .Where(c => protocol == null || c.Protocol == protocol)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }

    // ---- Start ---------------------------------------------------------------

    /// <summary>
    /// Begins a redirect login. Handles OIDC and OAuth 2.0; SAML binds its own
    /// request in the API layer and rejoins at <see cref="FinishLoginAsync"/>.
    /// </summary>
    public async Task<SsoStartResult> StartAsync(
        string slug, Guid? connectionId, string redirectUri, CancellationToken ct)
    {
        var conn = await ResolveConnectionAsync(slug, connectionId, null, ct);
        if (conn is null) return SsoStartResult.NotConfigured;
        if (conn.Protocol == SsoProtocol.Saml)
            return SsoStartResult.Fail("This provider uses SAML — start it at /api/auth/saml.");

        if (string.IsNullOrEmpty(conn.ClientId))
            return SsoStartResult.NotConfigured;

        var state = TokenUtils.GenerateToken();
        var nonce = TokenUtils.GenerateToken();
        var codeVerifier = TokenUtils.GenerateToken();
        var codeChallenge = TokenUtils.Base64UrlSha256(codeVerifier);

        db.SsoLoginStates.Add(new SsoLoginState
        {
            WorkspaceId = conn.WorkspaceId,
            ConnectionId = conn.Id,
            State = state,
            Nonce = nonce,
            CodeVerifier = codeVerifier,
            ExpiresAt = DateTime.UtcNow.Add(StateLifetime),
        });
        await db.SaveChangesAsync(ct);

        try
        {
            var url = conn.Protocol == SsoProtocol.OAuth2
                ? oauth2.BuildAuthorizeUrl(OAuth2ConfigFor(conn), redirectUri, state, codeChallenge)
                : await oidc.BuildAuthorizeUrlAsync(OidcConfigFor(conn), redirectUri, state, nonce, codeChallenge, ct);
            return SsoStartResult.Redirect(url);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "SSO authorize build failed for connection {ConnectionId}", conn.Id);
            await MarkErrorAsync(conn.Id, ct);
            return SsoStartResult.Fail("Could not reach the identity provider.");
        }
    }

    // ---- Callback ------------------------------------------------------------

    /// One callback for OIDC and OAuth 2.0 alike — `state` says which connection
    /// this is, and the connection says which protocol to finish it with.
    public async Task<SsoCallbackResult> CompleteAsync(
        string state, string code, string redirectUri, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        var login = await db.SsoLoginStates
            .SingleOrDefaultAsync(s => s.State == state && s.ConsumedAt == null && s.ExpiresAt >= DateTime.UtcNow, ct);
        if (login is null)
            return SsoCallbackResult.Fail("This sign-in link has expired. Please try again.");
        login.ConsumedAt = DateTime.UtcNow; // single-use, even if the exchange later fails

        var conn = await db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.Id == login.ConnectionId, ct);
        if (conn is null)
        {
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("The SSO connection no longer exists.");
        }

        OidcUserInfo info;
        try
        {
            info = conn.Protocol == SsoProtocol.OAuth2
                ? await oauth2.ExchangeCodeAsync(OAuth2ConfigFor(conn), redirectUri, code, login.CodeVerifier, ct)
                : await oidc.ExchangeCodeAsync(
                    OidcConfigFor(conn), redirectUri, code, login.CodeVerifier, login.Nonce, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "SSO callback failed for connection {ConnectionId}", conn.Id);
            conn.Status = SsoStatus.Error;
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("Sign-in failed. Please try again or contact your administrator.");
        }

        return await FinishLoginAsync(conn, info, ipAddress, userAgent, ct);
    }

    // Shared by every protocol: the IdP has authenticated the user and handed us
    // verified claims; provision, map role, issue the Trackly session.
    public async Task<SsoCallbackResult> FinishLoginAsync(
        SsoConnection conn, OidcUserInfo info, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(info.Email))
        {
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("Your identity provider did not return an email address.");
        }

        // A Google or Facebook button is open to every account those companies
        // have ever issued. When an admin has named the domains they expect, an
        // address outside them is refused here — before JIT provisioning creates
        // an account for it.
        if (!IsDomainAllowed(conn.AllowedEmailDomains, info.Email))
        {
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("That email domain is not allowed to sign in here.");
        }

        User user;
        try
        {
            user = await ProvisionAsync(conn, info, ct);
        }
        catch (InvalidOperationException)
        {
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("This account has been deactivated in Trackly.");
        }

        conn.Status = SsoStatus.Active;
        conn.TestedAt = DateTime.UtcNow;

        var sessionToken = await authService.IssueSessionAsync(user, ipAddress, userAgent, ct);
        await authService.LinkGuestTicketsAsync(user, ct);
        return SsoCallbackResult.Success(user, sessionToken);
    }

    /// Empty means any domain. Sub-domains are not implied — `acme.com` does not
    /// admit `mail.acme.com`, because an allowlist that quietly widens is not one.
    internal static bool IsDomainAllowed(string? allowedDomains, string email)
    {
        if (string.IsNullOrWhiteSpace(allowedDomains)) return true;

        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1) return false;
        var domain = email[(at + 1)..].Trim();

        return allowedDomains
            .Split([',', ';', ' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(d => string.Equals(d.TrimStart('@'), domain, StringComparison.OrdinalIgnoreCase));
    }

    // ---- JIT provisioning + role mapping ------------------------------------

    private async Task<User> ProvisionAsync(SsoConnection conn, OidcUserInfo info, CancellationToken ct)
    {
        var email = info.Email!.Trim().ToLowerInvariant();

        // 1) Existing identity for this connection?
        var identity = await db.UserIdentities
            .Include(i => i.User)
            .SingleOrDefaultAsync(i => i.ConnectionId == conn.Id && i.ProviderSub == info.Subject && i.IsActive, ct);
        User user;
        if (identity is not null)
        {
            user = identity.User;
        }
        else
        {
            // 2) Match by email within the workspace, else create. This is also
            // what links one person's Google and Microsoft buttons to one account.
            user = await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == conn.WorkspaceId && u.Email == email, ct)
                   ?? new User { WorkspaceId = conn.WorkspaceId, Email = email };
            if (user.Id == Guid.Empty) db.Users.Add(user);

            db.UserIdentities.Add(new UserIdentity
            {
                User = user,
                ConnectionId = conn.Id,
                ProviderSub = info.Subject,
            });
        }

        if (!user.IsActive)
            throw new InvalidOperationException("User is deactivated in Trackly.");

        if (string.IsNullOrWhiteSpace(user.Name) && !string.IsNullOrWhiteSpace(info.Name))
            user.Name = info.Name;
        user.LastLoginAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;

        // Roles are re-evaluated on every login when mappings exist; the raw IdP
        // token never sets a role directly.
        var mapped = ResolveRole(conn.GroupMappings, info.Groups);
        if (mapped is not null)
            user.Role = mapped;

        return user;
    }

    // Highest-privilege matching mapping wins. Returns null when no mappings are
    // configured at all (admin manages roles manually); returns 'customer' when
    // mappings exist but none of the user's groups match.
    private static string? ResolveRole(ICollection<SsoGroupRoleMapping> mappings, IReadOnlyList<string> groups)
    {
        if (mappings.Count == 0) return null;

        var rank = new Dictionary<string, int>
        {
            [TracklyRoles.Customer] = 0, [TracklyRoles.Agent] = 1, [TracklyRoles.Admin] = 2,
        };
        var best = TracklyRoles.Customer;
        foreach (var m in mappings)
            if (groups.Contains(m.GroupName, StringComparer.OrdinalIgnoreCase)
                && rank.GetValueOrDefault(m.TracklyRole) > rank[best])
                best = m.TracklyRole;
        return best;
    }

    // ---- Helpers -------------------------------------------------------------

    private OidcClientConfig OidcConfigFor(SsoConnection conn) => new(
        SsoProviderCatalog.ResolveDiscoveryEndpoint(conn)
            ?? throw new InvalidOperationException("No discovery endpoint configured."),
        conn.ClientId!,
        DecryptSecret(conn),
        SsoProviderCatalog.ResolveScopes(conn),
        SsoProviderCatalog.AuthorizeParameters(conn));

    private OAuth2ClientConfig OAuth2ConfigFor(SsoConnection conn)
    {
        var descriptor = SsoProviderCatalog.For(conn);
        return new OAuth2ClientConfig(
            descriptor.AuthorizeEndpoint ?? throw new InvalidOperationException("Provider has no authorize endpoint."),
            descriptor.TokenEndpoint ?? throw new InvalidOperationException("Provider has no token endpoint."),
            descriptor.UserInfoEndpoint ?? throw new InvalidOperationException("Provider has no userinfo endpoint."),
            conn.ClientId!,
            DecryptSecret(conn),
            SsoProviderCatalog.ResolveScopes(conn));
    }

    private string? DecryptSecret(SsoConnection conn) =>
        conn.ClientSecretEncrypted is { Length: > 0 } enc ? secrets.Unprotect(enc) : null;

    private async Task MarkErrorAsync(Guid connectionId, CancellationToken ct)
    {
        await db.SsoConnections.Where(c => c.Id == connectionId)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, SsoStatus.Error), ct);
    }
}
