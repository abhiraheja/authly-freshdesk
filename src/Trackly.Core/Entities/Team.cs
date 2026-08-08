namespace Trackly.Core.Entities;

// A group of agents — a DEPARTMENT in the UI. Tickets can be routed to one, then
// round-robin assigned within it (replacing the workspace-wide round robin when
// a team is set).
//
// Two levels: a team with a ParentId is a sub-department. Routing always reads
// the ticket's own TeamId and never walks the tree, so a sub-department that
// has its own members routes to them and one that does not simply labels the
// ticket — which is the behaviour a workspace expects either way.
public class Team
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Name { get; set; } = null!;

    /// <summary>Null for a department. A sub-department's parent is always top-level.</summary>
    public Guid? ParentId { get; set; }
    public Team? Parent { get; set; }
    public ICollection<Team> Children { get; set; } = new List<Team>();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TeamMember> Members { get; set; } = new List<TeamMember>();
}

public class TeamMember
{
    public Guid TeamId { get; set; }
    public Team Team { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
}
