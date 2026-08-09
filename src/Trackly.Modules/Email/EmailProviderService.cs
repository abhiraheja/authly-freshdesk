using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Email;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

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
public class EmailProviderService(
    TracklyDbContext db,
    ISecretProtector secrets,
    IEmailOAuthClient oauth,
    ILogger<EmailProviderService> logger)
{
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// An access token is refreshed inside this margin rather than at expiry —
    /// a token with four seconds left passes every check and then fails halfway
    /// through opening an IMAP connection.
    /// </summary>
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    /// <summary>
    /// One refresh at a time per provider row.
    ///
    /// The polling worker and an outbound send genuinely race here, and Google
    /// rotates the refresh token on use — so two concurrent refreshes end with one
    /// of them holding a token the provider has already invalidated, and inbound
    /// mail stops with an `invalid_grant` nobody was watching for. Static because
    /// this service is scoped and the race is between scopes.
    /// </summary>
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> RefreshLocks = new();

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
            return await ToSmtpAsync(provider, ct);

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
        return config is null ? null : await ResolveReceiverAsync(config, ct);
    }

    /// <summary>
    /// Same resolution for a config the caller already loaded — the polling worker
    /// reads every workspace's config per tick and must not re-query one at a time.
    /// Requires <c>Include(c =&gt; c.ReceivingProvider)</c>.
    ///
    /// Async because a connected provider's access token may need renewing first,
    /// and a token fetched now is the only kind worth having.
    /// </summary>
    public async Task<MailboxConnection?> ResolveReceiverAsync(EmailConfig config, CancellationToken ct)
    {
        if (config.ReceivingProvider is { Enabled: true } provider)
            return await ToMailboxAsync(provider, ct);

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
    /// **A connected provider authenticates with XOAUTH2; everything else uses a
    /// password.** Both are complete credentials — an app password is not a
    /// half-configured OAuth connection — so the order is preference, not
    /// fallback: an admin who clicked Connect meant to use that grant, and an
    /// account that also has an app password on file should not quietly keep
    /// using it. If the token cannot be renewed the send fails loudly here rather
    /// than silently succeeding through a stale password.
    /// </summary>
    public async Task<SmtpSettings?> ToSmtpAsync(EmailProvider provider, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || !descriptor.CanSend) return null;

        var host = descriptor.Provider == EmailProviderKind.Ses
            ? EmailProviderCatalog.SesSmtpHost(provider.SesRegion)
            : provider.SmtpHost ?? descriptor.SmtpHost;
        if (string.IsNullOrWhiteSpace(host)) return null;

        var port = provider.SmtpPort ?? descriptor.SmtpPort ?? 587;

        if (await GetAccessTokenAsync(provider, ct) is { } accessToken)
            // XOAUTH2 authenticates *as the mailbox*, so the username is the
            // connected account rather than anything typed into the SMTP form.
            return new SmtpSettings(
                host, port, OAuthUsername(provider), null, provider.SmtpUseStartTls, accessToken);

        var (username, encrypted) = descriptor.Provider == EmailProviderKind.Ses
            ? (provider.SesAccessKeyId, provider.SesSecretKeyEncrypted)
            : (provider.SmtpUsername, provider.SmtpPasswordEncrypted);

        var password = encrypted is { Length: > 0 } value ? secrets.Unprotect(value) : null;

        return new SmtpSettings(host, port, username, password, provider.SmtpUseStartTls);
    }

    /// <summary>
    /// Provider row → IMAP connection, or null when it cannot receive. Token
    /// first, app password second, for the same reason as <see cref="ToSmtpAsync"/>.
    /// </summary>
    public async Task<MailboxConnection?> ToMailboxAsync(EmailProvider provider, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || !descriptor.CanReceive) return null;

        var host = provider.ImapHost ?? descriptor.ImapHost;
        if (string.IsNullOrWhiteSpace(host)) return null;
        var port = provider.ImapPort ?? descriptor.ImapPort ?? 993;

        if (await GetAccessTokenAsync(provider, ct) is { } accessToken)
            return new MailboxConnection(host, port, OAuthUsername(provider), null, accessToken);

        if (provider.ImapUsername is not { Length: > 0 } username) return null;
        if (provider.ImapPasswordEncrypted is not { Length: > 0 } encrypted) return null;

        return new MailboxConnection(host, port, username, secrets.Unprotect(encrypted));
    }

    /// <summary>
    /// The address XOAUTH2 authenticates as. `account_email` is written from the
    /// grant itself, so it is the mailbox that actually consented — the form
    /// fields are only a fallback for a row saved before it was connected.
    /// </summary>
    private static string OAuthUsername(EmailProvider provider) =>
        provider.AccountEmail ?? provider.SmtpUsername ?? provider.ImapUsername ?? "";

    // ---- OAuth: connect, refresh, revoke -------------------------------------

    /// <summary>
    /// Begins a Connect. Returns the provider's authorize URL for the browser to
    /// be sent to, or the reason it cannot start.
    ///
    /// The redirect URI is passed in by the API rather than built here, because it
    /// **must be byte-identical on start and callback** and must match what the
    /// operator registered in their own console. Two places deriving it separately
    /// is how that stops being true.
    /// </summary>
    public async Task<(string? AuthorizeUrl, string? Error)> StartConnectAsync(
        Guid workspaceId, string provider, string redirectUri, CancellationToken ct)
    {
        var descriptor = EmailProviderCatalog.Find(provider);
        if (descriptor is null) return (null, "Unknown provider.");
        if (descriptor.AuthKind != EmailAuthKind.OAuth2)
            return (null, $"{descriptor.DisplayName} does not connect this way.");

        var row = await FindAsync(workspaceId, descriptor.Provider, ct);
        if (AppFor(descriptor, row) is not { } app)
            return (null, $"Save your {descriptor.DisplayName} client ID and secret first.");

        var state = TokenUtils.GenerateToken();
        var codeVerifier = TokenUtils.GenerateToken();

        db.EmailOAuthStates.Add(new EmailOAuthState
        {
            WorkspaceId = workspaceId,
            Provider = descriptor.Provider,
            State = state,
            CodeVerifier = codeVerifier,
            ExpiresAt = DateTime.UtcNow.Add(StateLifetime),
        });
        await db.SaveChangesAsync(ct);

        return (app.Provider.AuthorizeEndpoint is null
            ? null
            : oauth.BuildAuthorizeUrl(app, redirectUri, state, TokenUtils.Base64UrlSha256(codeVerifier)), null);
    }

    /// <summary>
    /// Finishes a Connect: consumes the state, exchanges the code, stores the
    /// tokens. Returns the provider key so the callback can name it in the
    /// redirect back to the screen.
    ///
    /// **The state row is consumed before the exchange is attempted**, so a
    /// replayed callback URL fails whether or not the first attempt worked.
    /// </summary>
    public async Task<(string? Provider, string? Error)> CompleteConnectAsync(
        string state, string code, string redirectUri, CancellationToken ct)
    {
        var pending = await db.EmailOAuthStates.SingleOrDefaultAsync(
            s => s.State == state && s.ConsumedAt == null && s.ExpiresAt >= DateTime.UtcNow, ct);
        if (pending is null) return (null, "This connection attempt has expired. Please try again.");

        pending.ConsumedAt = DateTime.UtcNow;

        var descriptor = EmailProviderCatalog.Find(pending.Provider);
        var row = descriptor is null ? null : await FindAsync(pending.WorkspaceId, descriptor.Provider, ct);
        if (descriptor is null || AppFor(descriptor, row) is not { } app || row is null)
        {
            await db.SaveChangesAsync(ct);
            return (null, "This provider is no longer configured.");
        }

        OAuthTokens tokens;
        try
        {
            tokens = await oauth.ExchangeCodeAsync(app, redirectUri, code, pending.CodeVerifier, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Mail OAuth exchange failed for {Provider}", descriptor.Provider);
            row.LastError = ex.Message;
            await db.SaveChangesAsync(ct);
            return (descriptor.Provider, ex.Message);
        }

        if (tokens.RefreshToken is not { Length: > 0 })
        {
            // Refusing the grant rather than storing it. An access token with no
            // refresh token works beautifully for an hour and then stops, in a
            // background worker, long after the admin has closed the tab — and the
            // fix is another consent they have no reason to know they need.
            row.LastError =
                $"{descriptor.DisplayName} returned no refresh token. Remove Trackly from the account's connected apps and try again.";
            await db.SaveChangesAsync(ct);
            return (descriptor.Provider, row.LastError);
        }

        StoreTokens(row, tokens, keepingRefreshFrom: null);
        row.AccountEmail = tokens.AccountEmail ?? row.AccountEmail;
        row.OauthScopes = tokens.Scope;
        row.Enabled = true;
        row.LastVerifiedAt = DateTime.UtcNow;
        row.LastError = null;
        row.UpdatedAt = DateTime.UtcNow;

        // The sender may have just changed identity, so whatever the last test
        // proved is about a connection that no longer describes this one.
        await InvalidateProofAsync(pending.WorkspaceId, ct);
        await db.SaveChangesAsync(ct);

        return (descriptor.Provider, null);
    }

    /// <summary>
    /// A usable access token for a connected provider, or null when this row is
    /// not on OAuth at all — which is the ordinary answer for the SMTP and SES
    /// cards and is why callers treat null as "use the password".
    ///
    /// Throws when the row *is* connected but the token cannot be renewed: a
    /// revoked grant must surface as a failure, not as a silent downgrade to
    /// whatever credential happens to still be lying in the row.
    /// </summary>
    public async Task<string?> GetAccessTokenAsync(EmailProvider provider, CancellationToken ct)
    {
        if (ReadTokens(provider) is not { } stored) return null;

        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || AppFor(descriptor, provider) is not { } app) return null;

        if (stored.ExpiresAt - DateTime.UtcNow > RefreshMargin) return stored.AccessToken;
        if (stored.RefreshToken is not { Length: > 0 } refreshToken)
            throw new InvalidOperationException(
                $"The {descriptor.DisplayName} connection has expired and cannot be renewed. Reconnect it.");

        var gate = RefreshLocks.GetOrAdd(provider.Id, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            // Re-read inside the lock: whoever held it may have just refreshed,
            // and spending a rotated refresh token twice invalidates the grant.
            if (ReadTokens(provider) is { } fresh && fresh.ExpiresAt - DateTime.UtcNow > RefreshMargin)
                return fresh.AccessToken;

            var renewed = await oauth.RefreshAsync(app, refreshToken, ct);
            StoreTokens(provider, renewed, keepingRefreshFrom: refreshToken);
            provider.LastVerifiedAt = DateTime.UtcNow;
            provider.LastError = null;
            provider.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return renewed.AccessToken;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Written to the row so the card can say so. A refresh token revoked
            // at the provider otherwise shows up as a warning every 60 seconds in
            // a log nobody reads, while inbound mail quietly stops.
            logger.LogWarning(ex, "Mail OAuth refresh failed for {Provider}", provider.Provider);
            provider.LastError = ex.Message;
            await db.SaveChangesAsync(ct);
            throw;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Hands the refresh token back to the provider so the grant dies with the
    /// row. Best-effort — see <see cref="IEmailOAuthClient.RevokeAsync"/> — but
    /// never skipped: an admin who clicks Disconnect has every reason to believe
    /// Trackly's access is gone.
    /// </summary>
    public async Task RevokeAsync(EmailProvider provider, CancellationToken ct)
    {
        if (ReadTokens(provider) is not { RefreshToken: { Length: > 0 } refreshToken }) return;
        var descriptor = EmailProviderCatalog.Find(provider.Provider);
        if (descriptor is null || AppFor(descriptor, provider) is not { } app) return;

        await oauth.RevokeAsync(app, refreshToken, ct);
    }

    /// <summary>
    /// The operator's app registration, or null when they have not entered one.
    /// A client secret is required: every provider Trackly cards issues one for a
    /// confidential web app, and PKCE alone would need a public-client
    /// registration the admin has not been asked to make.
    /// </summary>
    private EmailOAuthApp? AppFor(EmailProviderDescriptor descriptor, EmailProvider? row)
    {
        if (descriptor.AuthKind != EmailAuthKind.OAuth2) return null;
        if (row?.OauthClientId is not { Length: > 0 } clientId) return null;
        if (row.OauthClientSecretEncrypted is not { Length: > 0 } encrypted) return null;
        return new EmailOAuthApp(descriptor, clientId, secrets.Unprotect(encrypted));
    }

    private StoredOAuthTokens? ReadTokens(EmailProvider provider)
    {
        if (provider.OauthTokensEncrypted is not { Length: > 0 } encrypted) return null;
        try
        {
            return JsonSerializer.Deserialize<StoredOAuthTokens>(secrets.Unprotect(encrypted));
        }
        catch (Exception ex)
        {
            // Unreadable ciphertext means the data-protection key changed. Treated
            // as "not connected" so the installation falls back to a password
            // rather than throwing on every send.
            logger.LogError(ex, "Stored {Provider} mail tokens could not be read", provider.Provider);
            return null;
        }
    }

    /// <param name="keepingRefreshFrom">
    /// The refresh token that was just spent. Providers that do not rotate them
    /// return no refresh token on a refresh, and writing that null through would
    /// throw away the only credential that survives an hour.
    /// </param>
    private void StoreTokens(EmailProvider provider, OAuthTokens tokens, string? keepingRefreshFrom)
    {
        var stored = new StoredOAuthTokens(
            tokens.AccessToken,
            tokens.RefreshToken ?? keepingRefreshFrom,
            tokens.ExpiresAt,
            tokens.Scope);
        provider.OauthTokensEncrypted = secrets.Protect(JsonSerializer.Serialize(stored));
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
