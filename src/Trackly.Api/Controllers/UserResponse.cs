using Trackly.Core.Entities;

namespace Trackly.Api.Controllers;

public record UserResponse(
    Guid Id,
    string? Email,
    string? Name,
    string Role,
    string? AvatarUrl,
    WorkspaceResponse Workspace,
    /// <summary>
    /// True while the user is on a temporary password an admin handed them. The
    /// SPA uses it to route straight to the change-password screen — but the API
    /// enforces it independently (see MustChangePasswordFilter), so a client that
    /// ignores this flag gets 403s rather than access.
    /// </summary>
    bool MustChangePassword)
{
    public static UserResponse From(User user) => new(
        user.Id, user.Email, user.Name, user.Role, UserAvatar.UrlFor(user),
        new WorkspaceResponse(user.Workspace.Id, user.Workspace.Name, user.Workspace.Slug),
        user.MustChangePassword);
}

public record WorkspaceResponse(Guid Id, string Name, string Slug);
