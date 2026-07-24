namespace Trackly.Core.Entities;

// Links a Trackly user to an external IdP identity (the 'sub' claim). Kept but
// marked is_active=false when a workspace switches providers; users are then
// re-matched by email and get a fresh identity on next login.
public class UserIdentity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public Guid ConnectionId { get; set; }
    public SsoConnection Connection { get; set; } = null!;
    public string ProviderSub { get; set; } = null!;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
