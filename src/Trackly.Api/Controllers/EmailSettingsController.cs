using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

// Admin-only email configuration. Secrets are never returned — the response
// exposes has*Secret booleans instead (invariant 3). On update, a secret field
// left null keeps the stored value, "" clears it, and any other value is
// AES-256-GCM encrypted before storage.
[ApiController]
[Authorize(Policy = "Admin")]
public class EmailSettingsController(TracklyDbContext db, ISecretProtector secrets) : ControllerBase
{
    public record UpdateEmailConfigRequest(
        bool UseSharedSmtp,
        string? SmtpHost, int? SmtpPort, string? SmtpUser, bool SmtpUseStartTls,
        string? FromName, string? FromEmail, string? SmtpPassword,
        string EmailMode, bool NewTicketViaEmail,
        string? InboundConnector, string? InboundProvider, string? InboundReplyDomain, string? InboundWebhookSecret,
        string? MailboxProtocol, string? MailboxAddress, string? MailboxHost, int? MailboxPort, string? MailboxUsername,
        string? MailboxPassword, int? PollIntervalSeconds);

    public record UpdateNotificationSettingsRequest(
        bool NotifyCustomerOnCreate, bool NotifyCustomerOnReply, bool NotifyCustomerOnStatus,
        bool NotifyAgentOnAssign, bool NotifyAgentOnReply, bool NotifyAgentOnReassign,
        bool CsatEnabled);

    // ---- Email config --------------------------------------------------------

    [HttpGet("api/admin/settings/email")]
    public async Task<IActionResult> GetEmail(CancellationToken ct)
        => Ok(ToResponse(await GetOrCreateConfigAsync(ct)));

