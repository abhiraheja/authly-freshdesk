using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;

namespace Trackly.Api.Tickets;

/// <summary>
/// Live delivery to the desk: a customer replies from the portal, the widget or
/// an email, and the agent looking at that ticket sees it without reloading.
///
/// <para>
/// A relay only. Nothing is persisted here and nothing is read here — the screen
/// re-fetches through the ticket endpoints, which is where workspace isolation
/// and the private-note rules live. A socket that carried comment bodies would
/// be a second place those rules have to be right, and the one most likely to
/// forget <c>is_internal</c>.
/// </para>
/// <para>
/// One group per workspace rather than one per ticket. An agent moves between
/// tickets constantly, and a per-ticket join would need a round trip on every
/// navigation to receive anything; the client already knows which ticket it is
/// showing and ignores ids that are not it. The group is workspace-scoped
/// because the notification is workspace data (invariant 1).
/// </para>
/// </summary>
[Authorize]
public class TicketHub : Hub
{
    public static string WorkspaceGroup(Guid workspaceId) => $"tickets:{workspaceId}";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;

        // Staff only. A customer holds a perfectly valid session, so
        // `[Authorize]` alone would put them in the group and tell them every
        // time any ticket in the workspace moved — including tickets that are
        // not theirs. Role is Trackly's to decide (invariant 2), and this is the
        // check that applies it.
        if (user?.Identity?.IsAuthenticated == true
            && (user.IsInRole(TracklyRoles.Agent) || user.IsInRole(TracklyRoles.Admin)))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, WorkspaceGroup(user.GetWorkspaceId()));
        }

        await base.OnConnectedAsync();
    }
}

/// <summary>
/// The transport behind <see cref="ITicketRealtime"/>. Lives in the API because
/// that is where the hub is; the modules that fire it only know the interface.
/// </summary>
public class TicketHubRealtime(
    IHubContext<TicketHub> hub,
    ILogger<TicketHubRealtime> logger) : ITicketRealtime
{
    public async Task TicketUpdatedAsync(Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        try
        {
            await hub.Clients.Group(TicketHub.WorkspaceGroup(workspaceId))
                .SendAsync("ticket", new { ticketId }, ct);
        }
        catch (Exception ex)
        {
            // Best-effort by contract: a failed push costs the agent a manual
            // refresh and must never fail the reply that triggered it.
            logger.LogWarning(ex, "Ticket realtime push failed for ticket {TicketId}", ticketId);
        }
    }
}
