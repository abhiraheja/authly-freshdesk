using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/categories")]
[Authorize]
public class CategoriesController(TracklyDbContext db) : ControllerBase
{
    public record SaveCategoryRequest(string Name, string? Color);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var categories = await db.Categories
            .Where(c => c.WorkspaceId == User.GetWorkspaceId())
            .OrderBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name, c.Color))
            .ToListAsync(ct);
        return Ok(categories);
    }

    [HttpPost]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] SaveCategoryRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Category name is required." });

        var workspaceId = User.GetWorkspaceId();
        var name = request.Name.Trim();
        if (await db.Categories.AnyAsync(c => c.WorkspaceId == workspaceId && c.Name == name, ct))
            return Conflict(new { error = "A category with that name already exists." });

        var category = new Category { WorkspaceId = workspaceId, Name = name, Color = request.Color };
        db.Categories.Add(category);
        await db.SaveChangesAsync(ct);
        return StatusCode(StatusCodes.Status201Created,
            new CategoryDto(category.Id, category.Name, category.Color));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveCategoryRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Category name is required." });

        var category = await db.Categories.SingleOrDefaultAsync(
            c => c.WorkspaceId == User.GetWorkspaceId() && c.Id == id, ct);
        if (category is null)
            return NotFound();

        category.Name = request.Name.Trim();
        category.Color = request.Color;
        await db.SaveChangesAsync(ct);
        return Ok(new CategoryDto(category.Id, category.Name, category.Color));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var deleted = await db.Categories
            .Where(c => c.WorkspaceId == User.GetWorkspaceId() && c.Id == id)
            .ExecuteDeleteAsync(ct);
        return deleted == 0 ? NotFound() : NoContent();
    }
}
