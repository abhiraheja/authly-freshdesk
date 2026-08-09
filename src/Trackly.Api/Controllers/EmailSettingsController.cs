using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

// Admin-only email settings that are not a provider's credentials: the delivery
// test, and the notification switches.
//
// **`GET`/`PUT /api/admin/settings/email` used to live here and is gone.** It was
// the last writer of the SMTP and mailbox columns on `email_configs`, which the
// EmailProviderCleanup migration dropped — an endpoint whose whole request body
// no longer has anywhere to go. What replaced it is two narrower things:
// `/api/admin/email/config` for installation-level settings and
// `/api/admin/email/providers` for credentials. The retiring React screen is the
// only caller left and it goes in the SPA cleanup pass.
[ApiController]
[Authorize(Policy = "Admin")]
public class EmailSettingsController(TracklyDbContext db) : ControllerBase
{
    public record UpdateNotificationSettingsRequest(
        bool NotifyCustomerOnCreate, bool NotifyCustomerOnReply, bool NotifyCustomerOnStatus,
        bool NotifyAgentOnAssign, bool NotifyAgentOnReply, bool NotifyAgentOnReassign,
        bool CsatEnabled);

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
        [FromServices] EmailTemplateService templates,
        CancellationToken ct)
    {
        var to = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        if (string.IsNullOrWhiteSpace(to))
            return BadRequest(new { ok = false, error = "Your account has no email address to send a test to." });

        var config = await GetOrCreateConfigAsync(ct);

        try
        {
            // The one resolver every outbound path uses: the designated sending
            // provider, else null meaning the shared deployment relay. Resolving
            // it here a second way is how the test comes back green for a
            // transport nothing actually sends through.
            //
            // Inside the try because resolving renews an OAuth access token, and
            // a connection that cannot be renewed throws. That is a failed test,
            // not a failed request — the admin needs the message, not a 500.
            var smtp = await providers.ResolveSenderAsync(User.GetWorkspaceId(), ct);

            // Through the template pipeline like everything else, so the message
            // that proves email works is also the message that shows what the
            // workspace's email actually looks like — layout, logo and colour.
            // A bare-text probe would pass while the branded layout was broken.
            var rendered = await templates.RenderAsync(
                User.GetWorkspaceId(), "email_test", new Dictionary<string, string?>(), ct);

            await sender.SendAsync(smtp, new EmailMessage(
                to,
                rendered.Subject,
                rendered.Text,
                HtmlBody: rendered.Html,
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
}
