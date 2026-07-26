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
        return await db.Teams
            .Where(t => t.WorkspaceId == actor.WorkspaceId)
            .OrderBy(t => t.Name)
            .Select(t => new TeamDto(
                t.Id, t.Name,
                t.Members.Select(m => new UserSummaryDto(m.User.Id, m.User.Name, m.User.Email, m.User.Role)).ToList()))
            .ToListAsync(ct);
    }

    public async Task<TeamDto> CreateAsync(Actor actor, string name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Team name is required.");
        if (await db.Teams.AnyAsync(t => t.WorkspaceId == actor.WorkspaceId && t.Name == name.Trim(), ct))
            throw new ArgumentException("A team with that name already exists.");

        var team = new Team { WorkspaceId = actor.WorkspaceId, Name = name.Trim() };
        db.Teams.Add(team);
        await db.SaveChangesAsync(ct);
        return new TeamDto(team.Id, team.Name, []);
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

public record TeamDto(Guid Id, string Name, IReadOnlyList<UserSummaryDto> Members);
