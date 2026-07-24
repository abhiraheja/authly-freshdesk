namespace Trackly.Core.Entities;

// A verified email domain claimed by a workspace. Globally unique — only one
// workspace may own a domain. When discoverable, a user entering an @domain email
// on the login page is routed to this workspace's SSO provider.
public class WorkspaceDomain
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Domain { get; set; } = null!;
    public bool Verified { get; set; }
    public bool Discoverable { get; set; } = true;
    public string DnsTxtToken { get; set; } = null!;
    public DateTime? VerifiedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
