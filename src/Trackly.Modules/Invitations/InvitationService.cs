using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Invitations;

public record InvitationDto(Guid Id, string Email, string Role, string? InvitedBy, DateTime ExpiresAt, DateTime? AcceptedAt);

public record InvitationInfo(
    string WorkspaceName, string WorkspaceSlug, string Email, string Role,
    string? InvitedBy, bool Expired, bool Accepted);

public record AcceptResult(User User, string SessionToken);

public class InvitationService(
    TracklyDbContext db,
    IEmailSender emailSender,
    IConfiguration configuration,
    AuthService authService)
{
    private static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);

    public async Task<InvitationDto> CreateAsync(Actor actor, string email, string role, CancellationToken ct)
    {
        if (role is not (TracklyRoles.Agent or TracklyRoles.Admin))
            throw new ArgumentException("Invitations can only grant the agent or admin role.");
        email = email.Trim().ToLowerInvariant();
        if (!email.Contains('@'))
            throw new ArgumentException("A valid email address is required.");

        var workspace = await db.Workspaces.SingleAsync(w => w.Id == actor.WorkspaceId, ct);
        var inviter = await db.Users.SingleAsync(u => u.Id == actor.UserId, ct);

        var token = TokenUtils.GenerateToken();
        var invitation = new WorkspaceInvitation
        {
            WorkspaceId = actor.WorkspaceId,
            Email = email,
            Role = role,
            TokenHash = TokenUtils.Sha256Hex(token),
            InvitedBy = actor.UserId,
            ExpiresAt = DateTime.UtcNow.Add(InviteLifetime),
        };
        db.WorkspaceInvitations.Add(invitation);
        await db.SaveChangesAsync(ct);

        var frontendBaseUrl = configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";
        await emailSender.SendAsync(new EmailMessage(
            email,
            $"You're invited to join {workspace.Name} on Trackly",
            $"""
            {inviter.Name ?? inviter.Email} invited you to join {workspace.Name} as {(role == TracklyRoles.Admin ? "an admin" : "an agent")}.

            Accept the invitation (valid for 7 days):
            {frontendBaseUrl}/invite/{token}

            No password needed — the link signs you in.
            """), ct);

        return new InvitationDto(invitation.Id, invitation.Email, invitation.Role,
            inviter.Name ?? inviter.Email, invitation.ExpiresAt, invitation.AcceptedAt);
    }

    public async Task<IReadOnlyList<InvitationDto>> ListPendingAsync(Actor actor, CancellationToken ct)
        => await db.WorkspaceInvitations
            .Where(i => i.WorkspaceId == actor.WorkspaceId && i.AcceptedAt == null && i.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new InvitationDto(i.Id, i.Email, i.Role,
                i.InvitedByUser.Name ?? i.InvitedByUser.Email, i.ExpiresAt, i.AcceptedAt))
            .ToListAsync(ct);

    public async Task<bool> RevokeAsync(Actor actor, Guid invitationId, CancellationToken ct)
    {
        var deleted = await db.WorkspaceInvitations
            .Where(i => i.WorkspaceId == actor.WorkspaceId && i.Id == invitationId && i.AcceptedAt == null)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }

    // Public info for the accept page — never consumes the token.
    public async Task<InvitationInfo?> GetByTokenAsync(string token, CancellationToken ct)
    {
        var invitation = await FindAsync(token, ct);
        if (invitation is null)
            return null;
        return new InvitationInfo(
            invitation.Workspace.Name,
            invitation.Workspace.Slug,
            invitation.Email,
            invitation.Role,
            invitation.InvitedByUser.Name ?? invitation.InvitedByUser.Email,
            invitation.ExpiresAt < DateTime.UtcNow,
            invitation.AcceptedAt is not null);
    }

    public async Task<AcceptResult?> AcceptAsync(
        string token, string? name, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        var invitation = await FindAsync(token, ct);
        if (invitation is null || invitation.AcceptedAt is not null || invitation.ExpiresAt < DateTime.UtcNow)
            return null;

        var user = await db.Users.SingleOrDefaultAsync(
            u => u.WorkspaceId == invitation.WorkspaceId && u.Email == invitation.Email, ct);
        if (user is null)
        {
            user = new User { WorkspaceId = invitation.WorkspaceId, Email = invitation.Email };
            db.Users.Add(user);
        }

        user.Role = invitation.Role;
        user.IsActive = true;
        if (!string.IsNullOrWhiteSpace(name))
            user.Name = name.Trim();
        user.LastLoginAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        invitation.AcceptedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await authService.LinkGuestTicketsAsync(user, ct);
        var sessionToken = await authService.IssueSessionAsync(user, ipAddress, userAgent, ct);
        user.Workspace = invitation.Workspace;
        return new AcceptResult(user, sessionToken);
    }

    private Task<WorkspaceInvitation?> FindAsync(string token, CancellationToken ct)
    {
        var hash = TokenUtils.Sha256Hex(token);
        return db.WorkspaceInvitations
            .Include(i => i.Workspace)
            .Include(i => i.InvitedByUser)
            .SingleOrDefaultAsync(i => i.TokenHash == hash, ct);
    }
}
