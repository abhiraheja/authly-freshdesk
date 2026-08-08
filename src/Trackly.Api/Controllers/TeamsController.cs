using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Teams: agents may read them (to route tickets); only admins manage them.
[ApiController]
[Route("api/teams")]
[Authorize(Policy = "AgentOrAdmin")]
public class TeamsController(TeamService teams) : ControllerBase
{
    /// <param name="ParentId">Set to create a sub-department under an existing one.</param>
    public record CreateTeamRequest(string Name, Guid? ParentId = null);
    public record AddMemberRequest(Guid UserId);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await teams.ListAsync(User.GetActor(), ct));

    [HttpPost]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateTeamRequest req, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created, await teams.CreateAsync(User.GetActor(), req.Name, req.ParentId, ct));

    [HttpPut("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Rename(Guid id, [FromBody] CreateTeamRequest req, CancellationToken ct)
    {
        var renamed = await teams.RenameAsync(User.GetActor(), id, req.Name, ct);
        return renamed is null ? NotFound() : Ok(renamed);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await teams.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    [HttpPost("{id:guid}/members")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> AddMember(Guid id, [FromBody] AddMemberRequest req, CancellationToken ct)
        => await teams.AddMemberAsync(User.GetActor(), id, req.UserId, ct) ? NoContent() : NotFound();

    [HttpDelete("{id:guid}/members/{userId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> RemoveMember(Guid id, Guid userId, CancellationToken ct)
        => await teams.RemoveMemberAsync(User.GetActor(), id, userId, ct) ? NoContent() : NotFound();
}
