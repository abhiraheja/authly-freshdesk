using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Auth;

public class AuthService(TracklyDbContext db, IEmailSender emailSender, IConfiguration configuration)
{
    private const int MaxSendsPer15Minutes = 3;
    private const int MaxCodeAttempts = 5;
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    // ---- Send -------------------------------------------------------------

    public async Task<SendMagicLinkStatus> SendMagicLinkAsync(SendMagicLinkRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);

        // Resolved even when no slug was supplied, so an installation that has
        // not been set up yet refuses here rather than emailing a link that
        // could never resolve to anything at verify time.
        var workspace = await db.ResolveWorkspaceAsync(request.WorkspaceSlug, ct);
        if (workspace is null)
            return SendMagicLinkStatus.WorkspaceNotFound;
        if (!workspace.EmailLoginEnabled)
            return SendMagicLinkStatus.EmailLoginDisabled;

        var windowStart = DateTime.UtcNow.AddMinutes(-15);
        var recentSends = await db.EmailTokens
            .CountAsync(t => t.Email == email && t.CreatedAt >= windowStart, ct);
        if (recentSends >= MaxSendsPer15Minutes)
            return SendMagicLinkStatus.RateLimited;

        var linkToken = TokenUtils.GenerateToken();
        var code = TokenUtils.GenerateSixDigitCode();

        db.EmailTokens.Add(new EmailToken
        {
            WorkspaceId = workspace.Id,
            Email = email,
            Purpose = EmailTokenPurpose.Login,
            LinkTokenHash = TokenUtils.Sha256Hex(linkToken),
            CodeHash = TokenUtils.Sha256Hex(code),
            ExpiresAt = DateTime.UtcNow.Add(TokenLifetime),
        });
        await db.SaveChangesAsync(ct);

        var frontendBaseUrl = configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";
        // The slug is redundant now that the token carries the workspace, but the
        // verify page reads it to render the workspace's branding (invariant 6).
        var verifyUrl = $"{frontendBaseUrl}/auth/verify?token={linkToken}&workspace={workspace.Slug}";

        var productName = workspace.Name;
        var codeDisplay = $"{code[..3]} {code[3..]}";
        await emailSender.SendAsync(new EmailMessage(
            email,
            $"Sign in to {productName}",
            $"""
            Sign in to {productName}

            Click the link below to sign in. It expires in 10 minutes and can be used once.

            {verifyUrl}

            Or enter this code where you started signing in: {codeDisplay}

            If you didn't request this, you can safely ignore this email.
            """), ct);

