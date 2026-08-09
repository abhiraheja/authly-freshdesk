using Trackly.Core.Entities;

namespace Trackly.Core.Email;

/// <summary>
/// What Trackly already knows about each mail provider, so an admin only types
/// the things that are genuinely theirs. Gmail's IMAP host is not a preference;
/// asking for it is how a setup screen produces a support ticket.
///
/// Deliberately the same shape as <see cref="Trackly.Core.Sso.SsoProviderCatalog"/>:
/// the catalogue is what the settings screen renders — the cards, the fields each
/// one asks for, and the "where do I get this" link — so adding a provider is one
/// entry here rather than a UI change plus a transport change.
/// </summary>
/// <param name="Provider">See <see cref="EmailProviderKind"/>.</param>
/// <param name="DisplayName">Vendor name. A proper noun — never translated.</param>
/// <param name="AuthKind">See <see cref="EmailAuthKind"/>.</param>
/// <param name="CanSend">Whether this provider can be the sending provider.</param>
/// <param name="CanReceive">
/// Whether it can be the receiving provider. SES is send-only here: receiving on
/// SES means SES → S3 → SNS, which is the parse-webhook path, not a mailbox.
/// </param>
/// <param name="Paid">
/// Surfaced on the card. SES bills per message; the rest cost nothing beyond the
/// mail account the company already has.
/// </param>
public record EmailProviderDescriptor(
    string Provider,
    string DisplayName,
    string AuthKind,
    bool CanSend = true,
    bool CanReceive = true,
    // ---- OAuth endpoints (AuthKind = oauth2) ----
    string? AuthorizeEndpoint = null,
    string? TokenEndpoint = null,
    /// <summary>
    /// Scopes requested at consent. IMAP and SMTP over XOAUTH2 need mail scopes,
    /// not the `openid profile email` an SSO connection asks for — the same
    /// provider, a completely different grant.
    /// </summary>
    string? Scopes = null,
    /// <summary>
    /// Where a refresh token is handed back to be invalidated. Null where the
    /// provider publishes no revocation endpoint — disconnecting then clears the
    /// tokens locally and the admin removes the grant in their own account.
    /// </summary>
    string? RevokeEndpoint = null,
    /// <summary>
    /// Whether the authorize request needs `access_type=offline&amp;prompt=consent`
    /// to be handed a refresh token at all.
    ///
    /// Google's default is an access token that expires in an hour and no way to
    /// renew it — which works perfectly in testing and stops the installation
    /// receiving mail an hour after the admin has moved on. Microsoft and Yahoo
    /// ask for the same thing through the `offline_access` scope instead.
    /// </summary>
    bool OfflineConsent = false,
    // ---- Fixed transport hosts, so the admin never types them ----
    string? SmtpHost = null,
    int? SmtpPort = null,
    string? ImapHost = null,
    int? ImapPort = null,
    bool Paid = false,
    string? SetupDocsUrl = null);

public static class EmailProviderCatalog
{
    /// <summary>
    /// Gmail / Google Workspace over XOAUTH2.
    ///
    /// `https://mail.google.com/` is a **restricted** scope, and it is the one
    /// IMAP and SMTP require — the narrower `gmail.send` / `gmail.readonly` pair
    /// only works against the Gmail REST API. An app published *Internal* to the
    /// operator's own Workspace organisation avoids Google's external-app
    /// verification entirely, which is what self-hosting buys here.
    ///
    /// `openid email` rides along so the token response carries an id_token whose
    /// `email` claim names the mailbox that was actually connected. Without it a
    /// connected card can only say "Connected", and an admin with two Google
    /// accounts has no way to tell which one they consented with.
    /// </summary>
    public static readonly EmailProviderDescriptor Google = new(
        EmailProviderKind.Google,
        "Google",
        EmailAuthKind.OAuth2,
        AuthorizeEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        TokenEndpoint: "https://oauth2.googleapis.com/token",
        Scopes: "https://mail.google.com/ openid email",
        RevokeEndpoint: "https://oauth2.googleapis.com/revoke",
        OfflineConsent: true,
        SmtpHost: "smtp.gmail.com",
        SmtpPort: 587,
        ImapHost: "imap.gmail.com",
        ImapPort: 993,
        SetupDocsUrl: "https://console.cloud.google.com/apis/credentials");

