namespace Trackly.Core.Entities;

// Customer-facing surfaces (submit form, portal, widget, notification emails,
// guest magic-link views) render this branding — never Trackly's own.
public class WorkspaceBranding
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string? LogoStorageKey { get; set; }   // IFileStorage key; served via the public logo endpoint
    public string? LogoContentType { get; set; }

    /// <summary>
    /// Artwork for the panel beside the sign-in form. Optional, and separate from
    /// the logo on purpose: a logo is a small mark that has to read at 32px in an
    /// email header, and a hero image is a full-bleed photograph. One field could
    /// not be sized, cropped or cached for both.
    ///
    /// Null leaves the built-in illustration in place, which is why there is no
    /// "use default" flag — clearing the key <i>is</i> the default.
    /// </summary>
    public string? SignInImageStorageKey { get; set; }
    public string? SignInImageContentType { get; set; }

    public string PrimaryColor { get; set; } = "#2563EB";
    public string? PageTitle { get; set; }
    public string? WelcomeText { get; set; }
    public string? FooterText { get; set; }
    public bool HidePoweredBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