        return SendMagicLinkStatus.Sent;
    }

    // ---- Verify -----------------------------------------------------------

    public async Task<VerifyResult> VerifyMagicLinkAsync(
        VerifyMagicLinkRequest request, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        var (token, error) = await ResolveEmailTokenAsync(request.Token, request.Email, request.Code, ct);
        if (token is null)
            return new VerifyResult(error);

        // Which workspace this login is for. Tokens minted since first-run setup
        // always carry one; the slug and the fall-through cover links issued
        // before that and any sent without a workspace context.
        var workspace = token.WorkspaceId is not null
            ? await db.Workspaces.SingleAsync(w => w.Id == token.WorkspaceId, ct)
            : await db.ResolveWorkspaceAsync(request.WorkspaceSlug, ct);
        if (workspace is null)
            return new VerifyResult(VerifyStatus.NotSetUp);

        var user = await db.Users.SingleOrDefaultAsync(
            u => u.WorkspaceId == workspace.Id && u.Email == token.Email, ct);

        if (user is null)
        {
            // Signup = login: an unknown email creates the account after verification.
            if (!workspace.EmailLoginEnabled)
                return new VerifyResult(VerifyStatus.EmailLoginDisabled);
            user = new User { WorkspaceId = workspace.Id, Email = token.Email };
            db.Users.Add(user);
        }
        else if (!user.IsActive)
        {
            return new VerifyResult(VerifyStatus.UserInactive);
        }

        token.ConsumedAt = DateTime.UtcNow;
        user.LastLoginAt = DateTime.UtcNow;
        var sessionToken = CreateSession(user, workspace.Id, ipAddress, userAgent);
        await db.SaveChangesAsync(ct);
        await LinkGuestTicketsAsync(user, ct);

        user.Workspace = workspace;
        return new VerifyResult(VerifyStatus.Success, user, sessionToken);
    }

    // Issues a session for flows outside magic-link verify (e.g. invitation accept).
    public async Task<string> IssueSessionAsync(User user, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        var sessionToken = CreateSession(user, user.WorkspaceId, ipAddress, userAgent);
        await db.SaveChangesAsync(ct);
        return sessionToken;
    }

    // Anonymous guest tickets submitted with this email are linked to the account
    // on every sign-in (guests may submit more tickets between logins).
    public async Task LinkGuestTicketsAsync(User user, CancellationToken ct)
    {
        if (user.Email is null)
            return;
        await db.Tickets
            .Where(t => t.WorkspaceId == user.WorkspaceId
                        && t.RequesterId == null
                        && t.GuestEmail == user.Email)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RequesterId, user.Id), ct);
    }

    // ---- Sessions ----------------------------------------------------------

    public async Task LogoutAsync(string sessionToken, CancellationToken ct)
    {
        var hash = TokenUtils.Sha256Hex(sessionToken);
        await db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
    }

    private string CreateSession(User user, Guid workspaceId, string? ipAddress, string? userAgent)
    {
        var sessionToken = TokenUtils.GenerateToken();
        db.Sessions.Add(new Session
        {
            TokenHash = TokenUtils.Sha256Hex(sessionToken),
            User = user,
            WorkspaceId = workspaceId,
            IpAddress = ipAddress,
            UserAgent = userAgent,
            ExpiresAt = DateTime.UtcNow.Add(SessionLifetime),
        });
        return sessionToken;
    }

    // Internal rather than private: SetupService stages the first workspace, its
    // admin and their session into one SaveChanges, so it needs the session row
    // built against a Workspace that has not been written yet.
    internal string CreateSession(User user, Workspace workspace, string? ipAddress, string? userAgent)
    {
        var sessionToken = TokenUtils.GenerateToken();
        db.Sessions.Add(new Session
        {
            TokenHash = TokenUtils.Sha256Hex(sessionToken),
            User = user,
            Workspace = workspace,
            IpAddress = ipAddress,
            UserAgent = userAgent,
            ExpiresAt = DateTime.UtcNow.Add(SessionLifetime),
        });
        return sessionToken;
    }

    // ---- Token resolution ---------------------------------------------------

    private async Task<(EmailToken? Token, VerifyStatus Error)> ResolveEmailTokenAsync(
        string? linkToken, string? email, string? code, CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(linkToken))
        {
            var hash = TokenUtils.Sha256Hex(linkToken);
            var token = await db.EmailTokens.SingleOrDefaultAsync(
                t => t.LinkTokenHash == hash && t.Purpose == EmailTokenPurpose.Login, ct);
            if (token is null || token.ConsumedAt is not null || token.ExpiresAt < now)
                return (null, VerifyStatus.InvalidToken);
            if (token.Attempts >= MaxCodeAttempts)
                return (null, VerifyStatus.Locked);
            return (token, VerifyStatus.Success);
        }

        if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(code))
        {
            var normalized = NormalizeEmail(email);
            var token = await db.EmailTokens
                .Where(t => t.Email == normalized
                            && t.Purpose == EmailTokenPurpose.Login
                            && t.ConsumedAt == null
                            && t.ExpiresAt >= now)
                .OrderByDescending(t => t.CreatedAt)
                .FirstOrDefaultAsync(ct);
            if (token is null)
                return (null, VerifyStatus.InvalidToken);
            if (token.Attempts >= MaxCodeAttempts)
                return (null, VerifyStatus.Locked);
            if (token.CodeHash != TokenUtils.Sha256Hex(code.Replace(" ", "")))
            {
                token.Attempts++;
                await db.SaveChangesAsync(ct);
                return (null, token.Attempts >= MaxCodeAttempts ? VerifyStatus.Locked : VerifyStatus.InvalidToken);
            }
            return (token, VerifyStatus.Success);
        }

        return (null, VerifyStatus.InvalidToken);
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}
