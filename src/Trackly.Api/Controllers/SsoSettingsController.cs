using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Admin-only SSO configuration (the wizard's backing API). One connection per
// workspace, upserted. The client secret is write-only — the response exposes
// hasClientSecret instead (invariant 3). Group->role mappings are replaced
// wholesale on save.
[ApiController]
[Authorize(Policy = "Admin")]
public class SsoSettingsController(TracklyDbContext db, ISecretProtector secrets) : ControllerBase
{
    public record GroupMappingDto(string GroupName, string TracklyRole);

    public record SaveSsoRequest(
        string ProviderName,
        string Protocol,
        string? DiscoveryEndpoint,
        string? ClientId,
        string? ClientSecret,
        string? IdpMetadataUrl,
        string? IdpMetadataXml,
        string? SpEntityId,
        List<GroupMappingDto>? GroupMappings);

    [HttpGet("api/admin/sso")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var conn = await LoadAsync(ct);
        return Ok(conn is null ? null : ToResponse(conn));
    }

    [HttpPut("api/admin/sso")]
    public async Task<IActionResult> Save([FromBody] SaveSsoRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.ProviderName))
            return BadRequest(new { error = "Provider name is required." });
        if (!SsoProtocol.All.Contains(req.Protocol))
            return BadRequest(new { error = "Protocol must be 'oidc' or 'saml'." });

        if (req.Protocol == SsoProtocol.Oidc)
        {
            if (string.IsNullOrWhiteSpace(req.DiscoveryEndpoint) || string.IsNullOrWhiteSpace(req.ClientId))
                return BadRequest(new { error = "OIDC requires a discovery endpoint and client ID." });
            if (!Uri.TryCreate(req.DiscoveryEndpoint, UriKind.Absolute, out _))
                return BadRequest(new { error = "Discovery endpoint must be an absolute URL." });
        }
        else if (string.IsNullOrWhiteSpace(req.IdpMetadataUrl) && string.IsNullOrWhiteSpace(req.IdpMetadataXml))
        {
            return BadRequest(new { error = "SAML requires IdP metadata (URL or XML)." });
        }

        foreach (var m in req.GroupMappings ?? [])
            if (!TracklyRoles.All.Contains(m.TracklyRole))
                return BadRequest(new { error = $"Invalid role in mapping: {m.TracklyRole}." });

        var workspaceId = User.GetWorkspaceId();
        var conn = await db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (conn is null)
        {
            conn = new SsoConnection { WorkspaceId = workspaceId };
            db.SsoConnections.Add(conn);
        }

        conn.ProviderName = req.ProviderName.Trim();
        conn.Protocol = req.Protocol;
        conn.DiscoveryEndpoint = NullIfEmpty(req.DiscoveryEndpoint);
        conn.ClientId = NullIfEmpty(req.ClientId);
        // null keeps the stored secret, "" clears it, any value is encrypted.
        conn.ClientSecretEncrypted = req.ClientSecret switch
        {
            null => conn.ClientSecretEncrypted,
            "" => null,
            _ => secrets.Protect(req.ClientSecret),
        };
        conn.IdpMetadataUrl = NullIfEmpty(req.IdpMetadataUrl);
        conn.IdpMetadataXml = NullIfEmpty(req.IdpMetadataXml);
        conn.SpEntityId = NullIfEmpty(req.SpEntityId);
        conn.UpdatedAt = DateTime.UtcNow;

        // Replace mappings wholesale.
        db.SsoGroupRoleMappings.RemoveRange(conn.GroupMappings);
        conn.GroupMappings = (req.GroupMappings ?? [])
            .Where(m => !string.IsNullOrWhiteSpace(m.GroupName))
            .Select(m => new SsoGroupRoleMapping { GroupName = m.GroupName.Trim(), TracklyRole = m.TracklyRole })
            .ToList();

        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(conn));
    }

    [HttpDelete("api/admin/sso")]
    public async Task<IActionResult> Delete(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        await db.SsoConnections.Where(c => c.WorkspaceId == workspaceId).ExecuteDeleteAsync(ct);
        return NoContent();
    }

    private Task<SsoConnection?> LoadAsync(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        return db.SsoConnections
            .Include(c => c.GroupMappings)
            .SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
    }

    private static object ToResponse(SsoConnection c) => new
    {
        providerName = c.ProviderName,
        protocol = c.Protocol,
        discoveryEndpoint = c.DiscoveryEndpoint,
        clientId = c.ClientId,
        hasClientSecret = !string.IsNullOrEmpty(c.ClientSecretEncrypted),
        idpMetadataUrl = c.IdpMetadataUrl,
        idpMetadataXml = c.IdpMetadataXml,
        spEntityId = c.SpEntityId,
        status = c.Status,
        testedAt = c.TestedAt,
        groupMappings = c.GroupMappings
            .Select(m => new { groupName = m.GroupName, tracklyRole = m.TracklyRole })
            .ToList(),
    };

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
