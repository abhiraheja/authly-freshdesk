using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Api.Auth;

public static class TracklySession
{
    public const string Scheme = "TracklySession";
    public const string CookieName = "trackly.session";

    public static void AppendSessionCookie(HttpResponse response, string sessionToken)
    {
        response.Cookies.Append(CookieName, sessionToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = response.HttpContext.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            MaxAge = TimeSpan.FromDays(30),
        });
    }

    public static void DeleteSessionCookie(HttpResponse response)
        => response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
}

public class TracklySessionHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    TracklyDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string WorkspaceIdClaim = "trackly:workspace_id";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(TracklySession.CookieName, out var token) ||
            string.IsNullOrEmpty(token))
            return AuthenticateResult.NoResult();

        var hash = TokenUtils.Sha256Hex(token);
        var session = await db.Sessions
            .Include(s => s.User)
            .SingleOrDefaultAsync(s => s.TokenHash == hash);

        if (session is null || session.ExpiresAt < DateTime.UtcNow || !session.User.IsActive)
            return AuthenticateResult.Fail("Invalid or expired session");

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, session.UserId.ToString()),
            new(ClaimTypes.Role, session.User.Role),
            new(WorkspaceIdClaim, session.WorkspaceId.ToString()),
        };
        if (session.User.Email is not null)
            claims.Add(new Claim(ClaimTypes.Email, session.User.Email));
        if (session.User.Name is not null)
            claims.Add(new Claim(ClaimTypes.Name, session.User.Name));

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        return AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    }
}

public static class ClaimsPrincipalExtensions
{
    public static Guid GetUserId(this ClaimsPrincipal principal)
        => Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static Guid GetWorkspaceId(this ClaimsPrincipal principal)
        => Guid.Parse(principal.FindFirstValue(TracklySessionHandler.WorkspaceIdClaim)!);
}