    [HttpPut("api/admin/settings/email")]
    public async Task<IActionResult> UpdateEmail([FromBody] UpdateEmailConfigRequest req, CancellationToken ct)
    {
        if (!EmailMode.All.Contains(req.EmailMode))
            return BadRequest(new { error = "Invalid email mode." });
        if (req.InboundConnector is not null && !InboundConnector.All.Contains(req.InboundConnector))
            return BadRequest(new { error = "Invalid inbound connector." });
        if (req.InboundProvider is not null && !InboundProvider.All.Contains(req.InboundProvider))
            return BadRequest(new { error = "Invalid inbound provider." });
        if (req.MailboxProtocol is not null && !MailboxProtocol.All.Contains(req.MailboxProtocol))
            return BadRequest(new { error = "Invalid mailbox protocol." });

        var config = await GetOrCreateConfigAsync(ct);

        config.UseSharedSmtp = req.UseSharedSmtp;
        config.SmtpHost = NullIfEmpty(req.SmtpHost);
        config.SmtpPort = req.SmtpPort;
        config.SmtpUser = NullIfEmpty(req.SmtpUser);
        config.SmtpUseStartTls = req.SmtpUseStartTls;
        config.FromName = NullIfEmpty(req.FromName);
        config.FromEmail = NullIfEmpty(req.FromEmail);
        config.SmtpPasswordEncrypted = ApplySecret(config.SmtpPasswordEncrypted, req.SmtpPassword);

        config.EmailMode = req.EmailMode;
        config.NewTicketViaEmail = req.NewTicketViaEmail;

        config.InboundConnector = NullIfEmpty(req.InboundConnector);
        config.InboundProvider = NullIfEmpty(req.InboundProvider);
        config.InboundReplyDomain = NullIfEmpty(req.InboundReplyDomain);
        config.InboundWebhookSecretEncrypted = ApplySecret(config.InboundWebhookSecretEncrypted, req.InboundWebhookSecret);

        config.MailboxProtocol = NullIfEmpty(req.MailboxProtocol);
        config.MailboxAddress = NullIfEmpty(req.MailboxAddress);
        config.MailboxHost = NullIfEmpty(req.MailboxHost);
        config.MailboxPort = req.MailboxPort;
        config.MailboxUsername = NullIfEmpty(req.MailboxUsername);
        config.MailboxPasswordEncrypted = ApplySecret(config.MailboxPasswordEncrypted, req.MailboxPassword);
        config.PollIntervalSeconds = Math.Clamp(req.PollIntervalSeconds ?? config.PollIntervalSeconds, 30, 3600);

        // Any change invalidates the proof: the last successful test was about
        // the previous settings, and turning off password sign-in leans on this
        // flag. Re-test after editing.
        config.LastVerifiedAt = null;

        config.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(config));
    }

    /// <summary>
    /// Sends a real message to the caller and records that it worked.
    ///
    /// This is the only evidence Trackly has that outbound email functions, and
    /// <see cref="LoginSettingsController"/> requires it before password sign-in
    /// can be turned off. A configuration that merely *looks* complete is not
    /// enough — the failure mode it guards against is nobody being able to log in.
    /// </summary>
    [HttpPost("api/admin/settings/email/test")]
    public async Task<IActionResult> TestEmail(
        [FromServices] IWorkspaceEmailSender sender,
        [FromServices] EmailProviderService providers,
        CancellationToken ct)
    {
        var to = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        if (string.IsNullOrWhiteSpace(to))
            return BadRequest(new { ok = false, error = "Your account has no email address to send a test to." });

        var config = await GetOrCreateConfigAsync(ct);

        // The one resolver every outbound path uses: the designated sending
        // provider, else the deprecated email_configs columns, else the shared
        // relay. Resolving it here a second way is how the test comes back green
        // for a transport nothing actually sends through.
        var smtp = await providers.ResolveSenderAsync(User.GetWorkspaceId(), ct);

        try
        {
            await sender.SendAsync(smtp, new EmailMessage(
                to,
                "Trackly email test",
                """
                This is a test message from Trackly.

                If you are reading it, outbound email works and sign-in codes,
                invitations and ticket notifications can reach people.
                """,
                FromEmail: config.FromEmail,
                FromName: config.FromName), ct);
        }
        catch (Exception ex)
        {
            // Reported, not thrown: a failed test is an answer to the question the
            // admin asked, and the message is the useful part of it.
            return Ok(new { ok = false, error = ex.Message });
        }

        config.LastVerifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(new { ok = true, sentTo = to, verifiedAt = config.LastVerifiedAt });
    }

    // ---- Notification settings ----------------------------------------------

    [HttpGet("api/admin/settings/notifications")]
    public async Task<IActionResult> GetNotifications(CancellationToken ct)
        => Ok(ToResponse(await GetOrCreateNotificationsAsync(ct)));

    [HttpPut("api/admin/settings/notifications")]
    public async Task<IActionResult> UpdateNotifications(
        [FromBody] UpdateNotificationSettingsRequest req, CancellationToken ct)
    {
        var s = await GetOrCreateNotificationsAsync(ct);
        s.NotifyCustomerOnCreate = req.NotifyCustomerOnCreate;
        s.NotifyCustomerOnReply = req.NotifyCustomerOnReply;
        s.NotifyCustomerOnStatus = req.NotifyCustomerOnStatus;
        s.NotifyAgentOnAssign = req.NotifyAgentOnAssign;
        s.NotifyAgentOnReply = req.NotifyAgentOnReply;
        s.NotifyAgentOnReassign = req.NotifyAgentOnReassign;
        s.CsatEnabled = req.CsatEnabled;
        s.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(s));
    }

    // ---- Helpers -------------------------------------------------------------

    private async Task<EmailConfig> GetOrCreateConfigAsync(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null)
        {
            config = new EmailConfig { WorkspaceId = workspaceId };
            db.EmailConfigs.Add(config);
        }
        return config;
    }

    private async Task<NotificationSettings> GetOrCreateNotificationsAsync(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var settings = await db.NotificationSettings.SingleOrDefaultAsync(s => s.WorkspaceId == workspaceId, ct);
        if (settings is null)
        {
            settings = new NotificationSettings { WorkspaceId = workspaceId };
            db.NotificationSettings.Add(settings);
        }
        return settings;
    }

    // null → keep existing, "" → clear, otherwise encrypt.
    private string? ApplySecret(string? existing, string? incoming) => incoming switch
    {
        null => existing,
        "" => null,
        _ => secrets.Protect(incoming),
    };

    private static object ToResponse(EmailConfig c) => new
    {
        useSharedSmtp = c.UseSharedSmtp,
        lastVerifiedAt = c.LastVerifiedAt,
        smtpHost = c.SmtpHost,
        smtpPort = c.SmtpPort,
        smtpUser = c.SmtpUser,
        smtpUseStartTls = c.SmtpUseStartTls,
        fromName = c.FromName,
        fromEmail = c.FromEmail,
        hasSmtpPassword = !string.IsNullOrEmpty(c.SmtpPasswordEncrypted),
        emailMode = c.EmailMode,
        newTicketViaEmail = c.NewTicketViaEmail,
        inboundConnector = c.InboundConnector,
        inboundProvider = c.InboundProvider,
        inboundReplyDomain = c.InboundReplyDomain,
        hasInboundWebhookSecret = !string.IsNullOrEmpty(c.InboundWebhookSecretEncrypted),
        mailboxProtocol = c.MailboxProtocol,
        mailboxAddress = c.MailboxAddress,
        mailboxHost = c.MailboxHost,
        mailboxPort = c.MailboxPort,
        mailboxUsername = c.MailboxUsername,
        hasMailboxPassword = !string.IsNullOrEmpty(c.MailboxPasswordEncrypted),
        pollIntervalSeconds = c.PollIntervalSeconds,
        lastPolledAt = c.LastPolledAt,
    };

    private static object ToResponse(NotificationSettings s) => new
    {
        notifyCustomerOnCreate = s.NotifyCustomerOnCreate,
        notifyCustomerOnReply = s.NotifyCustomerOnReply,
        notifyCustomerOnStatus = s.NotifyCustomerOnStatus,
        notifyAgentOnAssign = s.NotifyAgentOnAssign,
        notifyAgentOnReply = s.NotifyAgentOnReply,
        notifyAgentOnReassign = s.NotifyAgentOnReassign,
        csatEnabled = s.CsatEnabled,
    };

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
