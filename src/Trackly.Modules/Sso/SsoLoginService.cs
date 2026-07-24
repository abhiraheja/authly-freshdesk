using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Sso;

// Drives the OIDC login: builds the authorize redirect, then on callback
// validates the token, JIT-provisions the Trackly user, applies group->role
// mapping, links any guest tickets, and issues a Trackly session. Roles come
// from our DB + the mapping, never from the raw IdP token (invariant 2).
public class SsoLoginService(
    TracklyDbContext db,
    IOidcClient oidc,
    ISecretProtector secrets,
    AuthService authService,
    ILogger<SsoLoginService> logger)
{
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);

    // ---- Start ---------------------------------------------------------------

    public async Task<SsoStartResult> StartOidcAsync(string slug, string redirectUri, CancellationToken ct)
    {
        var conn = await db.SsoConnections
            .SingleOrDefaultAsync(c => c.Workspace!.Slug == slug && c.Protocol == SsoProtocol.Oidc, ct);
        if (conn is null || string.IsNullOrEmpty(conn.DiscoveryEndpoint) || string.IsNullOrEmpty(conn.ClientId))
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

        var config = new OidcClientConfig(conn.DiscoveryEndpoint!, conn.ClientId!, DecryptSecret(conn));
        try
        {
            var url = await oidc.BuildAuthorizeUrlAsync(config, redirectUri, state, nonce, codeChallenge, ct);
            return SsoStartResult.Redirect(url);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "OIDC authorize build failed for workspace {Slug}", slug);
            await MarkErrorAsync(conn.Id, ct);
            return SsoStartResult.Fail("Could not reach the identity provider.");
        }
    }

    // ---- Callback ------------------------------------------------------------

    public async Task<SsoCallbackResult> CompleteOidcAsync(
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
            var config = new OidcClientConfig(conn.DiscoveryEndpoint!, conn.ClientId!, DecryptSecret(conn));
            info = await oidc.ExchangeCodeAsync(config, redirectUri, code, login.CodeVerifier, login.Nonce, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "OIDC callback failed for connection {ConnectionId}", conn.Id);
            conn.Status = SsoStatus.Error;
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("Sign-in failed. Please try again or contact your administrator.");
        }

        return await FinishLoginAsync(conn, info, ipAddress, userAgent, ct);
    }

    // ---- SAML entry (protocol handled in the API layer; claims land here) ----

    public Task<SsoConnection?> GetConnectionAsync(string slug, string protocol, CancellationToken ct)
        => db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.Workspace!.Slug == slug && c.Protocol == protocol, ct);

    public Task<SsoConnection?> GetConnectionByIdAsync(Guid connectionId, CancellationToken ct)
        => db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.Id == connectionId, ct);

    // Shared by OIDC callback and SAML ACS: the IdP has authenticated the user and
    // handed us verified claims; provision, map role, issue the Trackly session.
    public async Task<SsoCallbackResult> FinishLoginAsync(
        SsoConnection conn, OidcUserInfo info, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(info.Email))
        {
            await db.SaveChangesAsync(ct);
            return SsoCallbackResult.Fail("Your identity provider did not return an email address.");
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
            // 2) Match by email within the workspace, else create.
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

    private string? DecryptSecret(SsoConnection conn) =>
        conn.ClientSecretEncrypted is { Length: > 0 } enc ? secrets.Unprotect(enc) : null;

    private async Task MarkErrorAsync(Guid connectionId, CancellationToken ct)
    {
        await db.SsoConnections.Where(c => c.Id == connectionId)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, SsoStatus.Error), ct);
    }
}
