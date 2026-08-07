using Trackly.Core.Entities;

namespace Trackly.Api.Controllers;

public record UserResponse(
    Guid Id,
    string? Email,
    string? Name,
    string Role,
    string? AvatarUrl,
    WorkspaceResponse Workspace)
{
    public static UserResponse From(User user) => new(
        user.Id, user.Email, user.Name, user.Role, UserAvatar.UrlFor(user),
        new WorkspaceResponse(user.Workspace.Id, user.Workspace.Name, user.Workspace.Slug));
}

public record WorkspaceResponse(Guid Id, string Name, string Slug);
