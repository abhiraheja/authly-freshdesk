namespace Trackly.Core.Entities;

/// <summary>
/// One browser talking to one widget. This is the row the trust rule hangs off
/// (docs/widget-plan.md § 3.3): an <b>unverified</b> visitor sees only the
/// conversations created from their own browser, matched by
/// <see cref="VisitorTokenHash"/>; a <b>verified</b> one sees everything
/// belonging to <see cref="UserId"/>.
///
/// <para>
/// An email typed into the details form is <i>claimed</i>, never <i>proven</i>.
/// <see cref="IsVerified"/> is set only by a JWT signed with the widget secret
/// or by a completed email OTP — never by the visitor saying who they are.
/// </para>
/// </summary>
public class WidgetVisitor
{
    public Guid Id { get; set; }

    /// <summary>
    /// Denormalised from <see cref="WidgetId"/> on purpose: invariant 1 says
    /// every query filters by workspace, and a visitor lookup that had to join
    /// to get there would be the one query that quietly does not.
    /// </summary>
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public Guid WidgetId { get; set; }
    public WidgetConfig Widget { get; set; } = null!;

    /// <summary>SHA-256 of the token held in the frame's localStorage (invariant 4).</summary>
    public string VisitorTokenHash { get; set; } = string.Empty;

    /// <summary>The contact, once known. Always a user whose role is customer.</summary>
    public Guid? UserId { get; set; }
    public User? User { get; set; }

    /// <summary>The host application's own id for this person (<c>unique_id</c>).</summary>
    public string? ExternalId { get; set; }

    public bool IsVerified { get; set; }

    /// <summary>Free-form bag the host page attaches (<c>variables</c>).</summary>
    public Dictionary<string, string> Variables { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}
