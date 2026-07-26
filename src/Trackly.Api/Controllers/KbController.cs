using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Kb;

namespace Trackly.Api.Controllers;

// Knowledge base. Authoring is agent/admin; the public read endpoints (no auth)
// only ever return published articles for the branded /kb and submit-form
// deflection.
[ApiController]
public class KbController(KbService kb) : ControllerBase
{
    // ---- Authoring ----

    [HttpGet("api/kb/articles")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await kb.ListAsync(User.GetActor(), ct));

    [HttpGet("api/kb/articles/{id:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var article = await kb.GetAsync(User.GetActor(), id, ct);
        return article is null ? NotFound() : Ok(article);
    }

    [HttpPost("api/kb/articles")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Create([FromBody] SaveKbArticleRequest req, CancellationToken ct)
    {
        var article = await kb.CreateAsync(User.GetActor(), req, ct);
        return CreatedAtAction(nameof(Get), new { id = article.Id }, article);
    }

    [HttpPut("api/kb/articles/{id:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveKbArticleRequest req, CancellationToken ct)
    {
        var article = await kb.UpdateAsync(User.GetActor(), id, req, ct);
        return article is null ? NotFound() : Ok(article);
    }

    [HttpDelete("api/kb/articles/{id:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await kb.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    // ---- Public (published only) ----

    [HttpGet("api/public/workspaces/{slug}/kb")]
    public async Task<IActionResult> PublicList(string slug, CancellationToken ct)
        => Ok(await kb.ListPublishedAsync(slug, ct));

    [HttpGet("api/public/workspaces/{slug}/kb/suggest")]
    public async Task<IActionResult> Suggest(string slug, [FromQuery] string q, CancellationToken ct)
        => Ok(await kb.SuggestAsync(slug, q ?? "", ct));

    [HttpGet("api/public/workspaces/{slug}/kb/{id:guid}")]
    public async Task<IActionResult> PublicGet(string slug, Guid id, CancellationToken ct)
    {
        var article = await kb.GetPublishedAsync(slug, id, ct);
        return article is null ? NotFound() : Ok(article);
    }
}
