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
    public string PrimaryColor { get; set; } = "#2563EB";
    public string? PageTitle { get; set; }
    public string? WelcomeText { get; set; }
    public string? FooterText { get; set; }
    public bool HidePoweredBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
