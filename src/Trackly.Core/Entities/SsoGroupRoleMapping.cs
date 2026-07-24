namespace Trackly.Core.Entities;

// Maps an IdP group name to a Trackly role. Re-evaluated on every SSO login; the
// highest-privilege matching mapping wins (admin > agent > customer).
public class SsoGroupRoleMapping
{
    public Guid Id { get; set; }
    public Guid ConnectionId { get; set; }
    public SsoConnection Connection { get; set; } = null!;
    public string GroupName { get; set; } = null!;
    public string TracklyRole { get; set; } = TracklyRoles.Customer;
}
