using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Trackly.Api.Chat;
using Trackly.Modules.Chat;

namespace Trackly.Api.Controllers;

// Visitor-facing live chat. Anonymous; each call is authenticated by the session
// token minted at start. Customer-facing surface — always the workspace brand.
[ApiController]
[AllowAnonymous]
public class PublicChatController(ChatService chat, IHubContext<ChatHub> hub) : ControllerBase
{
    public record StartRequest(string WorkspaceSlug, string? Name, string? Email);
    public record MessageRequest(string Body);

    [HttpPost("api/public/chat/start")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Start([FromBody] StartRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.WorkspaceSlug))
            return BadRequest(new { error = "workspaceSlug is required." });

        var result = await chat.StartAsync(req.WorkspaceSlug, req.Name, req.Email, ct);
        if (result is null) return NotFound(new { error = "Workspace not found." });

        // Let agents watching the lobby see the new session appear live.
        var thread = await chat.GetForVisitorAsync(result.SessionId, result.Token, ct);
        if (thread is not null)
            await hub.Clients.Group(ChatHub.Lobby(result.WorkspaceId)).SendAsync("session", thread.Session, ct);

        return Ok(new { sessionId = result.SessionId, token = result.Token });
    }

    [HttpGet("api/public/chat/{sessionId:guid}/messages")]
    public async Task<IActionResult> Messages(Guid sessionId, [FromQuery] string? token, CancellationToken ct)
    {
        var thread = await chat.GetForVisitorAsync(sessionId, token ?? "", ct);
        return thread is null ? NotFound() : Ok(thread);
    }

    [HttpPost("api/public/chat/{sessionId:guid}/messages")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Post(Guid sessionId, [FromQuery] string? token, [FromBody] MessageRequest req, CancellationToken ct)
    {
        var posted = await chat.PostVisitorAsync(sessionId, token ?? "", req.Body ?? "", ct);
        if (posted is null) return NotFound(new { error = "Chat not found or already ended." });

        await hub.Clients.Group(ChatHub.SessionGroup(sessionId)).SendAsync("message", posted.Value.Message, ct);

        // And to the workspace lobby, so agents who are NOT in this session hear
        // about it. Without this an agent who answered once and navigated away
        // never learns the visitor wrote back — the session group only reaches
        // whoever has the conversation open. A separate event name from
        // "message" because the payload is a nudge, not the thread: an agent
        // watching the lobby has no business receiving message bodies for
        // conversations they have not opened.
        await hub.Clients.Group(ChatHub.Lobby(posted.Value.WorkspaceId))
            .SendAsync("visitorMessage", new { sessionId }, ct);

        return Ok(posted.Value.Message);
    }

    [HttpPost("api/public/chat/{sessionId:guid}/end")]
    public async Task<IActionResult> End(Guid sessionId, [FromQuery] string? token, CancellationToken ct)
    {
        var result = await chat.EndForVisitorAsync(sessionId, token ?? "", ct);
        if (result is null) return NotFound();
        await BroadcastEndAsync(sessionId, result, ct);
        return Ok(new { ticketId = result.TicketId });
    }

    private async Task BroadcastEndAsync(Guid sessionId, ChatEndResult result, CancellationToken ct)
    {
        await hub.Clients.Group(ChatHub.SessionGroup(sessionId)).SendAsync("ended", new { sessionId, result.TicketId }, ct);
        await hub.Clients.Group(ChatHub.Lobby(result.WorkspaceId)).SendAsync("ended", new { sessionId, result.TicketId }, ct);
    }
}
