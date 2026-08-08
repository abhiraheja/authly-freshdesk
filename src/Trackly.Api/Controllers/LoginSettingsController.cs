using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

/// <summary>
/// Which sign-in methods this installation offers.
///
/// **The whole point of this controller is the guard.** Trackly is self-hosted:
/// there is no support desk, no account recovery team, and no way back in if the
/// last working method is switched off. So a method may only be disabled while
/// another one is *proven* to work — not merely configured.
/// </summary>
[ApiController]
[Route("api/admin/login-settings")]
[Authorize(Policy = "Admin")]
public class LoginSettingsController(TracklyDbContext db) : ControllerBase
{
    public record LoginSettingsRequest(bool? PasswordLoginEnabled, bool? EmailLoginEnabled);

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);

        return Ok(new
        {
            passwordLoginEnabled = workspace.PasswordLoginEnabled,
            emailLoginEnabled = workspace.EmailLoginEnabled,
            // What the UI needs to explain *why* a toggle is unavailable, rather
            // than presenting a switch that silently refuses.
            emailWorks = await EmailWorksAsync(workspaceId, ct),
            ssoActive = await SsoActiveAsync(workspaceId, ct),
        });
    }

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] LoginSettingsRequest request, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);

        var password = request.PasswordLoginEnabled ?? workspace.PasswordLoginEnabled;
        var email = request.EmailLoginEnabled ?? workspace.EmailLoginEnabled;

        var emailWorks = await EmailWorksAsync(workspaceId, ct);
        var ssoActive = await SsoActiveAsync(workspaceId, ct);

        // A method counts towards "still usable" only if it can actually deliver.
        // Email login with no proven SMTP is a switch that looks on and lets
        // nobody in, which is exactly the trap this guard exists to prevent.
        var usable = (password ? 1 : 0) + (email && emailWorks ? 1 : 0) + (ssoActive ? 1 : 0);
        if (usable == 0)
        {
            return BadRequest(new
            {
                error = !emailWorks && email
                    ? "Send a test email successfully before turning off password sign-in — otherwise nobody can sign in."
                    : "At least one working sign-in method must stay enabled.",
            });
        }

        workspace.PasswordLoginEnabled = password;
        workspace.EmailLoginEnabled = email;
        workspace.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Ok(new
        {
            passwordLoginEnabled = workspace.PasswordLoginEnabled,
            emailLoginEnabled = workspace.EmailLoginEnabled,
            emailWorks,
            ssoActive,
        });
    }

    /// Proof, not configuration: a test message actually got through.
    private Task<bool> EmailWorksAsync(Guid workspaceId, CancellationToken ct)
        => db.EmailConfigs.AnyAsync(c => c.WorkspaceId == workspaceId && c.LastVerifiedAt != null, ct);

    /// <summary>
    /// `Active` is only set once a real SSO login has completed, so this is proof
    /// too — but proof of a button nobody can see is not proof of a way in, so a
    /// connection only counts while it is enabled and offered on the staff page.
    /// </summary>
    private Task<bool> SsoActiveAsync(Guid workspaceId, CancellationToken ct)
        => db.SsoConnections.AnyAsync(
            c => c.WorkspaceId == workspaceId
                 && c.IsEnabled
                 && c.ShowOnStaffLogin
                 && c.Status == SsoStatus.Active,
            ct);
}
