using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Modules.Chat;

namespace Trackly.Api.Chat;

// Real-time delivery for live chat. Persistence + validation live in ChatService;
// the hub is a pub/sub relay over session groups. Agents authenticate with the
// session cookie (same-origin WS handshake carries it); visitors present their
// session token in the connection query string. Messages are broadcast from the
// REST controllers via IHubContext after they are persisted.
[AllowAnonymous]
public class ChatHub(ChatService chat) : Hub
{
    public static string SessionGroup(Guid sessionId) => $"chat:{sessionId}";
    public static string Lobby(Guid workspaceId) => $"ws:{workspaceId}";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        if (user?.Identity?.IsAuthenticated == true
            && (user.IsInRole(TracklyRoles.Agent) || user.IsInRole(TracklyRoles.Admin)))
        {
            // Agents watch their workspace lobby for new/ended sessions.
            await Groups.AddToGroupAsync(Context.ConnectionId, Lobby(user.GetWorkspaceId()));
        }
        else
        {
            // Visitor: authenticate the connection against the session token.
            var http = Context.GetHttpContext();
            if (Guid.TryParse(http?.Request.Query["sessionId"], out var sid))
            {
                var token = http!.Request.Query["visitorToken"].ToString();
                if (await chat.IsVisitorValidAsync(sid, token, Context.ConnectionAborted))
                    await Groups.AddToGroupAsync(Context.ConnectionId, SessionGroup(sid));
            }
        }
        await base.OnConnectedAsync();
    }

    // An agent opens a specific session and joins its group to receive messages.
    public async Task JoinSession(Guid sessionId)
    {
        var user = Context.User;
        if (user?.Identity?.IsAuthenticated != true) return;
        if (await chat.AgentCanAccessAsync(user.GetActor(), sessionId, Context.ConnectionAborted))
            await Groups.AddToGroupAsync(Context.ConnectionId, SessionGroup(sessionId));
    }

    // Typing indicator — relayed to the other participants only, not persisted.
    public Task Typing(Guid sessionId, string sender, bool isTyping)
        => Clients.OthersInGroup(SessionGroup(sessionId)).SendAsync("typing", sender, isTyping);
}
