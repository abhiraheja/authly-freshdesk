namespace Trackly.Core.Entities;

public class User
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Name { get; set; }
    public string? AvatarUrl { get; set; }
    public string Role { get; set; } = TracklyRoles.Customer;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

public static class TracklyRoles
{
    public const string Customer = "customer";
    public const string Agent = "agent";
    public const string Admin = "admin";
}
