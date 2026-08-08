namespace Trackly.Core.Entities;

public class Workspace
{
    public Guid Id { get; set; }
    public string Name { get; set; } = null!;
    public string Slug { get; set; } = null!;
    // Which sign-in methods are offered. At least one working method must stay
    // on — see LoginSettingsController, which refuses to turn off the last one.
    // On a self-hosted box there is no support desk to call, so a lockout here
    // is permanent.
    public bool EmailLoginEnabled { get; set; } = true;

    /// <summary>
    /// On by default, because a brand-new install has no SMTP and an emailed code
    /// would have nowhere to go. An admin can turn it off once email is proven to
    /// work, or SSO is live.
    /// </summary>
    public bool PasswordLoginEnabled { get; set; } = true;

    public bool AiEnabled { get; set; } = true;   // per-workspace kill switch for the AI copilot
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = new List<User>();
}
