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
    /// <param name="ParentId">Set to file this under a top-level category. Two levels only.</param>
        public record SaveCategoryRequest(string Name, string? Color, Guid? ParentId = null);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var categories = await db.Categories
            .Where(c => c.WorkspaceId == User.GetWorkspaceId())
            .OrderBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name, c.Color, c.ParentId))
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

        if (request.ParentId is { } parentId)
        {
            // Two levels, not a tree. A third would mean an agent navigating a
            // hierarchy to file a ticket, and the third level is where a taxonomy
            // reliably starts disagreeing with itself.
            var parent = await db.Categories.SingleOrDefaultAsync(
                c => c.WorkspaceId == workspaceId && c.Id == parentId, ct);
            if (parent is null) return BadRequest(new { error = "Unknown parent category." });
            if (parent.ParentId is not null)
                return BadRequest(new { error = "A sub-category cannot have sub-categories of its own." });
        }

        // Unique within the parent, not across the workspace: "Access" is a
        // legitimate sub-category of both Hardware and Software.
        if (await db.Categories.AnyAsync(
                c => c.WorkspaceId == workspaceId && c.ParentId == request.ParentId && c.Name == name, ct))
            return Conflict(new { error = "A category with that name already exists here." });

        var category = new Category
        {
            WorkspaceId = workspaceId,
            Name = name,
            Color = request.Color,
            ParentId = request.ParentId,
        };
        db.Categories.Add(category);
        await db.SaveChangesAsync(ct);
        return StatusCode(StatusCodes.Status201Created,
            new CategoryDto(category.Id, category.Name, category.Color, category.ParentId));
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

        // The parent is deliberately not editable here. Re-parenting a category
        // would move every ticket filed under it into a different part of the
        // taxonomy, silently, and none of the reports built on it would say so.
        category.Name = request.Name.Trim();
        category.Color = request.Color;
        await db.SaveChangesAsync(ct);
        return Ok(new CategoryDto(category.Id, category.Name, category.Color, category.ParentId));
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
