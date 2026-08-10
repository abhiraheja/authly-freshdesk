using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Releases;

/// <summary>
/// Live delivery for a release that is being run.
///
/// This exists for the one failure the wiki page could never fix: four people
/// working the same checklist, each looking at a copy that stopped being true
/// twenty minutes ago. During the forty minutes when a release actually matters,
/// nobody is going to press refresh.
///
/// Delivery only. Every change is persisted by <c>ReleaseService</c> and the
/// controller broadcasts the resulting state afterwards, so the REST response
/// stays the source of truth and a dropped socket costs a stale panel, never a
/// lost tick. That is also why the payload is the whole release rather than a
/// patch — a client that has missed a message must not have to reconstruct what
/// it missed.
///
/// Agents and admins only, and re-checked per release: joining a group is what
/// grants the stream, so it cannot be done by guessing an id.
/// </summary>
[Authorize(Policy = "AgentOrAdmin")]
public class ReleaseHub(TracklyDbContext db) : Hub
{
    public static string Group(Guid releaseId) => $"release:{releaseId}";

    /// <summary>
    /// Joins the release's group after confirming it belongs to the caller's
    /// workspace — invariant 1 applies to sockets exactly as it does to queries.
    /// </summary>
    public async Task JoinRelease(Guid releaseId)
    {
        var actor = Context.User!.GetActor();
        var exists = await db.Releases.AnyAsync(
            r => r.Id == releaseId && r.WorkspaceId == actor.WorkspaceId, Context.ConnectionAborted);
        if (!exists) return;

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(releaseId));
    }

    /// <summary>
    /// Leaving is not strictly required — SignalR drops group membership when the
    /// connection ends — but navigating between two releases on one connection
    /// would otherwise leave the first one still delivering.
    /// </summary>
    public Task LeaveRelease(Guid releaseId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(releaseId));
}
