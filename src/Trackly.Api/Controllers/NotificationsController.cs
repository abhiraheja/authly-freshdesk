using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Notifications;

namespace Trackly.Api.Controllers;

/// <summary>
/// The bell.
///
/// Every route is scoped to the caller and never takes a user id — there is no
/// way to ask for somebody else's notifications, because there is no shape of
/// request that could express it.
/// </summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController(NotificationFeed feed) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool unreadOnly, CancellationToken ct)
        => Ok(await feed.ListAsync(User.GetActor(), unreadOnly, ct));

    /// <summary>Just the number, for the badge — the list is a much heavier read.</summary>
    [HttpGet("unread-count")]
    public async Task<IActionResult> UnreadCount(CancellationToken ct)
        => Ok(new { count = await feed.UnreadCountAsync(User.GetActor(), ct) });

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        // NotFound on an already-read row would be a lie — it exists. The write
        // is a no-op and NoContent is the truthful answer either way.
        await feed.MarkReadAsync(User.GetActor(), id, ct);
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct)
    {
        await feed.MarkAllReadAsync(User.GetActor(), ct);
        return NoContent();
    }
}
