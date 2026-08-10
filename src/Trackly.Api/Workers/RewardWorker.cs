using Trackly.Modules.Dashboard;

namespace Trackly.Api.Workers;

/// <summary>
/// Awards the reward goals agents have reached.
///
/// **Fifteen minutes, not one.** Nothing here is time-critical: a badge that lands
/// a quarter of an hour after the ticket that earned it is indistinguishable from
/// one that lands instantly, and the sweep measures every agent against every goal,
/// which is real work to be doing every sixty seconds for no gain.
///
/// Missing a tick is safe. The sweep recomputes the period an agent is currently
/// in, so the next tick finds anything the last one missed, and the unique index on
/// (goal, agent, period) means a repeat writes nothing. That also makes it safe with
/// two instances of the API running — unlike the IMAP poller, this needs no
/// single-instance constraint.
///
/// A fresh DI scope per tick, because DbContext is scoped.
/// </summary>
public class RewardWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<RewardWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(15);

    /// <summary>
    /// A short wait before the first sweep, so a cold start serves requests before
    /// it spends anything on a scoreboard nobody is looking at yet.
    /// </summary>
    private static readonly TimeSpan FirstDelay = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(FirstDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var rewards = scope.ServiceProvider.GetRequiredService<RewardService>();
                var awarded = await rewards.SweepAsync(stoppingToken);
                if (awarded > 0) logger.LogInformation("Awarded {Count} reward badge(s)", awarded);
            }
            catch (Exception ex)
            {
                // Logged and swallowed: one bad sweep must not take the worker down,
                // or the workspace silently stops earning anything from here on.
                logger.LogError(ex, "Reward sweep failed");
            }

            try { await Task.Delay(Tick, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
