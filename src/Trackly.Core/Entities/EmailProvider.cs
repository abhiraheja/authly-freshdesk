namespace Trackly.Core.Entities;

/// <summary>
/// One mail provider this installation has configured — Gmail, Microsoft 365,
/// Yahoo, a plain SMTP relay, or Amazon SES. One row per provider.
///
/// This exists because a workspace's mail setup stopped being a single set of
/// SMTP fields the moment providers could be *connected* rather than typed in.
/// A row here is "we hold credentials for X"; which row actually sends and which
/// receives is recorded on <see cref="EmailConfig"/>, because that is workspace
/// policy rather than a property of the credential.
///
/// Every secret column is AES-256-GCM ciphertext via ISecretProtector (invariant
/// 3) and is never returned by the API — responses carry `has*` booleans instead.
/// </summary>
public class EmailProvider
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>See <see cref="EmailProviderKind"/>.</summary>
    public string Provider { get; set; } = null!;

    /// <summary>
    /// Off does not mean forgotten. Credentials stay, so turning a provider back
    /// on is a switch rather than a re-entry — which matters most for the one
    /// case where somebody is disabling it *because* it is misbehaving.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// The mailbox these credentials belong to, e.g. `support@acme.com`. Shown on
    /// the card, so it reads "Connected as support@acme.com" rather than the far
    /// less useful "Connected".
    /// </summary>
    public string? AccountEmail { get; set; }

    // ---- OAuth (google | microsoft | yahoo) ----
    // The operator registers their own app: Trackly is self-hosted, so the client
    // id and secret belong to the company running it, not to Trackly. They are
    // entered in the admin UI rather than deployment config, because SMTP is
    // already configured there and splitting email setup across two places is how
    // half of it ends up unconfigured.

    public string? OauthClientId { get; set; }
    public string? OauthClientSecretEncrypted { get; set; }

    /// <summary>
    /// Which directory the handshake goes through — Microsoft only, and not
    /// optional there for most operators.
    ///
    /// Entra refuses `/common` outright for an app registered as
    /// *"Accounts in this organizational directory only"* after 15 Oct 2018
    /// (`AADSTS50194`), and single-tenant is the option an operator registering an
    /// app for their own company naturally picks. So this holds their directory
    /// (tenant) ID or domain, substituted into the authorize and token URLs.
    ///
    /// Null means `common`, which is right for a multi-tenant registration and is
    /// the only value that also admits personal Outlook.com accounts. Not a
    /// secret: it is a directory identifier, visible in every sign-in URL.
    /// </summary>
    public string? OauthTenantId { get; set; }

    /// <summary>JSON: access token, refresh token, expiry, granted scope.</summary>
    public string? OauthTokensEncrypted { get; set; }

    /// <summary>What was actually granted — not what was asked for.</summary>
    public string? OauthScopes { get; set; }

    // ---- SMTP (outbound) ----
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
    public string? SmtpUsername { get; set; }
    public string? SmtpPasswordEncrypted { get; set; }
    public bool SmtpUseStartTls { get; set; } = true;

    // ---- IMAP (inbound) ----
    public string? ImapHost { get; set; }
    public int? ImapPort { get; set; }
    public string? ImapUsername { get; set; }
    public string? ImapPasswordEncrypted { get; set; }

    // ---- Amazon SES ----
    public string? SesRegion { get; set; }
    public string? SesAccessKeyId { get; set; }
    public string? SesSecretKeyEncrypted { get; set; }

    // ---- Health ----

    /// <summary>
    /// When these credentials last authenticated. Provider-scoped, and
    /// deliberately *not* the same thing as <see cref="EmailConfig.LastVerifiedAt"/>:
    /// that one means "this installation can send mail" and gates whether password
    /// sign-in may be switched off (invariant 8). Proving Yahoo authenticates says
    /// nothing about an installation that sends through Google.
    /// </summary>
    public DateTime? LastVerifiedAt { get; set; }

    /// <summary>
    /// Why the last attempt failed, kept so a broken connection can say so on its
    /// own card. A refresh token that has been revoked otherwise fails silently in
    /// a background worker, and inbound mail simply stops.
    /// </summary>
    public string? LastError { get; set; }

    public DateTime? LastPolledAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// What <see cref="EmailProvider.OauthTokensEncrypted"/> holds, once decrypted.
///
/// The refresh token is the valuable half — the access token is an hour's worth
/// of credential that can always be minted again, while losing the refresh token
/// means going back to the admin for another consent. Which is why a refresh
/// response that omits one leaves the stored one alone rather than overwriting it
/// with null.
/// </summary>
public record StoredOAuthTokens(
    string AccessToken,
    string? RefreshToken,
    DateTime ExpiresAt,
    string? Scope);

public static class EmailProviderKind
{
    public const string Google = "google";
    public const string Microsoft = "microsoft";
    public const string Yahoo = "yahoo";
    public const string Smtp = "smtp";
    public const string Ses = "ses";

    public static readonly string[] All = [Google, Microsoft, Yahoo, Smtp, Ses];
}

/// <summary>How a provider proves who it is.</summary>
public static class EmailAuthKind
{
    /// Authorization-code + PKCE against the operator's own app registration.
    public const string OAuth2 = "oauth2";

    /// Host, username and a password or app password.
    public const string Password = "password";

    /// An IAM access key pair.
    public const string AccessKey = "access_key";
}
