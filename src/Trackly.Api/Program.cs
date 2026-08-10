using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Trackly.Api;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Ai;
using Trackly.Modules.Announcements;
using Trackly.Api.Chat;
using Trackly.Modules.Auth;
using Trackly.Modules.Channels;
using Trackly.Modules.Chat;
using Trackly.Modules.Csat;
using Trackly.Modules.Dashboard;
using Trackly.Modules.Email;
using Trackly.Modules.Guest;
using Trackly.Modules.Invitations;
using Trackly.Modules.Kb;
using Trackly.Modules.Problems;
using Trackly.Modules.Setup;
using Trackly.Modules.Sso;
using Trackly.Modules.Tickets;
using Trackly.Api.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(options =>
{
    options.Filters.Add<ApiExceptionFilter>();
    // Global: a temporary password must be replaced before the session can do
    // anything else. Opt out per action with [AllowWhilePasswordChangeRequired].
    options.Filters.Add<MustChangePasswordFilter>();
});
builder.Services.AddOpenApi();
builder.Services.AddTracklyInfrastructure(builder.Configuration);
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<SetupService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<Trackly.Modules.Notifications.NotificationFeed>();
builder.Services.AddScoped<InboundEmailService>();
builder.Services.AddScoped<EmailProviderService>();
builder.Services.AddScoped<EmailBrandResolver>();
builder.Services.AddScoped<EmailTemplateService>();
builder.Services.AddScoped<TransactionalMailer>();
builder.Services.AddScoped<TicketService>();
builder.Services.AddScoped<TicketBulkService>();
builder.Services.AddScoped<AttachmentService>();
builder.Services.AddScoped<TagService>();
builder.Services.AddScoped<TicketOptionService>();
builder.Services.AddScoped<TicketStatusService>();
builder.Services.AddScoped<ActivityLog>();
builder.Services.AddScoped<TicketRelationService>();
builder.Services.AddScoped<TicketTaskService>();
builder.Services.AddScoped<AssetService>();
builder.Services.AddScoped<TicketFieldService>();
builder.Services.AddScoped<SlaBreachService>();
builder.Services.AddScoped<BusinessHoursService>();
builder.Services.AddScoped<TeamService>();
builder.Services.AddScoped<SlaService>();
builder.Services.AddScoped<KbService>();
builder.Services.AddScoped<CannedResponseService>();
builder.Services.AddScoped<AutomationService>();
builder.Services.AddScoped<Trackly.Api.Dev.DevSeeder>();
builder.Services.AddScoped<GuestService>();
builder.Services.AddScoped<InvitationService>();
builder.Services.AddScoped<SsoLoginService>();
builder.Services.AddScoped<ProblemService>();
builder.Services.AddScoped<AnnouncementService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<AnalyticsService>();
builder.Services.AddScoped<AiService>();
builder.Services.AddScoped<CsatService>();
builder.Services.AddScoped<ChannelInboundService>();
builder.Services.AddScoped<ChatService>();
builder.Services.AddSignalR();
builder.Services.AddHostedService<AnnouncementWorker>();
builder.Services.AddHostedService<SlaBreachWorker>();
builder.Services.AddHostedService<EmailPollingWorker>();

builder.Services.AddAuthentication(TracklySession.Scheme)
    .AddScheme<AuthenticationSchemeOptions, TracklySessionHandler>(TracklySession.Scheme, _ => { });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AgentOrAdmin", p => p.RequireRole(TracklyRoles.Agent, TracklyRoles.Admin));
    options.AddPolicy("Admin", p => p.RequireRole(TracklyRoles.Admin));
});

// Per-IP limit on the public auth endpoints (send/verify/signup); the
// per-email 3-per-15-minutes limit is enforced in AuthService against the DB.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
            }));
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// Not Development-only: a self-hosted install is a container pointed at an empty
// database with no separate migration step to run, so the app brings its own
// schema up on boot. Operators who apply migrations out of band — or who run
// several replicas and want exactly one of them touching DDL — set this false.
if (app.Configuration.GetValue("Trackly:AutoMigrate", true))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<TracklyDbContext>().Database.Migrate();
}

// In the container topology the SPA's nginx fronts the API, so the socket peer
// is the proxy, not the visitor. Unhandled, that (a) collapses the per-IP auth
// rate limiter below onto a single partition, and (b) makes Request.IsHttps
// false behind a TLS-terminating proxy, which silently drops `Secure` from the
// session cookie. Opt-in, because these headers are client-spoofable and only
// mean anything when a proxy you control is the one setting them.
if (app.Configuration.GetValue("App:ForwardedHeaders", false))
{
    var forwarded = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    };
    // The proxy's address is assigned by the container network and isn't knowable
    // ahead of time; the flag above is the trust boundary, so drop the default
    // loopback-only allow-list that would otherwise ignore the headers.
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
    app.UseForwardedHeaders(forwarded);
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");

// Container/orchestrator liveness. Anonymous, and deliberately does not touch
// the database: first boot applies EF migrations, and a probe that waited on the
// DB would restart the container mid-migration.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
