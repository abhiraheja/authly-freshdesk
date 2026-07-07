namespace Trackly.Core.Entities;

// The cookie holds a random 256-bit token; only its SHA-256 hash is stored,
// so a DB leak does not yield usable sessions.
public class Session
{
    public Guid Id { get; set; }
    public string TokenHash { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