    /// <summary>
    /// Microsoft 365 / Outlook over XOAUTH2.
    ///
    /// Needs an Entra app with delegated `IMAP.AccessAsUser.All` and `SMTP.Send`,
    /// plus `offline_access` — without that last one the token exchange returns
    /// no refresh token and the connection dies at the first expiry, silently.
    ///
    /// `common` rather than a fixed tenant: an operator's mailbox may be in any
    /// directory, and unlike the SSO catalogue there is no reason to exclude
    /// personal accounts — a small company running Trackly on an outlook.com
    /// mailbox is an ordinary case.
    /// </summary>
    public static readonly EmailProviderDescriptor Microsoft = new(
        EmailProviderKind.Microsoft,
        "Microsoft",
        EmailAuthKind.OAuth2,
        AuthorizeEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        TokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        Scopes: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
        SmtpHost: "smtp.office365.com",
        SmtpPort: 587,
        ImapHost: "outlook.office365.com",
        ImapPort: 993,
        SetupDocsUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade");

    public static readonly EmailProviderDescriptor Yahoo = new(
        EmailProviderKind.Yahoo,
        "Yahoo",
        EmailAuthKind.OAuth2,
        AuthorizeEndpoint: "https://api.login.yahoo.com/oauth2/request_auth",
        TokenEndpoint: "https://api.login.yahoo.com/oauth2/get_token",
        Scopes: "openid email mail-w",
        SmtpHost: "smtp.mail.yahoo.com",
        SmtpPort: 587,
        ImapHost: "imap.mail.yahoo.com",
        ImapPort: 993,
        SetupDocsUrl: "https://developer.yahoo.com/apps/");

    /// <summary>
    /// Any SMTP relay — SendGrid, Mailgun, Postmark, a company's own server.
    ///
    /// The escape hatch, and the reason there will always be a form on this
    /// screen: it is the only option that works for a provider Trackly has never
    /// heard of. Hosts are null because they are exactly what the admin supplies.
    ///
    /// Receiving is offered too: the same card carries optional IMAP details, so
    /// a workspace polling a plain mailbox does not need a second concept.
    /// </summary>
    public static readonly EmailProviderDescriptor Smtp = new(
        EmailProviderKind.Smtp,
        "SMTP",
        EmailAuthKind.Password,
        SmtpPort: 587,
        ImapPort: 993);

    /// <summary>
    /// Amazon SES through its SMTP interface rather than the SES API.
    ///
    /// SES publishes an SMTP endpoint whose credentials derive from an IAM key,
    /// so this reuses the transport that already exists and adds no AWS SDK.
    /// Reach for `AWSSDK.SimpleEmailV2` only when something needs the API proper
    /// — per-message tags, dedicated IPs — and price the dependency first.
    /// </summary>
    public static readonly EmailProviderDescriptor Ses = new(
        EmailProviderKind.Ses,
        "AWS",
        EmailAuthKind.AccessKey,
        CanReceive: false,
        SmtpPort: 587,
        Paid: true,
        SetupDocsUrl: "https://console.aws.amazon.com/ses/home#/smtp");

    public static readonly IReadOnlyList<EmailProviderDescriptor> All =
        [Google, Microsoft, Yahoo, Smtp, Ses];

    public static EmailProviderDescriptor? Find(string? provider) =>
        All.FirstOrDefault(p => string.Equals(p.Provider, provider, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The SES SMTP endpoint for a region. SES is the one provider whose host is
    /// neither fixed nor typed — it is derived from the region the admin picks,
    /// and getting it wrong is a connection timeout with no useful message.
    /// </summary>
    public static string SesSmtpHost(string? region) =>
        $"email-smtp.{(string.IsNullOrWhiteSpace(region) ? "us-east-1" : region.Trim())}.amazonaws.com";
}
