using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Email;
using Trackly.Infrastructure.Storage;

namespace Trackly.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddTracklyInfrastructure(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<TracklyDbContext>(options => options
            .UseNpgsql(configuration.GetConnectionString("Trackly"))
            .UseSnakeCaseNamingConvention());

        services.Configure<SmtpOptions>(configuration.GetSection(SmtpOptions.SectionName));
        var smtpConfigured = !string.IsNullOrEmpty(configuration[$"{SmtpOptions.SectionName}:Host"]);
        if (smtpConfigured)
            services.AddScoped<IEmailSender, SmtpEmailSender>();
        else
            services.AddScoped<IEmailSender, LoggingEmailSender>();

        services.AddSingleton<IFileStorage, LocalFileStorage>();

        return services;
    }
}
