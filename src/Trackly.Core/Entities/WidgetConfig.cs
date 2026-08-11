namespace Trackly.Core.Entities;

/// <summary>
/// One embeddable widget. A workspace may run several — a production widget on
/// the marketing site beside a staging one, or a different greeting inside the
/// signed-in app — so this is addressed by <see cref="PublicToken"/>, not by
/// workspace.
///
/// <para>
/// <see cref="PublicToken"/> is <b>public</b>: it sits in the page source of
/// every site that embeds the widget. It identifies a widget, it never
/// authorises anything. Everything that needs proof of who the visitor is goes
/// through <see cref="SecretKeyEncrypted"/> and a signed JWT instead.
/// </para>
/// </summary>
public class WidgetConfig
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    // ---- Identity ----------------------------------------------------------
    /// <summary>Admin-facing label ("Production", "Docs site").</summary>
    public string Name { get; set; } = "Support";
    /// <summary>Sub-heading under the greeting in the panel header.</summary>
    public string? Tagline { get; set; }
    /// <summary>Panel heading; "Hello {first name}" when the visitor is known.</summary>
    public string? Greeting { get; set; }
    /// <summary>Short, URL-safe, public. Unique across the deployment.</summary>
    public string PublicToken { get; set; } = string.Empty;

    // ---- Identity verification ---------------------------------------------
    /// <summary>
    /// AES-256-GCM (invariant 3). The plaintext crosses the wire exactly once —
    /// on create and on regenerate — and is masked everywhere after that.
    /// </summary>
    public string? SecretKeyEncrypted { get; set; }
    /// <summary>
    /// When true the host page must supply a JWT signed with the secret before a
    /// visitor is treated as verified. See the trust rule in docs/widget-plan.md § 3.3.
    /// </summary>
    public bool IdentityVerificationEnabled { get; set; }

    // ---- Appearance --------------------------------------------------------
    /// <summary>
    /// Hex colour for this widget. Null inherits <c>workspace_branding</c> —
    /// the organisation has a colour, a given widget may want another.
    /// </summary>
    public string? PrimaryColor { get; set; }
    /// <summary>
    /// Logo for this widget alone. Null inherits <c>workspace_branding</c>, the
    /// same way <see cref="PrimaryColor"/> does.
    ///
    /// A widget can carry a different identity from the organisation running it —
    /// a support widget on a product microsite, or a partner-branded embed — and
    /// setting one here must never write back to the workspace record, which also
    /// dresses the sign-in page, the portal and every outbound email.
    /// </summary>
    public string? LogoStorageKey { get; set; }
    public string? LogoContentType { get; set; }
    /// <summary>Tickets raised through this widget are routed to this team.</summary>
    public Guid? TeamId { get; set; }
    public Team? Team { get; set; }

    // ---- Launch options (defaults the host page may override per page) ------
    public bool HideLauncher { get; set; }
    public bool LaunchWidget { get; set; }
    public bool ShowWidgetForm { get; set; } = true;
    public bool ShowCloseButton { get; set; } = true;
    public bool ShowSendButton { get; set; } = true;

    // ---- Behaviour ---------------------------------------------------------
    /// <summary>
    /// Off by default: a widget embedded in an app the operator already controls
    /// is not an anonymous form on the open internet. <c>/submit</c> keeps its
    /// own OTP regardless.
    /// </summary>
    public bool RequireEmailVerification { get; set; }
    /// <summary>Newline-separated origins allowed to load this widget. Empty = any.</summary>
    public string? AllowedOrigins { get; set; }
    public bool IsActive { get; set; } = true;

    // ---- Legacy submit-form embed (still drives the Integration tab) --------
    public string EmbedType { get; set; } = WidgetEmbedType.Floating;
    /// <summary>JSON object naming which submit-form fields to show/require/prefill.</summary>
    public string Fields { get; set; } = """{"fields":["name","email","subject","description"]}""";
    /// <summary>
    /// Accepted and ignored. Customer-facing surfaces are always light
    /// (invariant 6); the column stays so old snippets keep round-tripping.
    /// </summary>
    public string Theme { get; set; } = "light";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class WidgetEmbedType
{
    public const string Floating = "floating";
    public const string Inline = "inline";
    public const string Link = "link";
    public static readonly string[] All = [Floating, Inline, Link];
}
