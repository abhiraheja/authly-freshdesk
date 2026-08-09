using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Email;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

/// <summary>
/// The mail providers this installation can send and receive through.
///
/// Secrets are write-only throughout (invariant 3): the response carries `has*`
/// booleans, and on save a null secret keeps what is stored, `""` clears it.
///
/// **Every mutation here clears `email_configs.last_verified_at`.** That flag is
/// the proof outbound email works, and `LoginSettingsController` will not let an
/// admin turn off password sign-in without it (invariant 8). Changing how mail is
/// sent invalidates the proof, and leaving it standing is how an installation
/// locks itself out.
/// </summary>
[ApiController]
[Route("api/admin/email/providers")]
[Authorize(Policy = "Admin")]
public class EmailProvidersController(
    TracklyDbContext db,
    EmailProviderService providers) : ControllerBase
{
    public record SaveProviderRequest(
        bool? Enabled,
        string? AccountEmail,
        // OAuth — the operator's own app registration. Phase 2 uses these.
        string? OauthClientId, string? OauthClientSecret,
        // SMTP
        string? SmtpHost, int? SmtpPort, string? SmtpUsername, string? SmtpPassword, bool? SmtpUseStartTls,
        // IMAP
        string? ImapHost, int? ImapPort, string? ImapUsername, string? ImapPassword,
        // SES
        string? SesRegion, string? SesAccessKeyId, string? SesSecretKey);

    public record RolesRequest(string? SendingProvider, string? ReceivingProvider);

    public record ConfigRequest(
        string? FromName, string? FromEmail,
        string EmailMode, bool NewTicketViaEmail,
        string? InboundConnector, string? InboundProvider,
        string? InboundReplyDomain, string? InboundWebhookSecret,
        int? PollIntervalSeconds);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var rows = await providers.ListAsync(workspaceId, ct);
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);

        return Ok(new
        {
            providers = rows.Select(r => ToResponse(r.Descriptor, r.Row)),
            // Which one does which job, by provider key rather than id — the id is
            // an implementation detail the screen has no other use for.
            sendingProvider = KeyOf(rows, config?.SendingProviderId),
            receivingProvider = KeyOf(rows, config?.ReceivingProviderId),
            lastVerifiedAt = config?.LastVerifiedAt,
        });
    }

    [HttpPut("{provider}")]
    public async Task<IActionResult> Save(
        string provider, [FromBody] SaveProviderRequest request, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return NotFound();

        var workspaceId = User.GetWorkspaceId();
        var row = await providers.GetOrCreateAsync(workspaceId, descriptor.Provider, ct);

        if (request.Enabled is { } enabled) row.Enabled = enabled;
        row.AccountEmail = NullIfEmpty(request.AccountEmail);

        row.OauthClientId = NullIfEmpty(request.OauthClientId);
        row.OauthClientSecretEncrypted =
            providers.ApplySecret(row.OauthClientSecretEncrypted, request.OauthClientSecret);

        row.SmtpHost = NullIfEmpty(request.SmtpHost);
        row.SmtpPort = request.SmtpPort;
        row.SmtpUsername = NullIfEmpty(request.SmtpUsername);
        row.SmtpPasswordEncrypted = providers.ApplySecret(row.SmtpPasswordEncrypted, request.SmtpPassword);
        if (request.SmtpUseStartTls is { } tls) row.SmtpUseStartTls = tls;

        row.ImapHost = NullIfEmpty(request.ImapHost);
        row.ImapPort = request.ImapPort;
        row.ImapUsername = NullIfEmpty(request.ImapUsername);
        row.ImapPasswordEncrypted = providers.ApplySecret(row.ImapPasswordEncrypted, request.ImapPassword);

        row.SesRegion = NullIfEmpty(request.SesRegion);
        row.SesAccessKeyId = NullIfEmpty(request.SesAccessKeyId);
        row.SesSecretKeyEncrypted = providers.ApplySecret(row.SesSecretKeyEncrypted, request.SesSecretKey);

        // The credentials changed, so whatever this provider proved before is
        // about settings that no longer exist.
        row.LastVerifiedAt = null;
        row.LastError = null;
        row.UpdatedAt = DateTime.UtcNow;

        await providers.InvalidateProofAsync(workspaceId, ct);
        await db.SaveChangesAsync(ct);

        return Ok(ToResponse(descriptor, row));
    }

    /// <summary>
    /// Forgets a provider's credentials. The row goes with them — a disabled
    /// provider that still holds a password is a stored secret nobody believes
    /// exists.
    /// </summary>
    [HttpDelete("{provider}")]
    public async Task<IActionResult> Disconnect(string provider, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return NotFound();

        var workspaceId = User.GetWorkspaceId();
        var row = await providers.FindAsync(workspaceId, descriptor.Provider, ct);
        if (row is null) return NoContent();

        // The FK is SetNull, so the pointers clear themselves — but only after
        // SaveChanges, and the proof has to go in the same transaction.
        db.EmailProviders.Remove(row);
        await providers.InvalidateProofAsync(workspaceId, ct);
        await db.SaveChangesAsync(ct);

        return NoContent();
    }

    /// <summary>
    /// Which provider sends and which receives. Passing null for either clears it
    /// — for sending that means falling back to the shared deployment relay.
    /// </summary>
    [HttpPut("~/api/admin/email/roles")]
    public async Task<IActionResult> SetRoles([FromBody] RolesRequest request, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null)
        {
            config = new EmailConfig { WorkspaceId = workspaceId };
            db.EmailConfigs.Add(config);
        }

        var sending = await ResolveRoleAsync(workspaceId, request.SendingProvider, send: true, ct);
        if (sending.Error is { } sendError) return BadRequest(new { error = sendError });

        var receiving = await ResolveRoleAsync(workspaceId, request.ReceivingProvider, send: false, ct);
        if (receiving.Error is { } receiveError) return BadRequest(new { error = receiveError });

        config.SendingProviderId = sending.Id;
        config.ReceivingProviderId = receiving.Id;
        // Changing the sender changes what a delivered test proved.
        config.LastVerifiedAt = null;
        config.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(new
        {
            sendingProvider = request.SendingProvider,
            receivingProvider = request.ReceivingProvider,
            lastVerifiedAt = config.LastVerifiedAt,
        });
    }

    /// <summary>
    /// The settings that belong to the installation rather than to one provider:
    /// who mail appears to come from, whether replies come back, and where a parse
    /// webhook posts.
    ///
    /// **Deliberately not `PUT /api/admin/settings/email`.** That one still writes
    /// the deprecated SMTP and mailbox columns, so a screen that no longer edits
    /// them would clear them on every save — quietly deleting the credentials an
    /// installation would fall back to if this release were rolled back.
    /// </summary>
    [HttpGet("~/api/admin/email/config")]
    public async Task<IActionResult> GetConfig(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct)
                     ?? new EmailConfig { WorkspaceId = workspaceId };
        return Ok(ToConfigResponse(config));
    }

    [HttpPut("~/api/admin/email/config")]
    public async Task<IActionResult> SaveConfig([FromBody] ConfigRequest request, CancellationToken ct)
    {
        if (!EmailMode.All.Contains(request.EmailMode))
            return BadRequest(new { error = "Invalid email mode." });
        // Fully qualified: the request record's own properties shadow the
        // constant classes of the same name.
        if (request.InboundConnector is not null
            && !Trackly.Core.Entities.InboundConnector.All.Contains(request.InboundConnector))
            return BadRequest(new { error = "Invalid inbound connector." });
        if (request.InboundProvider is not null
            && !Trackly.Core.Entities.InboundProvider.All.Contains(request.InboundProvider))
            return BadRequest(new { error = "Invalid inbound provider." });

        var workspaceId = User.GetWorkspaceId();
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null)
        {
            config = new EmailConfig { WorkspaceId = workspaceId };
            db.EmailConfigs.Add(config);
        }

        config.FromName = NullIfEmpty(request.FromName);
        config.FromEmail = NullIfEmpty(request.FromEmail);
        config.EmailMode = request.EmailMode;
        config.NewTicketViaEmail = request.NewTicketViaEmail;
        config.InboundConnector = NullIfEmpty(request.InboundConnector);
        config.InboundProvider = NullIfEmpty(request.InboundProvider);
        config.InboundReplyDomain = NullIfEmpty(request.InboundReplyDomain);
        config.InboundWebhookSecretEncrypted =
            providers.ApplySecret(config.InboundWebhookSecretEncrypted, request.InboundWebhookSecret);
        config.PollIntervalSeconds = Math.Clamp(request.PollIntervalSeconds ?? config.PollIntervalSeconds, 30, 3600);

        // The From address is part of what a delivered test proved: mail that
        // arrived as one sender can be rejected as another.
        config.LastVerifiedAt = null;
        config.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(ToConfigResponse(config));
    }

    /// <summary>
    /// Connects and authenticates, without sending anything.
    ///
    /// Deliberately **not** the same thing as the email test on
    /// `EmailSettingsController`: this proves one provider's credentials, that one
    /// proves the installation can deliver. Only the latter satisfies invariant 8,
    /// which is why this never writes `email_configs.last_verified_at` — proving
    /// Yahoo authenticates says nothing about an installation sending via Google.
    /// </summary>
    [HttpPost("{provider}/test")]
    public async Task<IActionResult> Test(
        string provider, [FromServices] IMailboxReader reader, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return NotFound();

        var workspaceId = User.GetWorkspaceId();
        var row = await providers.FindAsync(workspaceId, descriptor.Provider, ct);
        if (row is null) return BadRequest(new { ok = false, error = "That provider is not configured yet." });

        var mailbox = providers.ToMailbox(row);
        if (mailbox is null)
            return Ok(new { ok = false, error = "Add a mailbox host, username and password to test receiving." });

        try
        {
            // Zero messages handled — connecting and authenticating is the whole
            // question, and consuming mail as a side effect of a test button would
            // be a genuinely surprising thing to do.
            await reader.PollAsync(mailbox, (_, _) => Task.CompletedTask, ct);
            row.LastVerifiedAt = DateTime.UtcNow;
            row.LastError = null;
        }
        catch (Exception ex)
        {
            // Reported, not thrown: a failed test is the answer to the question the
            // admin asked, and the message is the useful part of it.
            row.LastError = ex.Message;
            await db.SaveChangesAsync(ct);
            return Ok(new { ok = false, error = ex.Message });
        }

        await db.SaveChangesAsync(ct);
        return Ok(new { ok = true, verifiedAt = row.LastVerifiedAt });
    }

    // ---- Helpers -------------------------------------------------------------

    private async Task<(Guid? Id, string? Error)> ResolveRoleAsync(
        Guid workspaceId, string? provider, bool send, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(provider)) return (null, null);

        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return (null, "Unknown provider.");
        if (send && !descriptor.CanSend) return (null, $"{descriptor.DisplayName} cannot send email.");
        if (!send && !descriptor.CanReceive) return (null, $"{descriptor.DisplayName} cannot receive email.");

        var row = await providers.FindAsync(workspaceId, descriptor.Provider, ct);
        if (row is null) return (null, $"Configure {descriptor.DisplayName} before assigning it.");
        if (!row.Enabled) return (null, $"Turn {descriptor.DisplayName} on before assigning it.");

        return (row.Id, null);
    }

    private static string? KeyOf(
        IReadOnlyList<(EmailProviderDescriptor Descriptor, EmailProvider? Row)> rows, Guid? id)
        => id is null ? null : rows.FirstOrDefault(r => r.Row?.Id == id).Row?.Provider;

    private static object ToResponse(EmailProviderDescriptor descriptor, EmailProvider? row) => new
    {
        provider = descriptor.Provider,
        displayName = descriptor.DisplayName,
        authKind = descriptor.AuthKind,
        canSend = descriptor.CanSend,
        canReceive = descriptor.CanReceive,
        paid = descriptor.Paid,
        setupDocsUrl = descriptor.SetupDocsUrl,
        // Defaults the screen shows as placeholders, so an admin can see what it
        // will use without having to type it.
        defaultSmtpHost = descriptor.SmtpHost,
        defaultSmtpPort = descriptor.SmtpPort,
        defaultImapHost = descriptor.ImapHost,
        defaultImapPort = descriptor.ImapPort,

        configured = row is not null,
        enabled = row?.Enabled ?? false,
        accountEmail = row?.AccountEmail,
        oauthClientId = row?.OauthClientId,
        hasOauthClientSecret = row?.OauthClientSecretEncrypted is { Length: > 0 },
        connected = row?.OauthTokensEncrypted is { Length: > 0 },
        smtpHost = row?.SmtpHost,
        smtpPort = row?.SmtpPort,
        smtpUsername = row?.SmtpUsername,
        hasSmtpPassword = row?.SmtpPasswordEncrypted is { Length: > 0 },
        smtpUseStartTls = row?.SmtpUseStartTls ?? true,
        imapHost = row?.ImapHost,
        imapPort = row?.ImapPort,
        imapUsername = row?.ImapUsername,
        hasImapPassword = row?.ImapPasswordEncrypted is { Length: > 0 },
        sesRegion = row?.SesRegion,
        sesAccessKeyId = row?.SesAccessKeyId,
        hasSesSecretKey = row?.SesSecretKeyEncrypted is { Length: > 0 },
        lastVerifiedAt = row?.LastVerifiedAt,
        lastError = row?.LastError,
    };

    private static object ToConfigResponse(EmailConfig c) => new
    {
        fromName = c.FromName,
        fromEmail = c.FromEmail,
        emailMode = c.EmailMode,
        newTicketViaEmail = c.NewTicketViaEmail,
        inboundConnector = c.InboundConnector,
        inboundProvider = c.InboundProvider,
        inboundReplyDomain = c.InboundReplyDomain,
        hasInboundWebhookSecret = c.InboundWebhookSecretEncrypted is { Length: > 0 },
        pollIntervalSeconds = c.PollIntervalSeconds,
        lastPolledAt = c.LastPolledAt,
        lastVerifiedAt = c.LastVerifiedAt,
    };

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
