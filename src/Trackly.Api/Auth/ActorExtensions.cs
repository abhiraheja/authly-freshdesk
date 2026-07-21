using System.Security.Claims;
using Trackly.Modules;

namespace Trackly.Api.Auth;

public static class ActorExtensions
{
    public static Actor GetActor(this ClaimsPrincipal principal) => new(
        principal.GetUserId(),
        principal.GetWorkspaceId(),
        principal.FindFirstValue(ClaimTypes.Role)!);
}
