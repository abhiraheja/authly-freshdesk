using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(TracklyDbContext db) : ControllerBase
{
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var user = await db.Users
            .Include(u => u.Workspace)
            .SingleOrDefaultAsync(u => u.Id == User.GetUserId()
                                       && u.WorkspaceId == User.GetWorkspaceId(), ct);
        if (user is null)
            return Unauthorized();
        return Ok(UserResponse.From(user));
    }

    // Workspace members for assignee/watcher pickers. role=agent also includes
    // admins (both are assignable and watchable).
    [HttpGet]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> List([FromQuery] string? role, CancellationToken ct)
    {
        var users = db.Users.Where(u => u.WorkspaceId == User.GetWorkspaceId() && u.IsActive);
        if (role == "agent")
            users = users.Where(u => u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin);
        else if (!string.IsNullOrEmpty(role))
            users = users.Where(u => u.Role == role);

        var list = await users
            .OrderBy(u => u.Name ?? u.Email)
            .Select(u => new { u.Id, u.Name, u.Email, u.Role })
            .ToListAsync(ct);
        return Ok(list);
    }

    public record UpdateUserRequest(string? Role, bool? IsActive);

    // Admin user management: change role, deactivate/reactivate. Deactivation
    // also revokes the user's sessions so access stops immediately.
    [HttpPatch("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest request, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(
            u => u.WorkspaceId == User.GetWorkspaceId() && u.Id == id, ct);
        if (user is null)
            return NotFound();

        if (request.Role is not null)
        {
            string[] validRoles = [TracklyRoles.Customer, TracklyRoles.Agent, TracklyRoles.Admin];
            if (!validRoles.Contains(request.Role))
                return BadRequest(new { error = "Role must be customer, agent or admin." });
            if (user.Id == User.GetUserId() && request.Role != TracklyRoles.Admin)
                return BadRequest(new { error = "You cannot demote yourself." });
            user.Role = request.Role;
        }

        if (request.IsActive is not null)
        {
            if (user.Id == User.GetUserId() && request.IsActive == false)
                return BadRequest(new { error = "You cannot deactivate yourself." });
            user.IsActive = request.IsActive.Value;
            if (!user.IsActive)
                await db.Sessions.Where(s => s.UserId == user.Id).ExecuteDeleteAsync(ct);
        }

        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(new { user.Id, user.Name, user.Email, user.Role, user.IsActive });
    }
}
