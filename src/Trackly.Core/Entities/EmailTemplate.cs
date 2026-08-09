namespace Trackly.Core.Entities;

/// <summary>
/// An admin's customisation of one outbound email.
///
/// **A missing row is the built-in.** The table holds only what somebody
/// deliberately changed; everything else renders from
/// <c>EmailTemplateCatalog</c>. Seeding a row per key on first run would look
/// tidier and behave worse — a default improved in a later release would never
/// reach an existing install, because the row already exists and nothing can
/// tell "seeded, untouched" from "written that way on purpose". Absent-means-
/// default also makes the admin UI's built-in/custom badge a null check, Reset a
/// DELETE, and a fresh database seed-free.
/// </summary>
public class EmailTemplate
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>A key from <c>EmailTemplateCatalog</c> — `magic_link`, `_layout`, …</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Always `en` today. Trackly ships `en.json` and `hi.json` on the frontend
    /// but has no locale on `users`, so there is no per-recipient locale to
    /// select on yet. It is part of the unique key from the start because adding
    /// it later means rebuilding that index on a table with live rows.
    /// </summary>
    public string Locale { get; set; } = "en";

    /// <summary>Null for `_layout`, which has no subject of its own.</summary>
    public string? Subject { get; set; }

    public string BodyHtml { get; set; } = string.Empty;

    /// <summary>
    /// Skip the shared layout — this body is a complete HTML document.
    ///
    /// For the case that genuinely needs it: a designer hands over a finished
    /// email. The cost is that workspace branding no longer reaches it, which is
    /// the admin's call to make.
    /// </summary>
    public bool Standalone { get; set; }

    /// <summary>
    /// False falls back to the built-in — it does **not** stop the mail.
    ///
    /// A switch that silently stopped sending sign-in codes would be an
    /// invariant 8 lockout with a friendly label on it. Whether an event sends
    /// at all lives in <c>NotificationSettings</c>, where an admin expects it.
    /// </summary>
    public bool IsActive { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public User? UpdatedBy { get; set; }
}
