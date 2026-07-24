using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Email;
using Trackly.Infrastructure.Security;
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

        services.AddSingleton<IFileStorage, LocalFileStorage>();
        services.AddSingleton<ISecretProtector, AesGcmSecretProtector>();

        return services;
    }
}
