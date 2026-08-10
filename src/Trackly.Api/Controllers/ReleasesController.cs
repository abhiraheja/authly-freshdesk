using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Trackly.Api.Auth;
using Trackly.Api.Releases;
using Trackly.Modules.Releases;

namespace Trackly.Api.Controllers;

/// <summary>
/// Release plans. Internal — a release is how the workspace ships, not something
/// a customer has any business reading.
///
/// Agents get the same verbs as admins on purpose. The person who runs the
/// pipeline for a service is the person who should tick it off, and making them
/// ask an admin is how a checklist stops being ticked at all. Every mutation is
/// written to the release's activity log with the actor's name, so the record is
/// what provides accountability — not the permission wall. Only deleting a
/// release is admin-only, and only while it has not shipped.
/// </summary>
[ApiController]
[Route("api/releases")]
[Authorize(Policy = "AgentOrAdmin")]
public class ReleasesController(ReleaseService releases, IHubContext<ReleaseHub> hub) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status, CancellationToken ct)
        => Ok(await releases.ListAsync(User.GetActor(), status, ct));

    /// <summary>Read by everyone (the plan renders links with it), written by admins.</summary>
    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings(CancellationToken ct)
        => Ok(await releases.GetSettingsAsync(User.GetActor(), ct));

    [HttpPut("settings")]
    public async Task<IActionResult> SaveSettings([FromBody] ReleaseSettingsDto req, CancellationToken ct)
        => Ok(await releases.SaveSettingsAsync(User.GetActor(), req, ct));

    // Declared after "settings" so the literal route wins — {id:guid} would not
    // match "settings" anyway, but keeping them in this order makes that obvious
    // to the next person rather than a constraint they have to go and check.
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        => Found(await releases.GetAsync(User.GetActor(), id, ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateReleaseRequest req, CancellationToken ct)
    {
        var release = await releases.CreateAsync(User.GetActor(), req, ct);
        return CreatedAtAction(nameof(Get), new { id = release.Id }, release);
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateReleaseRequest req, CancellationToken ct)
        => await FoundAsync(await releases.UpdateAsync(User.GetActor(), id, req, ct), ct);

    [HttpPost("{id:guid}/status")]
    public async Task<IActionResult> SetStatus(Guid id, [FromBody] SetReleaseStatusRequest req, CancellationToken ct)
        => await FoundAsync(await releases.SetStatusAsync(User.GetActor(), id, req.Status, req.ResolveTickets, ct), ct);

    [HttpPost("{id:guid}/clone")]
    public async Task<IActionResult> Clone(Guid id, [FromBody] CloneReleaseRequest req, CancellationToken ct)
        => await FoundAsync(await releases.CloneAsync(User.GetActor(), id, req, ct), ct);

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await releases.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    // ── Components ───────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/components")]
    public async Task<IActionResult> AddComponent(Guid id, [FromBody] AddComponentRequest req, CancellationToken ct)
        => await FoundAsync(await releases.AddComponentAsync(User.GetActor(), id, req, ct), ct);

    [HttpPatch("components/{componentId:guid}")]
    public async Task<IActionResult> UpdateComponent(
        Guid componentId, [FromBody] UpdateComponentRequest req, CancellationToken ct)
        => await FoundAsync(await releases.UpdateComponentAsync(User.GetActor(), componentId, req, ct), ct);

    [HttpPost("components/{componentId:guid}/status")]
    public async Task<IActionResult> SetComponentStatus(
        Guid componentId, [FromBody] SetComponentStatusRequest req, CancellationToken ct)
        => await FoundAsync(await releases.SetComponentStatusAsync(User.GetActor(), componentId, req, ct), ct);

    [HttpDelete("components/{componentId:guid}")]
    public async Task<IActionResult> RemoveComponent(Guid componentId, CancellationToken ct)
        => await FoundAsync(await releases.RemoveComponentAsync(User.GetActor(), componentId, ct), ct);

    // ── Steps ────────────────────────────────────────────────────────────────

    [HttpPost("components/{componentId:guid}/steps")]
    public async Task<IActionResult> AddStep(Guid componentId, [FromBody] AddStepRequest req, CancellationToken ct)
        => await FoundAsync(await releases.AddStepAsync(User.GetActor(), componentId, req, ct), ct);

    [HttpPatch("steps/{stepId:guid}")]
    public async Task<IActionResult> UpdateStep(Guid stepId, [FromBody] UpdateStepRequest req, CancellationToken ct)
        => await FoundAsync(await releases.UpdateStepAsync(User.GetActor(), stepId, req, ct), ct);

    [HttpPost("steps/{stepId:guid}/status")]
    public async Task<IActionResult> SetStepStatus(Guid stepId, [FromBody] SetStepStatusRequest req, CancellationToken ct)
        => await FoundAsync(await releases.SetStepStatusAsync(User.GetActor(), stepId, req, ct), ct);

    [HttpDelete("steps/{stepId:guid}")]
    public async Task<IActionResult> RemoveStep(Guid stepId, CancellationToken ct)
        => await FoundAsync(await releases.RemoveStepAsync(User.GetActor(), stepId, ct), ct);

    // ── Work items ───────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/items")]
    public async Task<IActionResult> AddWorkItem(Guid id, [FromBody] AddWorkItemRequest req, CancellationToken ct)
        => await FoundAsync(await releases.AddWorkItemAsync(User.GetActor(), id, req, ct), ct);

    [HttpPatch("items/{itemId:guid}")]
    public async Task<IActionResult> UpdateWorkItem(
        Guid itemId, [FromBody] UpdateWorkItemRequest req, CancellationToken ct)
        => await FoundAsync(await releases.UpdateWorkItemAsync(User.GetActor(), itemId, req, ct), ct);

    [HttpPost("items/{itemId:guid}/test")]
    public async Task<IActionResult> SetWorkItemTest(
        Guid itemId, [FromBody] SetWorkItemTestRequest req, CancellationToken ct)
        => await FoundAsync(await releases.SetWorkItemTestAsync(User.GetActor(), itemId, req, ct), ct);

    [HttpPost("items/{itemId:guid}/verify")]
    public async Task<IActionResult> SetWorkItemVerify(
        Guid itemId, [FromBody] SetWorkItemVerifyRequest req, CancellationToken ct)
        => await FoundAsync(await releases.SetWorkItemVerifyAsync(User.GetActor(), itemId, req, ct), ct);

    [HttpDelete("items/{itemId:guid}")]
    public async Task<IActionResult> RemoveWorkItem(Guid itemId, CancellationToken ct)
        => await FoundAsync(await releases.RemoveWorkItemAsync(User.GetActor(), itemId, ct), ct);

    /// <summary>Which releases a ticket is shipping in — read from the ticket screen.</summary>
    [HttpGet("for-ticket/{ticketId:guid}")]
    public async Task<IActionResult> ForTicket(Guid ticketId, CancellationToken ct)
        => Ok(await releases.ForTicketAsync(User.GetActor(), ticketId, ct));

    // Every mutation returns the whole release: a step tick can move the
    // component's status and the release's own, and a client that had to
    // reassemble that from a partial response would get it wrong on the one
    // screen where four people are watching the same list.
    //
    // The same state also goes out over the hub, from here rather than from each
    // endpoint — fifteen call sites each remembering to broadcast is fourteen
    // chances to forget, and the one that forgets is the one somebody is staring
    // at during a deployment.
    private async Task<IActionResult> FoundAsync(ReleaseDetailDto? release, CancellationToken ct)
    {
        if (release is null) return NotFound();
        await Broadcast(release, ct);
        return Ok(release);
    }

    // Reads must not broadcast: GET is what a newly-joined client calls, and
    // echoing it back to everyone else would repaint their screens for nothing.
    private IActionResult Found(ReleaseDetailDto? release)
        => release is null ? NotFound() : Ok(release);

    /// <summary>
    /// Fire and forget by design: a socket nobody is listening on must never
    /// fail the write that already succeeded.
    /// </summary>
    private async Task Broadcast(ReleaseDetailDto release, CancellationToken ct)
    {
        try
        {
            await hub.Clients.Group(ReleaseHub.Group(release.Id))
                .SendAsync("releaseUpdated", release, ct);
        }
        catch (Exception)
        {
            // Delivery is best-effort; the REST response is the source of truth.
        }
    }
}
