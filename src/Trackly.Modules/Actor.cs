using Trackly.Core.Entities;

namespace Trackly.Modules;

// The authenticated principal as seen by business services. Every service call
// takes one — it is how workspace isolation and role scoping are enforced.
public record Actor(Guid UserId, Guid WorkspaceId, string Role)
{
    public bool IsAgentOrAdmin => Role is TracklyRoles.Agent or TracklyRoles.Admin;
    public bool IsAdmin => Role == TracklyRoles.Admin;
}
