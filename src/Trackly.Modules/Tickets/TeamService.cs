using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

// Teams group agents for routing. Reads are agent/admin; mutations are admin
// (enforced by the controller). Every query is workspace-scoped.
public class TeamService(TracklyDbContext db)
{
    public async Task<IReadOnlyList<TeamDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        // Materialised before projecting, not projected in SQL: the member DTO
        // now carries an avatar path that is computed in C#, and EF only client-
        // evaluates the OUTER projection — inside a nested collection select it
        // would fail to translate.
        var teams = await db.Teams
            .Where(t => t.WorkspaceId == actor.WorkspaceId)
            .OrderBy(t => t.Name)
            .Include(t => t.Members)
            .ThenInclude(m => m.User)
            .ToListAsync(ct);

        return teams
            .Select(t => new TeamDto(
                t.Id, t.Name,
                t.Members.Select(m => UserSummaryDto.From(m.User)!).ToList(),
                t.ParentId))
            .ToList();
    }

    public async Task<TeamDto> CreateAsync(Actor actor, string name, Guid? parentId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Team name is required.");

        if (parentId is { } parent)
        {
            // Two levels, not a tree: routing reads the ticket's own TeamId and
            // never walks upward, so a third level would be labels that no rule
            // in the product can see.
            var above = await db.Teams.SingleOrDefaultAsync(
                t => t.Id == parent && t.WorkspaceId == actor.WorkspaceId, ct);
            if (above is null) throw new ArgumentException("Unknown department.");
            if (above.ParentId is not null)
                throw new ArgumentException("A sub-department cannot have sub-departments of its own.");
        }

        // Unique within the parent, not across the workspace: two departments may
        // each have a "Support" underneath them.
        if (await db.Teams.AnyAsync(t =>
                t.WorkspaceId == actor.WorkspaceId && t.ParentId == parentId && t.Name == name.Trim(), ct))
            throw new ArgumentException("A team with that name already exists here.");

        var team = new Team { WorkspaceId = actor.WorkspaceId, Name = name.Trim(), ParentId = parentId };
        db.Teams.Add(team);
        await db.SaveChangesAsync(ct);
        return new TeamDto(team.Id, team.Name, [], team.ParentId);
    }

    // Rename only. A team's identity is its id — tickets reference it by that,
    // so the name is free to change without touching anything else.
    public async Task<TeamDto?> RenameAsync(Actor actor, Guid teamId, string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Team name is required.");

        var team = await db.Teams
            .SingleOrDefaultAsync(t => t.Id == teamId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (team is null) return null;

        var trimmed = name.Trim();
        // Compared within the same parent, matching the unique index: renaming a
        // sub-department only clashes with its siblings.
        if (await db.Teams.AnyAsync(t =>
                t.WorkspaceId == actor.WorkspaceId && t.ParentId == team.ParentId
                && t.Name == trimmed && t.Id != teamId, ct))
            throw new ArgumentException("A team with that name already exists here.");

        team.Name = trimmed;
        await db.SaveChangesAsync(ct);
        return new TeamDto(team.Id, team.Name, [], team.ParentId);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid teamId, CancellationToken ct)
    {
        var deleted = await db.Teams
            .Where(t => t.Id == teamId && t.WorkspaceId == actor.WorkspaceId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }

    public async Task<bool> AddMemberAsync(Actor actor, Guid teamId, Guid userId, CancellationToken ct)
    {
        var teamExists = await db.Teams.AnyAsync(t => t.Id == teamId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (!teamExists) return false;

        var isAgent = await db.Users.AnyAsync(u =>
            u.Id == userId && u.WorkspaceId == actor.WorkspaceId && u.IsActive &&
            (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (!isAgent)
            throw new ArgumentException("Team members must be active agents or admins.");

        if (!await db.TeamMembers.AnyAsync(m => m.TeamId == teamId && m.UserId == userId, ct))
        {
            db.TeamMembers.Add(new TeamMember { TeamId = teamId, UserId = userId });
            await db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task<bool> RemoveMemberAsync(Actor actor, Guid teamId, Guid userId, CancellationToken ct)
    {
        var teamExists = await db.Teams.AnyAsync(t => t.Id == teamId && t.WorkspaceId == actor.WorkspaceId, ct);
        if (!teamExists) return false;
        await db.TeamMembers.Where(m => m.TeamId == teamId && m.UserId == userId).ExecuteDeleteAsync(ct);
        return true;
    }
}

/// <param name="ParentId">Null for a department; set makes this a sub-department.</param>
public record TeamDto(
    Guid Id, string Name, IReadOnlyList<UserSummaryDto> Members, Guid? ParentId = null);
