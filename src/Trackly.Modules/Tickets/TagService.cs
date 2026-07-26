using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

// Free-form ticket tags. Agent/admin-only (enforced by the controller policy);
// every query is workspace-scoped.
public class TagService(TracklyDbContext db)
{
    public async Task<IReadOnlyList<TagUsageDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await db.Tags
            .Where(t => t.WorkspaceId == actor.WorkspaceId)
            .OrderBy(t => t.Name)
            .Select(t => new TagUsageDto(t.Id, t.Name, t.Color, db.TicketTags.Count(tt => tt.TagId == t.Id)))
            .ToListAsync(ct);
    }

    // Replaces a ticket's tags with the given names, creating any that don't exist
    // yet. Returns the ticket's tags, or null if the ticket isn't in the workspace.
    public async Task<IReadOnlyList<TagDto>?> SetTicketTagsAsync(
        Actor actor, Guid ticketId, IReadOnlyList<string> names, CancellationToken ct)
    {
        var ticket = await db.Tickets
            .SingleOrDefaultAsync(t => t.Id == ticketId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (ticket is null) return null;

        var wanted = names
            .Select(n => n.Trim())
            .Where(n => n.Length is > 0 and <= 40)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var tags = await ResolveTagsAsync(actor.WorkspaceId, wanted, ct);

        var existing = await db.TicketTags.Where(tt => tt.TicketId == ticketId).ToListAsync(ct);
        var wantedIds = tags.Select(t => t.Id).ToHashSet();

        db.TicketTags.RemoveRange(existing.Where(tt => !wantedIds.Contains(tt.TagId)));
        var haveIds = existing.Select(tt => tt.TagId).ToHashSet();
        foreach (var tag in tags.Where(t => !haveIds.Contains(t.Id)))
            db.TicketTags.Add(new TicketTag { TicketId = ticketId, TagId = tag.Id });

        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return tags.Select(t => new TagDto(t.Id, t.Name, t.Color)).ToList();
    }

    // Resolves names to Tag rows within the workspace, creating missing ones.
    private async Task<List<Tag>> ResolveTagsAsync(Guid workspaceId, List<string> names, CancellationToken ct)
    {
        if (names.Count == 0) return [];

        var lowered = names.Select(n => n.ToLowerInvariant()).ToList();
        var existing = await db.Tags
            .Where(t => t.WorkspaceId == workspaceId && lowered.Contains(t.Name.ToLower()))
            .ToListAsync(ct);

        var result = new List<Tag>(existing);
        foreach (var name in names)
        {
            if (existing.Any(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase)))
                continue;
            var tag = new Tag { WorkspaceId = workspaceId, Name = name };
            db.Tags.Add(tag);
            result.Add(tag);
        }
        if (result.Count != existing.Count)
            await db.SaveChangesAsync(ct);
        return result;
    }
}

public record TagUsageDto(Guid Id, string Name, string? Color, int TicketCount);
