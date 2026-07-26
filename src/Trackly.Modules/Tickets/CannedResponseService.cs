using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

// Reusable reply snippets. Agent/admin (controller-enforced), workspace-scoped.
public class CannedResponseService(TracklyDbContext db)
{
    public async Task<IReadOnlyList<CannedResponseDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await db.CannedResponses
            .Where(c => c.WorkspaceId == actor.WorkspaceId)
            .OrderBy(c => c.Title)
            .Select(c => new CannedResponseDto(c.Id, c.Title, c.Body))
            .ToListAsync(ct);
    }

    public async Task<CannedResponseDto> CreateAsync(Actor actor, SaveCannedResponseRequest req, CancellationToken ct)
    {
        Validate(req);
        var canned = new CannedResponse { WorkspaceId = actor.WorkspaceId, Title = req.Title.Trim(), Body = req.Body.Trim() };
        db.CannedResponses.Add(canned);
        await db.SaveChangesAsync(ct);
        return new CannedResponseDto(canned.Id, canned.Title, canned.Body);
    }

    public async Task<CannedResponseDto?> UpdateAsync(Actor actor, Guid id, SaveCannedResponseRequest req, CancellationToken ct)
    {
        Validate(req);
        var canned = await db.CannedResponses
            .SingleOrDefaultAsync(c => c.Id == id && c.WorkspaceId == actor.WorkspaceId, ct);
        if (canned is null) return null;
        canned.Title = req.Title.Trim();
        canned.Body = req.Body.Trim();
        canned.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new CannedResponseDto(canned.Id, canned.Title, canned.Body);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var deleted = await db.CannedResponses
            .Where(c => c.Id == id && c.WorkspaceId == actor.WorkspaceId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }

    private static void Validate(SaveCannedResponseRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Title) || string.IsNullOrWhiteSpace(req.Body))
            throw new ArgumentException("Title and body are required.");
    }
}

public record CannedResponseDto(Guid Id, string Title, string Body);
public record SaveCannedResponseRequest(string Title, string Body);
