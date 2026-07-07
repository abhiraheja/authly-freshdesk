namespace Trackly.Core.Entities;

// Shared by guest OTP AND passwordless login. Each row carries both a
// magic-link token and a 6-digit code for the same attempt; either one
// consumes the row. WorkspaceId is null for global login/signup sends
// (the workspace is not known yet when someone signs up from trackly.com).
public class EmailToken
{
    public Guid Id { get; set; }
    public Guid? WorkspaceId { get; set; }
    public Workspace? Workspace { get; set; }
    public string Email { get; set; } = null!;
    public string Purpose { get; set; } = EmailTokenPurpose.Login;
    public string? LinkTokenHash { get; set; }
    public string CodeHash { get; set; } = null!;
    public int Attempts { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class EmailTokenPurpose
{
    public const string Login = "login";
    public const string GuestVerify = "guest_verify";
}
