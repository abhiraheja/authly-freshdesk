using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Api.Dev;

namespace Trackly.Api.Controllers;

// Development-only utilities. Every action 404s outside Development so this can
// never seed or mutate a real environment.
[ApiController]
[Route("api/dev")]
[Authorize(Policy = "Admin")]
public class DevController(DevSeeder seeder, IWebHostEnvironment env) : ControllerBase
{
    // Populates the calling admin's workspace with demo data (one-time).
    [HttpPost("seed")]
    public async Task<IActionResult> Seed(CancellationToken ct)
    {
        if (!env.IsDevelopment())
            return NotFound();
        var result = await seeder.SeedAsync(User.GetWorkspaceId(), User.GetUserId(), ct);
        return Ok(result);
    }
}
