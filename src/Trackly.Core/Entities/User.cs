namespace Trackly.Core.Entities;

public class User
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Name { get; set; }

    /// <summary>
    /// `IWorkspaceFileStorage` key for the profile photo, or null for the
    /// initials fallback. A key, never a URL: the bytes are private and are only
    /// ever handed out by <c>GET /api/users/{id}/avatar</c>, which is where the
    /// workspace check runs. See <see cref="UserAvatar"/>.
    /// </summary>
    public string? AvatarStorageKey { get; set; }
    public string? AvatarContentType { get; set; }
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

    /// <summary>
    /// PBKDF2 hash from <see cref="Trackly.Core.Interfaces.IPasswordHasher"/>, or
    /// null for someone who has never been given one — an SSO user, or a customer
    /// who only ever signs in with an emailed code. Null means "cannot sign in
    /// with a password", never "any password will do".
    /// </summary>
    public string? PasswordHash { get; set; }

    /// <summary>
    /// Set when an admin hands out a temporary password. Until the user replaces
    /// it, the API refuses every request except reading their own profile and
    /// changing the password — the temporary one travelled over chat or a phone
    /// call, so it is a credential someone else has seen.
    /// </summary>
    public bool MustChangePassword { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

public static class UserAvatar
{
    /// <summary>
    /// The path a client should put in an &lt;img src&gt;, or null when there is
    /// no photo.
    ///
    /// One definition, because every DTO that carries a user needs it and they
    /// must agree. The `v` token changes whenever the stored key changes, which
    /// is what lets the response be cached hard: the path itself is stable, so
    /// without a version a replaced photo would keep showing the old one until
    /// the cache expired.
    /// </summary>
    public static string? UrlFor(User? user) =>
        user is null ? null : UrlFor(user.Id, user.AvatarStorageKey);

    /// <summary>Overload for callers that projected the two columns only.</summary>
    public static string? UrlFor(Guid userId, string? storageKey) =>
        storageKey is null ? null : $"/api/users/{userId}/avatar?v={Version(storageKey)}";

    private static string Version(string key)
    {
        // FNV-1a. Not a security boundary and not required to be unguessable —
        // it only has to change when the key does.
        uint hash = 2166136261;
        foreach (var c in key)
            hash = (hash ^ c) * 16777619;
        return hash.ToString("x8");
    }
}

public static class TracklyRoles
{
    public const string Customer = "customer";
    public const string Agent = "agent";
    public const string Admin = "admin";
    public static readonly string[] All = [Customer, Agent, Admin];
}
