using Trackly.Modules.Announcements;

namespace Trackly.Api.Workers;

// Sends scheduled announcements once their scheduled_at falls due. Fresh DI scope
// per tick (DbContext is scoped); SendDueAsync claims each announcement by
// stamping sent_at before delivering, so a later tick can't re-send it.
public class AnnouncementWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<AnnouncementWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var announcements = scope.ServiceProvider.GetRequiredService<AnnouncementService>();
                var sent = await announcements.SendDueAsync(stoppingToken);
                if (sent > 0)
                    logger.LogInformation("Sent {Count} scheduled announcement(s)", sent);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Announcement worker tick failed");
            }
            try { await Task.Delay(Tick, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
