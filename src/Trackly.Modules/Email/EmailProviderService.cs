using Microsoft.EntityFrameworkCore;
using Trackly.Core.Email;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Email;

/// <summary>
/// Everything the app does with a configured mail provider: list them, save one,
/// designate which sends and which receives, and turn the designated one into a
/// live transport.
///
/// **This is the only place that knows how a provider row becomes a connection.**
/// The polling worker, the notification sender and the test button all ask here,
/// so there is one answer to "what are we actually sending through" rather than
/// three that can disagree.
/// </summary>
public class EmailProviderService(TracklyDbContext db, ISecretProtector secrets)
{
    /// <summary>
    /// Every supported provider, configured or not — the card grid renders this
    /// directly. Same shape as `ChannelsController.List`: a provider with no row
    /// is a card that says "Not connected", not an absent card.
    /// </summary>
    public async Task<IReadOnlyList<(EmailProviderDescriptor Descriptor, EmailProvider? Row)>> ListAsync(
        Guid workspaceId, CancellationToken ct)
    {
        var rows = await db.EmailProviders.Where(p => p.WorkspaceId == workspaceId).ToListAsync(ct);
        return EmailProviderCatalog.All
            .Select(d => (d, rows.FirstOrDefault(r => r.Provider == d.Provider)))
            .ToList();
    }

    public Task<EmailProvider?> FindAsync(Guid workspaceId, string provider, CancellationToken ct)
        => db.EmailProviders.SingleOrDefaultAsync(p => p.WorkspaceId == workspaceId && p.Provider == provider, ct);

    public async Task<EmailProvider> GetOrCreateAsync(Guid workspaceId, string provider, CancellationToken ct)
    {
        var row = await FindAsync(workspaceId, provider, ct);
        if (row is null)
        {
            row = new EmailProvider { WorkspaceId = workspaceId, Provider = provider };
            db.EmailProviders.Add(row);
        }
        return row;
    }

