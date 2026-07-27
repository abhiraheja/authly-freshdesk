using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Admin management of messaging connectors. The signing secret is write-only —
// it is AES-256-GCM encrypted at rest and never returned (only hasSecret).
[ApiController]
[Route("api/admin/channels")]
[Authorize(Policy = "Admin")]
public class ChannelsController(TracklyDbContext db, ISecretProtector secrets) : ControllerBase
{
    public record ConnectorDto(string Provider, bool Enabled, bool HasSecret);
    public record UpsertConnectorRequest(bool Enabled, string? Secret);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var ws = User.GetWorkspaceId();
        var existing = await db.ChannelConnectors.Where(c => c.WorkspaceId == ws).ToListAsync(ct);
        // One row per supported provider, whether configured yet or not.
        var rows = ChannelProvider.All.Select(p =>
        {
            var c = existing.FirstOrDefault(x => x.Provider == p);
            return new ConnectorDto(p, c?.Enabled ?? false, c?.SigningSecretEncrypted is { Length: > 0 });
        });
        return Ok(rows);
    }

    [HttpPut("{provider}")]
    public async Task<IActionResult> Upsert(string provider, [FromBody] UpsertConnectorRequest req, CancellationToken ct)
    {
        if (!ChannelProvider.All.Contains(provider)) return NotFound();

        var ws = User.GetWorkspaceId();
        var c = await db.ChannelConnectors.SingleOrDefaultAsync(x => x.WorkspaceId == ws && x.Provider == provider, ct);
        if (c is null)
        {
            c = new ChannelConnector { WorkspaceId = ws, Provider = provider };
            db.ChannelConnectors.Add(c);
        }

        c.Enabled = req.Enabled;
        // Blank secret leaves the stored one untouched (write-only rotation).
        if (!string.IsNullOrWhiteSpace(req.Secret))
            c.SigningSecretEncrypted = secrets.Protect(req.Secret.Trim());
        c.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(new ConnectorDto(provider, c.Enabled, c.SigningSecretEncrypted is { Length: > 0 }));
    }
}
