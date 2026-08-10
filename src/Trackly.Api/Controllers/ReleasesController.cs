using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
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
public class ReleasesController(ReleaseService releases) : ControllerBase
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
        => Found(await releases.UpdateAsync(User.GetActor(), id, req, ct));

    [HttpPost("{id:guid}/status")]
    public async Task<IActionResult> SetStatus(Guid id, [FromBody] SetReleaseStatusRequest req, CancellationToken ct)
        => Found(await releases.SetStatusAsync(User.GetActor(), id, req.Status, ct));

    [HttpPost("{id:guid}/clone")]
    public async Task<IActionResult> Clone(Guid id, [FromBody] CloneReleaseRequest req, CancellationToken ct)
        => Found(await releases.CloneAsync(User.GetActor(), id, req, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await releases.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    // ── Components ───────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/components")]
    public async Task<IActionResult> AddComponent(Guid id, [FromBody] AddComponentRequest req, CancellationToken ct)
        => Found(await releases.AddComponentAsync(User.GetActor(), id, req, ct));

    [HttpPatch("components/{componentId:guid}")]
    public async Task<IActionResult> UpdateComponent(
        Guid componentId, [FromBody] UpdateComponentRequest req, CancellationToken ct)
        => Found(await releases.UpdateComponentAsync(User.GetActor(), componentId, req, ct));

    [HttpPost("components/{componentId:guid}/status")]
    public async Task<IActionResult> SetComponentStatus(
        Guid componentId, [FromBody] SetComponentStatusRequest req, CancellationToken ct)
        => Found(await releases.SetComponentStatusAsync(User.GetActor(), componentId, req, ct));

    [HttpDelete("components/{componentId:guid}")]
    public async Task<IActionResult> RemoveComponent(Guid componentId, CancellationToken ct)
        => Found(await releases.RemoveComponentAsync(User.GetActor(), componentId, ct));

    // ── Steps ────────────────────────────────────────────────────────────────

    [HttpPost("components/{componentId:guid}/steps")]
    public async Task<IActionResult> AddStep(Guid componentId, [FromBody] AddStepRequest req, CancellationToken ct)
        => Found(await releases.AddStepAsync(User.GetActor(), componentId, req, ct));

    [HttpPatch("steps/{stepId:guid}")]
    public async Task<IActionResult> UpdateStep(Guid stepId, [FromBody] UpdateStepRequest req, CancellationToken ct)
        => Found(await releases.UpdateStepAsync(User.GetActor(), stepId, req, ct));

    [HttpPost("steps/{stepId:guid}/status")]
    public async Task<IActionResult> SetStepStatus(Guid stepId, [FromBody] SetStepStatusRequest req, CancellationToken ct)
        => Found(await releases.SetStepStatusAsync(User.GetActor(), stepId, req, ct));

    [HttpDelete("steps/{stepId:guid}")]
    public async Task<IActionResult> RemoveStep(Guid stepId, CancellationToken ct)
        => Found(await releases.RemoveStepAsync(User.GetActor(), stepId, ct));

    // ── Work items ───────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/items")]
    public async Task<IActionResult> AddWorkItem(Guid id, [FromBody] AddWorkItemRequest req, CancellationToken ct)
        => Found(await releases.AddWorkItemAsync(User.GetActor(), id, req, ct));

    [HttpPatch("items/{itemId:guid}")]
    public async Task<IActionResult> UpdateWorkItem(
        Guid itemId, [FromBody] UpdateWorkItemRequest req, CancellationToken ct)
        => Found(await releases.UpdateWorkItemAsync(User.GetActor(), itemId, req, ct));

    [HttpPost("items/{itemId:guid}/test")]
    public async Task<IActionResult> SetWorkItemTest(
        Guid itemId, [FromBody] SetWorkItemTestRequest req, CancellationToken ct)
        => Found(await releases.SetWorkItemTestAsync(User.GetActor(), itemId, req, ct));

    [HttpPost("items/{itemId:guid}/verify")]
    public async Task<IActionResult> SetWorkItemVerify(
        Guid itemId, [FromBody] SetWorkItemVerifyRequest req, CancellationToken ct)
        => Found(await releases.SetWorkItemVerifyAsync(User.GetActor(), itemId, req, ct));

    [HttpDelete("items/{itemId:guid}")]
    public async Task<IActionResult> RemoveWorkItem(Guid itemId, CancellationToken ct)
        => Found(await releases.RemoveWorkItemAsync(User.GetActor(), itemId, ct));

    /// <summary>Which releases a ticket is shipping in — read from the ticket screen.</summary>
    [HttpGet("for-ticket/{ticketId:guid}")]
    public async Task<IActionResult> ForTicket(Guid ticketId, CancellationToken ct)
        => Ok(await releases.ForTicketAsync(User.GetActor(), ticketId, ct));

    // Every mutation returns the whole release: a step tick can move the
    // component's status and the release's own, and a client that had to
    // reassemble that from a partial response would get it wrong on the one
    // screen where four people are watching the same list.
    private IActionResult Found(ReleaseDetailDto? release)
        => release is null ? NotFound() : Ok(release);
}
