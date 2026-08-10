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

    /// <summary>
    /// Turns a bare task number into a link on a release plan —
    /// <c>https://dev.azure.com/org/proj/_workitems/edit/{id}</c>, where
    /// <c>{id}</c> is substituted. Set once by an admin so that everybody after
    /// them types "55335" instead of hunting for a URL.
    ///
    /// This is the difference between people linking their tasks and people not
    /// bothering, and an unlinked task number cannot be tested by somebody who
    /// did not write it.
    /// </summary>
    public string? WorkItemUrlTemplate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = new List<User>();
}
