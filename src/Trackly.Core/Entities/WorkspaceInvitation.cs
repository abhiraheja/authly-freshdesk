namespace Trackly.Core.Entities;

public class WorkspaceInvitation
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string Role { get; set; } = TracklyRoles.Agent;   // agent or admin
    public string TokenHash { get; set; } = null!;           // SHA-256 of the invite link token
    public Guid InvitedBy { get; set; }
    public User InvitedByUser { get; set; } = null!;
    public DateTime ExpiresAt { get; set; }                  // 7 days
    public DateTime? AcceptedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
