using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Admin-only AI copilot settings. `configured` reflects the deployment-level API
// key; `enabled` is the per-workspace kill switch. The copilot is usable only
// when both are true (invariant: a workspace can always disable AI entirely).
[ApiController]
[Route("api/admin/ai")]
[Authorize(Policy = "Admin")]
public class AiSettingsController(TracklyDbContext db, IAiCopilot copilot) : ControllerBase
{
    public record UpdateAiRequest(bool Enabled);

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var enabled = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.AiEnabled).SingleAsync(ct);
        return Ok(new { enabled, configured = copilot.IsConfigured });
    }

    [HttpPut]
    public async Task<IActionResult> Update([FromBody] UpdateAiRequest req, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        await db.Workspaces.Where(w => w.Id == workspaceId)
            .ExecuteUpdateAsync(s => s.SetProperty(w => w.AiEnabled, req.Enabled), ct);
        return Ok(new { enabled = req.Enabled, configured = copilot.IsConfigured });
    }
}
