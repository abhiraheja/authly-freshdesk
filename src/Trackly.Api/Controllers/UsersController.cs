using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(TracklyDbContext db, IWorkspaceFileStorage storage) : ControllerBase
{
    private const long MaxAvatarBytes = 1024 * 1024; // 1 MB — matches the logo cap
    private static readonly string[] AllowedAvatarTypes = ["image/png", "image/jpeg", "image/webp"];

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

        // Two steps: the avatar path is built in C#, and EF cannot translate it.
        // Only the five columns come back, so this is still a narrow read.
        var rows = await users
            .OrderBy(u => u.Name ?? u.Email)
            .Select(u => new { u.Id, u.Name, u.Email, u.Role, u.AvatarStorageKey })
            .ToListAsync(ct);

        return Ok(rows.Select(u => new
        {
            u.Id, u.Name, u.Email, u.Role,
            AvatarUrl = UserAvatar.UrlFor(u.Id, u.AvatarStorageKey),
        }));
    }

    public record CustomerRequest(
        string? Email,
        string? Name,
        string? Phone,
        string? Company,
        string? Location,
        Dictionary<string, string>? CustomFields);

    // Adds a customer to the workspace so an agent can attach a ticket to a real
    // person — the phone call, the walk-in, the guest submission nobody has a
    // record for yet.
    //
    // Get-or-create, not create-or-409: from the agent's side "add this customer"
    // is one intention, and an email that already exists is the SAME person, not
    // a conflict they have to go and resolve. A duplicate row would be the worse
    // outcome — two histories for one customer.
    //
    // No password is set because Trackly has none: the customer signs in with a
    // magic link whenever they first come to the portal.
    [HttpPost]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Create([FromBody] CustomerRequest request, CancellationToken ct)
    {
        var email = request.Email?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            return BadRequest(new { error = "A valid email address is required." });

        var workspaceId = User.GetWorkspaceId();
        var existing = await db.Users
            .SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == email, ct);
        if (existing is not null)
        {
            // Same person, so fill in anything the agent supplied that we did not
            // already have. Overwriting what is on file would let a hurried "add
            // customer" wipe details someone else took the time to record.
            Fill(existing, request);
            await db.SaveChangesAsync(ct);
            return Ok(Dto(existing));
        }

        var user = new Trackly.Core.Entities.User
        {
            WorkspaceId = workspaceId,
            Email = email,
            Role = TracklyRoles.Customer,
        };
        Fill(user, request);
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return StatusCode(StatusCodes.Status201Created, Dto(user));
    }

    // Full profile edit, agent/admin. Separate from PATCH below, which is the
    // admin-only role/active endpoint — an agent may correct a customer's phone
    // number without being allowed to make them an admin.
    [HttpPut("{id:guid}/profile")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> UpdateProfile(Guid id, [FromBody] CustomerRequest request, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(
            u => u.WorkspaceId == User.GetWorkspaceId() && u.Id == id, ct);
        if (user is null) return NotFound();

        // Here a null field DOES clear, unlike create: this is an edit form and
        // the agent is looking at the current values as they submit.
        user.Name = Clean(request.Name);
        user.Phone = Clean(request.Phone);
        user.Company = Clean(request.Company);
        user.Location = Clean(request.Location);
        if (request.CustomFields is not null)
        {
            user.CustomFields = request.CustomFields
                .Where(kv => !string.IsNullOrWhiteSpace(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
                .ToDictionary(kv => kv.Key.Trim(), kv => kv.Value.Trim());
        }
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(Dto(user));
    }

    // One customer, with the ticket counts the profile screen shows.
    [HttpGet("{id:guid}")]
    [Authorize(Policy = "AgentOrAdmin")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var user = await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Id == id, ct);
        if (user is null) return NotFound();

        var tickets = db.Tickets.Where(t => t.WorkspaceId == workspaceId && t.RequesterId == id);
        return Ok(new
        {
            user.Id, user.Name, user.Email, user.Phone, user.Company, user.Location,
            user.Role, user.IsActive, user.CreatedAt, user.CustomFields,
            AvatarUrl = UserAvatar.UrlFor(user),
            TotalTickets = await tickets.CountAsync(ct),
            OpenTickets = await tickets.CountAsync(t => t.StatusCategory == TicketStatusCategory.Open, ct),
        });
    }

    // ── Profile photo ───────────────────────────────────────────────────────
    //
    // Private, unlike the workspace logo: a logo is meant to be seen by anyone
    // who lands on the portal, whereas a person's photo is theirs. It is stored
    // with the default Private visibility, so `PublicUrlAsync` refuses it and no
    // CDN URL for it can ever exist — the bytes only leave through the endpoint
    // below, after the workspace check.

    [HttpPost("{id:guid}/avatar")]
    [RequestSizeLimit(MaxAvatarBytes + 1024)]
    public async Task<IActionResult> UploadAvatar(Guid id, IFormFile file, CancellationToken ct)
    {
        if (!MayEditPhotoOf(id))
            return Forbid();
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A photo file is required." });
        if (file.Length > MaxAvatarBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Photos are limited to 1 MB." });
        if (!AllowedAvatarTypes.Contains(file.ContentType))
            return BadRequest(new { error = "Photo must be PNG, JPEG or WebP." });

        var workspaceId = User.GetWorkspaceId();
        var user = await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Id == id, ct);
        if (user is null) return NotFound();

        var oldKey = user.AvatarStorageKey;
        await using var stream = file.OpenReadStream();
        user.AvatarStorageKey = await storage.SaveAsync(
            workspaceId, $"{workspaceId}/avatars/{id}", file.FileName, stream, ct: ct);
        user.AvatarContentType = file.ContentType;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // New key committed before the old blob goes, as in BrandingController:
        // a failed delete then costs an orphaned object, not a user row pointing
        // at bytes that no longer exist.
        if (oldKey is not null)
            await storage.DeleteAsync(workspaceId, oldKey, ct);

        return Ok(new { AvatarUrl = UserAvatar.UrlFor(user) });
    }

    [HttpDelete("{id:guid}/avatar")]
    public async Task<IActionResult> DeleteAvatar(Guid id, CancellationToken ct)
    {
        if (!MayEditPhotoOf(id))
            return Forbid();

        var workspaceId = User.GetWorkspaceId();
        var user = await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Id == id, ct);
        if (user is null) return NotFound();

        var key = user.AvatarStorageKey;
        user.AvatarStorageKey = null;
        user.AvatarContentType = null;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (key is not null)
            await storage.DeleteAsync(workspaceId, key, ct);
        return NoContent();
    }

    // Readable by any signed-in member of the same workspace: avatars appear on
    // ticket lists, comment threads and pickers, so restricting this further
    // would just render broken images across the app. The workspace filter is
    // what matters, and it is on the query.
    [HttpGet("{id:guid}/avatar")]
    public async Task<IActionResult> GetAvatar(Guid id, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var user = await db.Users
            .Where(u => u.WorkspaceId == workspaceId && u.Id == id)
            .Select(u => new { u.AvatarStorageKey, u.AvatarContentType })
            .SingleOrDefaultAsync(ct);
        if (user?.AvatarStorageKey is null)
            return NotFound();

        // A year is safe because the URL carries a version token derived from the
        // storage key — replacing the photo changes the URL, so nothing stale is
        // ever reachable. `private` keeps it out of shared proxy caches, and
        // `Vary: Cookie` keys the entry by session so the next person to sign in
        // on a shared machine gets a real authorisation check rather than a hit.
        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        Response.Headers.Vary = "Cookie";

        var stream = await storage.OpenReadAsync(workspaceId, user.AvatarStorageKey, ct);
        return File(stream, user.AvatarContentType ?? "application/octet-stream");
    }

    /// <summary>
    /// Your own photo always; anyone else's only as an agent or admin. A customer
    /// editing another customer's profile photo has no legitimate path here.
    /// </summary>
    private bool MayEditPhotoOf(Guid userId) =>
        userId == User.GetUserId() || User.GetActor().IsAgentOrAdmin;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void Fill(Trackly.Core.Entities.User user, CustomerRequest request)
    {
        user.Name ??= Clean(request.Name);
        user.Phone ??= Clean(request.Phone);
        user.Company ??= Clean(request.Company);
        user.Location ??= Clean(request.Location);
        foreach (var (key, value) in request.CustomFields ?? [])
        {
            if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(value)) continue;
            user.CustomFields[key.Trim()] = value.Trim();
        }
    }

    private static object Dto(Trackly.Core.Entities.User u) => new
    {
        u.Id, u.Name, u.Email, u.Phone, u.Company, u.Location, u.Role, u.CustomFields,
        AvatarUrl = UserAvatar.UrlFor(u),
    };

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
