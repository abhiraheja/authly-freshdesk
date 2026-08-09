using Microsoft.EntityFrameworkCore;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Email;

/// <summary>
/// Sends one templated email that is not about a ticket: a sign-in link, a guest
/// verification code, an invitation, a guest's ticket confirmation.
///
/// **Why this exists.** These four used to inject <see cref="IEmailSender"/> —
/// the *deployment-level* relay from `appsettings`, or the dev logger. They never
/// touched the provider an admin connected in the UI. So on a self-hosted install
/// where someone connected Google, watched the test go green, and read the test
/// email's own claim that "sign-in codes, invitations and ticket notifications
/// can reach people", the sign-in codes were going to a relay that on most
/// installs is unset — written to the server log and delivered to nobody.
///
/// That is invariant 8 territory: the way in is the mail that is not being sent.
///
/// **Why not just call <see cref="NotificationService"/>.** That one is about a
/// ticket — it reads notification toggles, computes a threading Reply-To and
/// stamps a Message-ID against a comment. None of that applies to an invitation,
/// and a sign-in email must not invite a reply.
/// </summary>
public class TransactionalMailer(
    TracklyDbContext db,
    EmailProviderService providers,
    EmailTemplateService templates,
    IWorkspaceEmailSender sender)
{
    /// <summary>
    /// Renders <paramref name="templateKey"/> and sends it through whatever the
    /// workspace sends with.
    ///
    /// **Throws on failure**, unlike ticket notifications, which log and carry on.
    /// The difference is what the caller has already promised: a ticket write has
    /// happened either way, but "check your email" is a promise about the email.
    /// Reporting success for a sign-in code that was never accepted by a relay
    /// leaves someone waiting on a message that is not coming, with no way to
    /// find out why. The one caller that genuinely should not fail — the guest
    /// confirmation, sent after the ticket already exists — catches it there,
    /// where that is visible.
    /// </summary>
    public async Task SendAsync(
        Guid workspaceId, string toEmail, string? toName, string templateKey,
        Dictionary<string, string?> variables, CancellationToken ct)
    {
        var rendered = await templates.RenderAsync(workspaceId, templateKey, variables, ct);
        var (fromEmail, fromName) = await FromAsync(workspaceId, ct);

        // Null resolves to the shared deployment relay — or the dev logger, which
        // is what keeps a machine with nothing configured working exactly as it
        // did before this was routed.
        var smtp = await providers.ResolveSenderAsync(workspaceId, ct);

        await sender.SendAsync(smtp, new EmailMessage(
            toEmail,
            rendered.Subject,
            rendered.Text,
            HtmlBody: rendered.Html,
            ToName: toName,
            FromEmail: fromEmail,
            FromName: fromName), ct);
    }

    /// <summary>
    /// Who the message is from.
    ///
    /// Has to agree with <see cref="NotificationService"/>'s resolution: a
    /// sign-in email and a ticket notification arriving from two different names
    /// look like two different products, and one of them looks like a phish.
    /// </summary>
    private async Task<(string? Email, string Name)> FromAsync(Guid workspaceId, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);

        return (config?.FromEmail, config?.FromName ?? branding?.PageTitle ?? workspace.Name);
    }
}
