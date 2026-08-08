using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

/// <summary>
/// The lists hanging off one ticket: related tickets, tasks, responders, assets,
/// impacted services and the workspace's own custom properties.
///
/// Split out of <see cref="TicketsController"/> because that file is already the
/// ticket's CRUD, comments, tags, time, links and watchers, and six more
/// sub-resources on it stops being a controller and becomes a directory.
///
/// **Every route here is agent/admin.** Each answers an internal question — what
/// else is broken, who else is on it, which machine it is about — and several
/// carry other customers' ticket subjects (invariant 5).
/// </summary>
[ApiController]
[Route("api/tickets/{id:guid}")]
[Authorize(Policy = "AgentOrAdmin")]
public class TicketDetailController(
    TicketRelationService relations,
    TicketTaskService tasks,
    AssetService assets,
    TicketFieldService fields) : ControllerBase
{
    public record AddRelationRequest(Guid RelatedTicketId, string Kind);

    public record CreateTaskRequest(string Title, Guid? AssigneeId, DateTime? DueAt);

    public record SaveTaskRequest(
        string? Title, Guid? AssigneeId, bool ClearAssignee,
        DateTime? DueAt, bool ClearDueAt, bool? Completed);

    public record AddResponderRequest(string? Role);

    public record SetImpactRequest(string? Impact, string? Level);

    public record SaveFieldsRequest(Dictionary<Guid, string?> Values);

    // ---- Related tickets ------------------------------------------------------

    [HttpGet("relations")]
    public async Task<IActionResult> Relations(Guid id, CancellationToken ct)
        => await relations.ListAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    [HttpPost("relations")]
    public async Task<IActionResult> AddRelation(
        Guid id, [FromBody] AddRelationRequest request, CancellationToken ct)
    {
        var created = await relations.AddAsync(
            User.GetActor(), id, request.RelatedTicketId, request.Kind, ct);
        return created is null ? NotFound() : StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpDelete("relations/{relationId:guid}")]
    public async Task<IActionResult> DeleteRelation(Guid id, Guid relationId, CancellationToken ct)
        => await relations.DeleteAsync(User.GetActor(), id, relationId, ct) ? NoContent() : NotFound();

    // ---- Tasks ----------------------------------------------------------------

    [HttpGet("tasks")]
    public async Task<IActionResult> Tasks(Guid id, CancellationToken ct)
        => await tasks.ListAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    [HttpPost("tasks")]
    public async Task<IActionResult> CreateTask(
        Guid id, [FromBody] CreateTaskRequest request, CancellationToken ct)
    {
        var created = await tasks.CreateAsync(
            User.GetActor(), id, request.Title, request.AssigneeId, request.DueAt, ct);
        return created is null ? NotFound() : StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("tasks/{taskId:guid}")]
    public async Task<IActionResult> SaveTask(
        Guid id, Guid taskId, [FromBody] SaveTaskRequest request, CancellationToken ct)
    {
        var saved = await tasks.UpdateAsync(
            User.GetActor(), id, taskId, request.Title, request.AssigneeId, request.ClearAssignee,
            request.DueAt, request.ClearDueAt, request.Completed, ct);
        return saved is null ? NotFound() : Ok(saved);
    }

    [HttpDelete("tasks/{taskId:guid}")]
    public async Task<IActionResult> DeleteTask(Guid id, Guid taskId, CancellationToken ct)
        => await tasks.DeleteAsync(User.GetActor(), id, taskId, ct) ? NoContent() : NotFound();

    // ---- Responders -----------------------------------------------------------

    [HttpGet("responders")]
    public async Task<IActionResult> Responders(Guid id, CancellationToken ct)
        => await tasks.RespondersAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    /// <summary>
    /// PUT, not POST: adding somebody already on the ticket edits their role,
    /// which makes this idempotent and saves the client a "do they exist" check
    /// before every save.
    /// </summary>
    [HttpPut("responders/{agentId:guid}")]
    public async Task<IActionResult> AddResponder(
        Guid id, Guid agentId, [FromBody] AddResponderRequest? request, CancellationToken ct)
        => await tasks.AddResponderAsync(User.GetActor(), id, agentId, request?.Role, ct)
            ? NoContent() : NotFound();

    [HttpDelete("responders/{agentId:guid}")]
    public async Task<IActionResult> RemoveResponder(Guid id, Guid agentId, CancellationToken ct)
        => await tasks.RemoveResponderAsync(User.GetActor(), id, agentId, ct) ? NoContent() : NotFound();

    // ---- Assets ---------------------------------------------------------------

    [HttpGet("assets")]
    public async Task<IActionResult> Assets(Guid id, CancellationToken ct)
        => await assets.TicketAssetsAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    [HttpPut("assets/{assetId:guid}")]
    public async Task<IActionResult> AttachAsset(Guid id, Guid assetId, CancellationToken ct)
        => await assets.AttachAssetAsync(User.GetActor(), id, assetId, ct) ? NoContent() : NotFound();

    [HttpDelete("assets/{assetId:guid}")]
    public async Task<IActionResult> DetachAsset(Guid id, Guid assetId, CancellationToken ct)
        => await assets.DetachAssetAsync(User.GetActor(), id, assetId, ct) ? NoContent() : NotFound();

    // ---- Impacted services -----------------------------------------------------

    [HttpGet("impacted-services")]
    public async Task<IActionResult> Impacted(Guid id, CancellationToken ct)
        => await assets.ImpactedAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    /// <summary>
    /// PUT for the same reason as responders: the first note during an incident
    /// is a guess, and refining it is an edit rather than a second entry.
    /// </summary>
    [HttpPut("impacted-services/{serviceId:guid}")]
    public async Task<IActionResult> SetImpact(
        Guid id, Guid serviceId, [FromBody] SetImpactRequest? request, CancellationToken ct)
        => await assets.SetImpactAsync(User.GetActor(), id, serviceId, request?.Impact, request?.Level, ct)
            ? NoContent() : NotFound();

    [HttpDelete("impacted-services/{serviceId:guid}")]
    public async Task<IActionResult> ClearImpact(Guid id, Guid serviceId, CancellationToken ct)
        => await assets.ClearImpactAsync(User.GetActor(), id, serviceId, ct) ? NoContent() : NotFound();

    // ---- Custom properties -------------------------------------------------------

    /// <summary>
    /// Every field with this ticket's answer, so the form renders from one call
    /// instead of the client joining two lists and getting the outer join wrong.
    /// </summary>
    [HttpGet("fields")]
    public async Task<IActionResult> Fields(Guid id, CancellationToken ct)
        => await fields.ForTicketAsync(User.GetActor(), id, ct) is { } list ? Ok(list) : NotFound();

    [HttpPut("fields")]
    public async Task<IActionResult> SaveFields(
        Guid id, [FromBody] SaveFieldsRequest request, CancellationToken ct)
    {
        var saved = await fields.SaveAsync(User.GetActor(), id, request.Values ?? [], ct);
        return saved is null ? NotFound() : Ok(saved);
    }
}