    /// <summary>
    /// Clears the installation-wide proof that outbound email works.
    ///
    /// **Call this from every mutation that could change how mail is sent.** The
    /// flag gates whether password sign-in may be turned off (invariant 8), and a
    /// proof carried over from a provider that is no longer sending is exactly the
    /// false "email works" that ends in a permanent lockout. One method rather
    /// than a line in each caller, because the caller that forgets is the one that
    /// causes it.
    /// </summary>
    public async Task InvalidateProofAsync(Guid workspaceId, CancellationToken ct)
    {
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null) return;
        config.LastVerifiedAt = null;
        config.UpdatedAt = DateTime.UtcNow;
    }

    // ---- Resolution: a row becomes a transport ------------------------------

    /// <summary>
    /// SMTP settings for the designated sending provider, or **null meaning "use
    /// the shared deployment relay"** — which is what a workspace that has never
    /// configured anything is on, and what `IWorkspaceEmailSender` already
    /// understands.
    ///
    /// **Every outbound path must call this** — notifications, announcements and
    /// the email test alike. The test is the only evidence invariant 8 accepts
    /// that mail works, so if it resolved its transport differently from the real
    /// senders it would prove the wrong thing, and a proof about the wrong relay
    /// is what unlocks turning off the last working way in.
    /// </summary>
    public async Task<SmtpSettings?> ResolveSenderAsync(Guid workspaceId, CancellationToken ct)
    {
        var config = await db.EmailConfigs
            .Include(c => c.SendingProvider)
            .SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null) return null;

        if (config.SendingProvider is { Enabled: true } provider)
            return ToSmtp(provider);

        return LegacySmtp(config);
    }

    /// <summary>
    /// The pre-providers SMTP columns on `email_configs`.
    ///
    /// **Deprecated, and load-bearing until it isn't.** The migration copies these
    /// into an `smtp` provider row and points `sending_provider_id` at it, so a
    /// migrated installation never reaches here — but one that rolls back, or that
    /// clears its designation, still has mail to send. The columns are dropped a
    /// release later; this method goes with them.
    /// </summary>
    private SmtpSettings? LegacySmtp(EmailConfig config)
    {
        if (config is not { UseSharedSmtp: false, SmtpHost: { Length: > 0 } host }) return null;
        var password = config.SmtpPasswordEncrypted is { Length: > 0 } enc ? secrets.Unprotect(enc) : null;
        return new SmtpSettings(host, config.SmtpPort ?? 587, config.SmtpUser, password, config.SmtpUseStartTls);
    }

    /// <summary>
    /// The mailbox to poll, or null when nothing is designated for receiving —
    /// which is the normal state for an installation on a parse webhook, or one
    /// that does not take mail in at all.
    /// </summary>
    public async Task<MailboxConnection?> ResolveReceiverAsync(Guid workspaceId, CancellationToken ct)
    {
        var config = await db.EmailConfigs
            .Include(c => c.ReceivingProvider)
            .SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        return config is null ? null : ResolveReceiver(config);
    }

    /// <summary>
    /// Same resolution for a config the caller already loaded — the polling worker
    /// reads every workspace's config per tick and must not re-query one at a time.
    /// Requires <c>Include(c =&gt; c.ReceivingProvider)</c>.
    /// </summary>
    public MailboxConnection? ResolveReceiver(EmailConfig config)
    {
        if (config.ReceivingProvider is { Enabled: true } provider)
            return ToMailbox(provider);

        return LegacyMailbox(config);
    }

    /// <summary>
    /// The pre-providers mailbox columns. Deprecated alongside
    /// <see cref="LegacySmtp"/>, and kept for the same reason: an installation
    /// that was polling before this release keeps polling after it.
    /// </summary>
    private MailboxConnection? LegacyMailbox(EmailConfig config)
    {
        if (config.InboundConnector != InboundConnector.MailboxPoll) return null;
        if (config.MailboxProtocol != MailboxProtocol.Imap) return null;
        if (config.MailboxHost is not { Length: > 0 } host) return null;
        if (config.MailboxUsername is not { Length: > 0 } username) return null;
        if (config.MailboxPasswordEncrypted is not { Length: > 0 } encrypted) return null;

        return new MailboxConnection(host, config.MailboxPort ?? 993, username, secrets.Unprotect(encrypted));
    }

    /// <summary>
    /// Provider row → SMTP connection.
    ///
    /// **OAuth providers resolve by password here, on purpose.** Google, Microsoft
    /// and Yahoo all accept an app password over ordinary SMTP, and that is the
    /// only credential Trackly can hold until the OAuth handshake ships. Refusing
    /// to use one would leave three of the five cards decorative for a release
    /// while the connection an admin set up sat unused. Phase 2 prefers XOAUTH2
    /// when tokens are present and this stays as the fallback.
    /// </summary>
    public SmtpSettings? ToSmtp(EmailProvider provider)
    {
        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || !descriptor.CanSend) return null;

        var host = descriptor.Provider == EmailProviderKind.Ses
            ? EmailProviderCatalog.SesSmtpHost(provider.SesRegion)
            : provider.SmtpHost ?? descriptor.SmtpHost;
        if (string.IsNullOrWhiteSpace(host)) return null;

        var (username, encrypted) = descriptor.Provider == EmailProviderKind.Ses
            ? (provider.SesAccessKeyId, provider.SesSecretKeyEncrypted)
            : (provider.SmtpUsername, provider.SmtpPasswordEncrypted);

        var password = encrypted is { Length: > 0 } value ? secrets.Unprotect(value) : null;

        return new SmtpSettings(
            host,
            provider.SmtpPort ?? descriptor.SmtpPort ?? 587,
            username,
            password,
            provider.SmtpUseStartTls);
    }

    /// <summary>
    /// Provider row → IMAP connection, or null when it cannot receive. App
    /// passwords serve the OAuth providers here for the same reason as
    /// <see cref="ToSmtp"/>.
    /// </summary>
    public MailboxConnection? ToMailbox(EmailProvider provider)
    {
        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || !descriptor.CanReceive) return null;

        var host = provider.ImapHost ?? descriptor.ImapHost;
        if (string.IsNullOrWhiteSpace(host)) return null;
        if (provider.ImapUsername is not { Length: > 0 } username) return null;
        if (provider.ImapPasswordEncrypted is not { Length: > 0 } encrypted) return null;

        return new MailboxConnection(
            host,
            provider.ImapPort ?? descriptor.ImapPort ?? 993,
            username,
            secrets.Unprotect(encrypted));
    }

    // ---- Secrets ------------------------------------------------------------

    /// <summary>
    /// null keeps what is stored, "" clears it, anything else is encrypted.
    ///
    /// The same three-way rule the rest of the admin API uses. A blank box means
    /// "leave it alone", which is what stops a save from wiping a password the
    /// admin can no longer read back.
    /// </summary>
    public string? ApplySecret(string? existing, string? incoming) => incoming switch
    {
        null => existing,
        "" => null,
        _ => secrets.Protect(incoming),
    };
}
