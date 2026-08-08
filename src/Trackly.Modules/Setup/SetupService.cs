using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Setup;

public record SetupRequest(string OrganisationName, string Email, string? Name);

public enum SetupStatus
{
    Success,
    AlreadySetUp,   // a workspace exists — this endpoint is single-use
    InvalidRequest,
}

public record SetupResult(SetupStatus Status, User? User = null, string? SessionToken = null);

/// <summary>
/// First run. Trackly is self-hosted: one deployment, one workspace, and it
/// belongs to whoever runs the container.
///
/// **This issues the session inline — it deliberately does not email a magic
/// link.** On a fresh install SMTP is not configured, and SMTP is configured
/// from inside the admin UI. Mailing the first admin their own way in would
/// brick every new install on the one step that has no way out. The person
/// typing into the setup screen on an empty database *is* the operator; there
/// is nobody else to authenticate them against, and nothing to protect yet.
///
/// That is why this is not just onboarding step 1 reused, and why it must stay
/// unreachable the moment a workspace exists.
/// </summary>
public class SetupService(TracklyDbContext db, AuthService auth)
{
    /// <summary>
    /// The single workspace's slug.
    ///
    /// The slug is not dead weight even with one workspace: roughly eight
    /// unauthenticated surfaces (guest ticket views, live chat, public branding,
    /// the widget, CSAT, SSO start) still resolve a workspace from a
    /// <c>?workspace=</c> parameter. Fixing it to a known constant keeps every
    /// one of those links working without ever asking a human to invent one.
    /// </summary>
    public const string WorkspaceSlug = "default";

    public async Task<bool> NeedsSetupAsync(CancellationToken ct)
        => !await db.Workspaces.AnyAsync(ct);

    public async Task<SetupResult> RunAsync(
        SetupRequest request, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        var organisation = request.OrganisationName.Trim();
        var email = request.Email.Trim().ToLowerInvariant();
        if (organisation.Length == 0 || !email.Contains('@'))
            return new SetupResult(SetupStatus.InvalidRequest);

        // Checked up front so the ordinary "someone already set this up" case
        // answers without throwing. It is not what makes this safe — see below.
        if (!await NeedsSetupAsync(ct))
            return new SetupResult(SetupStatus.AlreadySetUp);

        var workspace = new Workspace { Name = organisation, Slug = WorkspaceSlug };
        var user = new User
        {
            Workspace = workspace,
            Email = email,
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim(),
            Role = TracklyRoles.Admin,
            LastLoginAt = DateTime.UtcNow,
        };
        db.Workspaces.Add(workspace);
        db.Users.Add(user);

        // Workspace, admin and session in one SaveChanges: a half-finished setup
        // that created a workspace but no way into it would be unrecoverable
        // through the UI, because the endpoint refuses to run a second time.
        var sessionToken = auth.CreateSession(user, workspace, ipAddress, userAgent);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two operators pressing the button at once. The check above is a
            // check-then-act and cannot settle this; the unique index on
            // workspaces.slug can, and does — one insert wins, the other lands
            // here. Confirming a workspace now exists tells us this was the
            // race rather than an unrelated write failure worth surfacing.
            if (!await NeedsSetupAsync(ct))
                return new SetupResult(SetupStatus.AlreadySetUp);
            throw;
        }

        return new SetupResult(SetupStatus.Success, user, sessionToken);
    }
}
