using Trackly.Modules.Tickets;

namespace Trackly.Api.Workers;

/// <summary>
/// Sweeps for tickets about to miss an SLA, or already missing one.
///
/// **A minute, not a second.** The warning window is thirty minutes wide, so a
/// tick anywhere inside it is early enough to matter, and sweeping harder would
/// buy nothing but load. Missing a tick entirely is also safe: the ticket is
/// still unmarked next time round, and the service sends the breach rather than
/// a warning about a deadline that has already gone.
///
/// A fresh DI scope per tick, because DbContext is scoped. The sweep marks each
/// ticket as it notifies, so a later tick cannot repeat itself even if two
/// instances of the API are running.
/// </summary>
public class SlaBreachWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<SlaBreachWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var sla = scope.ServiceProvider.GetRequiredService<SlaBreachService>();
                var queued = await sla.SweepAsync(stoppingToken);
                if (queued > 0)
                    logger.LogInformation("Queued {Count} SLA notification(s)", queued);
            }
            catch (Exception ex)
            {
                // Logged and swallowed: one bad sweep must not take the worker
                // down, or the workspace silently stops being warned about
                // anything from that moment on.
                logger.LogError(ex, "SLA breach sweep failed");
            }

            try { await Task.Delay(Tick, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
