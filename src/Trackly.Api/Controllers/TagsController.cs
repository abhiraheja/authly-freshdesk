using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Workspace tags for type-ahead + reporting. Agent/admin only.
[ApiController]
[Route("api/tags")]
[Authorize(Policy = "AgentOrAdmin")]
public class TagsController(TagService tags) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await tags.ListAsync(User.GetActor(), ct));
}
