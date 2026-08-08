using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Ai;
using Trackly.Infrastructure.Email;
using Trackly.Infrastructure.Security;
using Trackly.Infrastructure.Sso;
using Trackly.Infrastructure.Storage;

namespace Trackly.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddTracklyInfrastructure(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<TracklyDbContext>(options => options
            .UseNpgsql(configuration.GetConnectionString("Trackly"))
            .UseSnakeCaseNamingConvention()
            // EF 10 false positive: Database.Migrate() reports pending model
            // changes even when `migrations add` produces an empty diff.
            .ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning)));

        services.Configure<SmtpOptions>(configuration.GetSection(SmtpOptions.SectionName));
        var smtpConfigured = !string.IsNullOrEmpty(configuration[$"{SmtpOptions.SectionName}:Host"]);
        if (smtpConfigured)
            services.AddScoped<IEmailSender, SmtpEmailSender>();
        else
            services.AddScoped<IEmailSender, LoggingEmailSender>();

        // Ticket notifications: per-workspace SMTP with a shared/dev fallback.
        services.AddScoped<IWorkspaceEmailSender, WorkspaceEmailSender>();
        // Option B inbound transport (stateless).
        services.AddSingleton<IMailboxReader, ImapMailboxReader>();

        // IFileStorage is the LOCAL backend and the fallback for any workspace
        // that hasn't configured one. Everything that stores files goes through
        // IWorkspaceFileStorage instead, which picks the workspace's provider.
        services.AddSingleton<IFileStorage, LocalFileStorage>();
        services.AddSingleton<StorageProviderCache>();
        services.AddScoped<IWorkspaceFileStorage, WorkspaceFileStorage>();
        services.AddSingleton<ISecretProtector, AesGcmSecretProtector>();

        // OIDC (discovery/JWKS caching lives inside the singleton client).
        services.AddHttpClient("oidc");
        services.AddSingleton<IOidcClient, OidcClient>();
        services.AddScoped<IAiCopilot, AnthropicAiCopilot>();

        return services;
    }
}
