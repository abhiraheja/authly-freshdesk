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
    public string? Company { get; set; }
    public string? Location { get; set; }

    /// <summary>
    /// Free key/value details a workspace keeps about a customer — account
    /// number, plan, region, whatever their business runs on.
    ///
    /// Deliberately schemaless. Every support desk wants different fields, and
    /// a fixed set means either a column migration per customer or a pile of
    /// unused columns. The Configuration screen defines *suggested* keys so the
    /// form stays consistent, but nothing here rejects a key that isn't listed:
    /// an agent on a call should never be blocked from writing down what they
    /// were told.
    /// </summary>
    public Dictionary<string, string> CustomFields { get; set; } = new();
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
    public static readonly string[] All = [Customer, Agent, Admin];
}
