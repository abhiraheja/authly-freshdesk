using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Trackly.Api.Auth;
using Trackly.Api.Chat;
using Trackly.Modules.Chat;

namespace Trackly.Api.Controllers;

// Agent-facing live chat console. Workspace-scoped via the actor.
[ApiController]
[Route("api/chat")]
[Authorize(Policy = "AgentOrAdmin")]
public class ChatController(ChatService chat, IHubContext<ChatHub> hub) : ControllerBase
{
    public record MessageRequest(string Body);

    [HttpGet("sessions")]
    public async Task<IActionResult> Sessions(CancellationToken ct)
        => Ok(await chat.ListActiveAsync(User.GetActor(), ct));

    [HttpGet("sessions/{id:guid}/messages")]
    public async Task<IActionResult> Messages(Guid id, CancellationToken ct)
    {
        var thread = await chat.GetForAgentAsync(User.GetActor(), id, ct);
        return thread is null ? NotFound() : Ok(thread);
    }

    [HttpPost("sessions/{id:guid}/messages")]
    public async Task<IActionResult> Post(Guid id, [FromBody] MessageRequest req, CancellationToken ct)
    {
        var msg = await chat.PostAgentAsync(User.GetActor(), id, req.Body ?? "", ct);
        if (msg is null) return NotFound(new { error = "Chat not found or already ended." });

        await hub.Clients.Group(ChatHub.SessionGroup(id)).SendAsync("message", msg, ct);
        return Ok(msg);
    }

    [HttpPost("sessions/{id:guid}/end")]
    public async Task<IActionResult> End(Guid id, CancellationToken ct)
    {
        var result = await chat.EndForAgentAsync(User.GetActor(), id, ct);
        if (result is null) return NotFound();

        await hub.Clients.Group(ChatHub.SessionGroup(id)).SendAsync("ended", new { sessionId = id, result.TicketId }, ct);
        await hub.Clients.Group(ChatHub.Lobby(result.WorkspaceId)).SendAsync("ended", new { sessionId = id, result.TicketId }, ct);
        return Ok(new { ticketId = result.TicketId });
    }
}
