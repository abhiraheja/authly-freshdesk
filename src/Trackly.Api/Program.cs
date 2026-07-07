using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Infrastructure;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddTracklyInfrastructure(builder.Configuration);
builder.Services.AddScoped<AuthService>();

builder.Services.AddAuthentication(TracklySession.Scheme)
    .AddScheme<AuthenticationSchemeOptions, TracklySessionHandler>(TracklySession.Scheme, _ => { });
builder.Services.AddAuthorization();

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
{
    app.MapOpenApi();
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<TracklyDbContext>().Database.Migrate();
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
