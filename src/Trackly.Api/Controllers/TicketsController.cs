using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Csat;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/tickets")]
[Authorize]
public class TicketsController(TicketService tickets, AttachmentService attachments, TagService tags, CsatService csat) : ControllerBase
{
    public record SetTagsRequest(List<string> Tags);

    // ---- Tags (agent/admin) ----

    [HttpPut("{id:guid}/tags")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> SetTags(Guid id, [FromBody] SetTagsRequest request, CancellationToken ct)
    {
        var result = await tags.SetTicketTagsAsync(User.GetActor(), id, request.Tags ?? [], ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] TicketListQuery query, CancellationToken ct)
    {
        var (items, total) = await tickets.ListAsync(User.GetActor(), query, ct);
        return Ok(new { items, total });
    }

    /// <summary>
    /// Counts for the filter rail. Takes the same query as the list above, so
    /// the client sends one filter state to two endpoints rather than keeping
    /// two shapes in step.
    /// </summary>
    [HttpGet("facets")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Facets([FromQuery] TicketListQuery query, CancellationToken ct)
        => Ok(await tickets.FacetsAsync(User.GetActor(), query, ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTicketRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Subject) || string.IsNullOrWhiteSpace(request.Description))
            return BadRequest(new { error = "Subject and description are required." });
        var ticket = await tickets.CreateAsync(User.GetActor(), request, ct);
        return CreatedAtAction(nameof(Get), new { id = ticket.Id }, ticket);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var ticket = await tickets.GetAsync(User.GetActor(), id, ct);
        return ticket is null ? NotFound() : Ok(ticket);
    }

    // Satisfaction result for a ticket (agent/admin). null ⇒ no survey issued yet.
    [HttpGet("{id:guid}/csat")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Csat(Guid id, CancellationToken ct)
    {
        var result = await csat.GetForTicketAsync(User.GetActor().WorkspaceId, id, ct);
        return result is null ? NoContent() : Ok(result);
    }

    [HttpPatch("{id:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTicketRequest request, CancellationToken ct)
    {
        var ticket = await tickets.UpdateAsync(User.GetActor(), id, request, ct);
        return ticket is null ? NotFound() : Ok(ticket);
    }

    // ---- Time spent ----
    //
    // Agent/admin throughout: how long a ticket took is internal. The service
    // re-checks the role as well — the policy here is the outer gate, not the
    // only one.

    [HttpGet("{id:guid}/time")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> ListTime(Guid id, CancellationToken ct)
    {
        var entries = await tickets.TimeEntriesAsync(User.GetActor(), id, ct);
        return entries is null ? NotFound() : Ok(entries);
    }

    [HttpPost("{id:guid}/time")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> LogTime(Guid id, [FromBody] LogTimeRequest request, CancellationToken ct)
    {
        var entry = await tickets.LogTimeAsync(User.GetActor(), id, request, ct);
        return entry is null ? NotFound() : StatusCode(StatusCodes.Status201Created, entry);
    }

    [HttpPut("{id:guid}/time/{entryId:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> UpdateTime(
        Guid id, Guid entryId, [FromBody] LogTimeRequest request, CancellationToken ct)
    {
        var entry = await tickets.UpdateTimeAsync(User.GetActor(), id, entryId, request, ct);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpDelete("{id:guid}/time/{entryId:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> DeleteTime(Guid id, Guid entryId, CancellationToken ct)
    {
        var removed = await tickets.DeleteTimeAsync(User.GetActor(), id, entryId, ct);
        return removed ? NoContent() : NotFound();
    }

    // ---- Related work ----
    //
    // Agent/admin: these are engineering references (stories, PRs, docs), on the
    // same footing as a private note.

    [HttpGet("{id:guid}/links")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> ListLinks(Guid id, CancellationToken ct)
    {
        var links = await tickets.LinksAsync(User.GetActor(), id, ct);
        return links is null ? NotFound() : Ok(links);
    }

    [HttpPost("{id:guid}/links")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> AddLink(
        Guid id, [FromBody] AddTicketLinkRequest request, CancellationToken ct)
    {
        var link = await tickets.AddLinkAsync(User.GetActor(), id, request, ct);
        return link is null ? NotFound() : StatusCode(StatusCodes.Status201Created, link);
    }

    [HttpDelete("{id:guid}/links/{linkId:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> DeleteLink(Guid id, Guid linkId, CancellationToken ct)
        => await tickets.DeleteLinkAsync(User.GetActor(), id, linkId, ct) ? NoContent() : NotFound();

    // ---- Watchers ----

    [HttpPut("{id:guid}/watchers/{agentId:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> AddWatcher(Guid id, Guid agentId, CancellationToken ct)
        => await tickets.AddWatcherAsync(User.GetActor(), id, agentId, ct) ? NoContent() : NotFound();

    [HttpDelete("{id:guid}/watchers/{agentId:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> RemoveWatcher(Guid id, Guid agentId, CancellationToken ct)
        => await tickets.RemoveWatcherAsync(User.GetActor(), id, agentId, ct) ? NoContent() : NotFound();

    // ---- Comments ----

    [HttpGet("{id:guid}/comments")]
    public async Task<IActionResult> ListComments(Guid id, CancellationToken ct)
    {
        var comments = await tickets.ListCommentsAsync(User.GetActor(), id, ct);
        return comments is null ? NotFound() : Ok(comments);
    }

    [HttpPost("{id:guid}/comments")]
    public async Task<IActionResult> AddComment(Guid id, [FromBody] CreateCommentRequest request, CancellationToken ct)
    {
        var comment = await tickets.AddCommentAsync(User.GetActor(), id, request, ct);
        return comment is null ? NotFound() : StatusCode(StatusCodes.Status201Created, comment);
    }

    // ---- Attachments ----

    [HttpGet("{id:guid}/attachments")]
    public async Task<IActionResult> ListAttachments(Guid id, CancellationToken ct)
    {
        var list = await attachments.ListForTicketAsync(User.GetActor(), id, ct);
        return list is null ? NotFound() : Ok(list);
    }

    [HttpPost("{id:guid}/attachments")]
    [RequestSizeLimit(AttachmentService.MaxSizeBytes + 1024)]
    public async Task<IActionResult> Upload(Guid id, [FromQuery] Guid? commentId, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A non-empty file is required." });
        if (file.Length > AttachmentService.MaxSizeBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { error = "Attachments are limited to 10 MB." });

        await using var stream = file.OpenReadStream();
        var attachment = await attachments.UploadAsync(
            User.GetActor(), id, commentId, file.FileName, file.ContentType, file.Length, stream, ct);
        return attachment is null ? NotFound() : StatusCode(StatusCodes.Status201Created, attachment);
    }
}
