using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules;
using Trackly.Modules.Ai;

namespace Trackly.Api.Controllers;

// AI copilot actions on a ticket. Agent/admin only. Every result is a
// suggestion returned to the agent — nothing here sends anything to a customer.
// Availability (deployment key + per-workspace toggle) is enforced server-side:
// a disabled workspace gets 409, never a silent call to the model.
[ApiController]
[Route("api/tickets/{ticketId:guid}/ai")]
[Authorize(Policy = "AgentOrAdmin")]
public class AiController(AiService ai) : ControllerBase
{
    // Agent-facing availability probe (the admin settings endpoint is admin-only).
    // Lets the agent UI show or hide the ✨ actions without exposing settings.
    [HttpGet("/api/ai/available")]
    public async Task<IActionResult> Available(CancellationToken ct)
        => Ok(new { available = await ai.IsAvailableAsync(User.GetActor().WorkspaceId, ct) });

    [HttpPost("draft-reply")]
    public Task<IActionResult> DraftReply(Guid ticketId, CancellationToken ct)
        => RunAsync(ticketId, ct, (a, id, c) => ai.DraftReplyAsync(a, id, c), r => new { draft = r });

    [HttpPost("summary")]
    public Task<IActionResult> Summarize(Guid ticketId, CancellationToken ct)
        => RunAsync(ticketId, ct, (a, id, c) => ai.SummarizeAsync(a, id, c), r => new { summary = r });

    private async Task<IActionResult> RunAsync(
        Guid ticketId,
        CancellationToken ct,
        Func<Actor, Guid, CancellationToken, Task<string>> op,
        Func<string, object> shape)
    {
        var actor = User.GetActor();
        if (!await ai.IsAvailableAsync(actor.WorkspaceId, ct))
            return Conflict(new { error = "AI copilot is not available for this workspace." });

        var result = await op(actor, ticketId, ct);
        return AiService.IsNotFound(result) ? NotFound() : Ok(shape(result));
    }
}
