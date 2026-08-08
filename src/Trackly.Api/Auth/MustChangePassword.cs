using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Trackly.Api.Auth;

/// <summary>
/// Lets an action run while the caller still owes us a password change. Put it
/// only on what someone needs in order to *complete* that change.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AllowWhilePasswordChangeRequiredAttribute : Attribute;

/// <summary>
/// Blocks a session whose user is on a temporary password.
///
/// The temporary password was read down a phone line or pasted into a chat, so
/// somebody other than its owner has seen it. Until it is replaced, that session
/// can do exactly two things: look at its own profile, and change the password.
///
/// **Enforced here rather than in the SPA.** A UI that merely redirects to a
/// change-password screen is a suggestion — the API is still wide open to anyone
/// holding the temporary credential and a HTTP client.
/// </summary>
public class MustChangePasswordFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var flagged = context.HttpContext.User.HasClaim(
            TracklySessionHandler.MustChangePasswordClaim, "true");

        if (flagged && !IsAllowed(context))
        {
            context.Result = new ObjectResult(new
            {
                error = "Set a new password before continuing.",
                mustChangePassword = true,
            })
            { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }

        await next();
    }

    private static bool IsAllowed(ActionExecutingContext context)
        => context.ActionDescriptor.EndpointMetadata
            .OfType<AllowWhilePasswordChangeRequiredAttribute>()
            .Any();
}
