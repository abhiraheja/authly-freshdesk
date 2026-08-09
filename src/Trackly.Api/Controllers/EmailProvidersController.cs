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
    EmailProviderService providers,
    IConfiguration configuration) : ControllerBase
{
    public record SaveProviderRequest(
        bool? Enabled,
        string? AccountEmail,
        // OAuth — the operator's own app registration. `OauthTenantId` is
        // Microsoft-only and not a secret: it is a directory identifier that
        // appears in every sign-in URL.
        string? OauthClientId, string? OauthClientSecret, string? OauthTenantId,
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
            // Surfaced so the admin can paste it into their own Google or Entra
            // console. A redirect URI that differs by one character from the
            // registered one fails at the provider with a message that never
            // reaches Trackly, and it is the most common way this setup goes wrong.
            oauthRedirectUri = EmailOAuthController.CallbackUri(configuration),
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
        row.OauthTenantId = NullIfEmpty(request.OauthTenantId);

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
    /// Starts the OAuth handshake. Returns the provider's authorize URL for the
    /// browser to be sent to — a full-page redirect, not a popup, so it survives
    /// popup blockers and embedded browser views.
    /// </summary>
    [HttpPost("{provider}/connect")]
    public async Task<IActionResult> Connect(string provider, CancellationToken ct)
    {
        var (authorizeUrl, error) = await providers.StartConnectAsync(
            User.GetWorkspaceId(), provider,
            EmailOAuthController.CallbackUri(configuration), ct);

        if (error is not null) return BadRequest(new { error });
        return Ok(new { authorizeUrl });
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

        // Before the row goes: once it is gone there is no refresh token left to
        // hand back, and an admin who disconnected would be leaving a live grant
        // on their Google account with no way to find it from here.
        await providers.RevokeAsync(row, ct);

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
    /// Connects and authenticates, without sending anything or consuming any mail.
    ///
    /// **Tests whichever halves this card is actually configured for.** It used to
    /// test receiving only, which meant a send-only relay — the commonest thing an
    /// SMTP card is — had a Test button that could never do anything but refuse.
    /// A card configured for both is tested for both, and both results are
    /// reported: stopping at the first failure hides the second one behind a fix.
    ///
    /// Deliberately **not** the same thing as the email test on
    /// `EmailSettingsController`: this proves credentials, that one proves
    /// delivery. Only the latter satisfies invariant 8, which is why this never
    /// writes `email_configs.last_verified_at` — and the gap between the two is
    /// real, because a relay can authenticate perfectly and still refuse to carry
    /// your From address.
    /// </summary>
    [HttpPost("{provider}/test")]
    public async Task<IActionResult> Test(
        string provider,
        [FromServices] IMailboxReader reader,
        [FromServices] IWorkspaceEmailSender sender,
        CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return NotFound();

        var workspaceId = User.GetWorkspaceId();
        var row = await providers.FindAsync(workspaceId, descriptor.Provider, ct);
        if (row is null) return BadRequest(new { ok = false, error = "That provider is not configured yet." });

        SmtpSettings? smtp;
        MailboxConnection? mailbox;
        try
        {
            // Inside the try: resolving now renews an OAuth token, so "the
            // connection expired" is one of the answers this button exists to give.
            smtp = descriptor.CanSend ? await providers.ToSmtpAsync(row, ct) : null;
            mailbox = descriptor.CanReceive ? await providers.ToMailboxAsync(row, ct) : null;
        }
        catch (Exception ex)
        {
            return await FailAsync(row, ex.Message, ct);
        }

        if (smtp is null && mailbox is null)
            return Ok(new
            {
                ok = false,
                error = descriptor.AuthKind == EmailAuthKind.OAuth2
                    ? "Connect the account, or fill in the sending or receiving details, before testing."
                    : "Fill in the sending or receiving details before testing.",
            });

        // Both halves are attempted even when the first fails, and each failure is
        // labelled — "Authentication failed" on a card that does both says nothing
        // about which set of credentials is wrong.
        var failures = new List<string>();
        if (smtp is not null)
            failures.AddRange(await CheckAsync("Sending", () => sender.VerifyAsync(smtp, ct)));
        if (mailbox is not null)
            // Zero messages handled — connecting and authenticating is the whole
            // question, and consuming mail as a side effect of a test button would
            // be a genuinely surprising thing to do.
            failures.AddRange(await CheckAsync(
                "Receiving", () => reader.PollAsync(mailbox, (_, _) => Task.CompletedTask, ct)));

        if (failures.Count > 0) return await FailAsync(row, string.Join(" ", failures), ct);

        row.LastVerifiedAt = DateTime.UtcNow;
        row.LastError = null;
        await db.SaveChangesAsync(ct);
        return Ok(new { ok = true, verifiedAt = row.LastVerifiedAt });
    }

    /// One failure or none, so the caller can concatenate without a null check.
    private static async Task<string[]> CheckAsync(string half, Func<Task> probe)
    {
        try
        {
            await probe();
            return [];
        }
        catch (Exception ex)
        {
            return [$"{half}: {ex.Message}"];
        }
    }

    /// <summary>
    /// A failed test is the answer to the question the admin asked, so it comes
    /// back as `200 { ok: false }` rather than an error status — and it is written
    /// to the row as well, because the card has to be able to say so on its own
    /// once the toast is gone.
    /// </summary>
    private async Task<IActionResult> FailAsync(EmailProvider row, string error, CancellationToken ct)
    {
        row.LastError = error;
        await db.SaveChangesAsync(ct);
        return Ok(new { ok = false, error });
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
        // Drives one extra field on the card rather than a per-provider branch in
        // the SPA — the catalogue stays the single description of a provider.
        requiresTenant = descriptor.RequiresTenant,
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
        oauthTenantId = row?.OauthTenantId,
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
