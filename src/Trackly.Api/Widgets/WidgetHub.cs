using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Widgets;
using Microsoft.EntityFrameworkCore;

namespace Trackly.Api.Widgets;

/// <summary>
/// Live delivery for the embedded panel: the agent replies, the launcher's
/// badge appears without waiting for the next poll.
///
/// <para>
/// A relay only. Nothing is persisted here and nothing is read here — the panel
/// re-fetches through <c>PublicWidgetController</c>, which is where the trust
/// rule and the private-note filter live. A socket that carried message bodies
/// would be a second place those rules have to be right.
/// </para>
/// <para>
/// The connection is authenticated exactly as the REST surface is: the widget's
/// public token names the widget, and the visitor token in the query string is
/// the credential. A connection that presents neither joins no group and
/// therefore receives nothing — it is not refused, because a widget on a page
/// that has not started a session yet is a perfectly ordinary state.
/// </para>
/// </summary>
[AllowAnonymous]
public class WidgetHub(WidgetPublicService widgets) : Hub
{
    /// <summary>One group per visitor row, so two devices are two groups.</summary>
    public static string VisitorGroup(Guid visitorId) => $"widget:{visitorId}";

    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext();
        var publicToken = http?.Request.Query["widget"].ToString() ?? "";
        var visitorToken = http?.Request.Query["visitorToken"].ToString() ?? "";

        if (publicToken.Length > 0 && visitorToken.Length > 0)
        {
            // Origin is not checked on the socket: a WebSocket handshake carries
            // Origin, but the visitor token was already issued over an
            // origin-checked POST and is the thing being trusted here. Re-checking
            // would only stop a caller who already holds a valid credential.
            var widget = await widgets.ResolveAsync(publicToken, origin: null, Context.ConnectionAborted);
            if (widget is not null)
            {
                var visitor = await widgets.FindVisitorAsync(widget, visitorToken, Context.ConnectionAborted);
                if (visitor is not null)
                    await Groups.AddToGroupAsync(Context.ConnectionId, VisitorGroup(visitor.Id));
            }
        }

        await base.OnConnectedAsync();
    }
}

/// <summary>
/// The transport behind <see cref="IWidgetRealtime"/>. Lives in the API because
/// that is where the hub is; the modules that fire it only know the interface.
/// </summary>
public class WidgetHubRealtime(
    IHubContext<WidgetHub> hub,
    TracklyDbContext db,
    ILogger<WidgetHubRealtime> logger) : IWidgetRealtime
{
    public async Task ConversationUpdatedAsync(Guid ticketId, CancellationToken ct)
    {
        try
        {
            var ticket = await db.Tickets
                .Where(t => t.Id == ticketId && t.WidgetVisitorId != null)
                .Select(t => new { t.WorkspaceId, t.WidgetVisitorId, t.RequesterId })
                .SingleOrDefaultAsync(ct);
            if (ticket is null) return;

            // The visitor who raised it, plus every other browser signed in as the
            // same proven contact — the phone in their pocket should light up too.
            // Unverified visitors are never included: their scope is one browser,
            // and a broadcast keyed on a claimed address would be the leak the
            // trust rule exists to prevent, arriving over a socket instead.
            var visitorIds = new List<Guid> { ticket.WidgetVisitorId!.Value };
            if (ticket.RequesterId is not null)
            {
                visitorIds.AddRange(await db.WidgetVisitors
                    .Where(v => v.WorkspaceId == ticket.WorkspaceId
                                && v.UserId == ticket.RequesterId
                                && v.IsVerified)
                    .Select(v => v.Id)
                    .ToListAsync(ct));
            }

            foreach (var visitorId in visitorIds.Distinct())
                await hub.Clients.Group(WidgetHub.VisitorGroup(visitorId))
                    .SendAsync("conversation", new { conversationId = ticketId }, ct);
        }
        catch (Exception ex)
        {
            // Best-effort by contract: the panel polls as well, so a failed push
            // costs a few seconds of latency and must never fail the reply that
            // triggered it.
            logger.LogWarning(ex, "Widget realtime push failed for ticket {TicketId}", ticketId);
        }
    }
}
