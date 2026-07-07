using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
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
}
