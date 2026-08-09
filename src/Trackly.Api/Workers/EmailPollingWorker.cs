using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;
using Microsoft.EntityFrameworkCore;

namespace Trackly.Api.Workers;

// Option B — mailbox polling. Wakes on a short base tick and polls each
// workspace's designated receiving provider at its own configured interval,
// feeding messages into the shared inbound pipeline. A fresh DI scope per tick
// (DbContext is scoped); last_polled_at is written BEFORE polling so a crash
// mid-poll can't hot-loop.
public class EmailPollingWorker(
    IServiceScopeFactory scopeFactory,
    IMailboxReader mailboxReader,
    ILogger<EmailPollingWorker> logger) : BackgroundService
{
    private static readonly TimeSpan BaseTick = TimeSpan.FromSeconds(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PollDueMailboxesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Email polling tick failed");
            }
            try { await Task.Delay(BaseTick, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task PollDueMailboxesAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TracklyDbContext>();
        var inbound = scope.ServiceProvider.GetRequiredService<InboundEmailService>();
        var providers = scope.ServiceProvider.GetRequiredService<EmailProviderService>();

        // A designated receiving provider is now the whole of "this workspace
        // takes mail in by polling". Turning the *connection* into something the
        // reader can use is still EmailProviderService's call, not the worker's —
        // one resolver, so the screen and the poller cannot disagree about which
        // mailbox is live.
        var configs = await db.EmailConfigs
            .Include(c => c.ReceivingProvider)
            .Where(c => c.ReceivingProviderId != null)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;
        foreach (var cfg in configs)
        {
            if (cfg.LastPolledAt is { } last && now - last < TimeSpan.FromSeconds(cfg.PollIntervalSeconds))
                continue;
            // Resolving can now renew an OAuth token, so it can also fail — a
            // revoked grant must land on the provider card as an error rather
            // than take the whole polling tick down with it.
            MailboxConnection? conn;
            try
            {
                conn = await providers.ResolveReceiverAsync(cfg, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not resolve the mailbox for workspace {WorkspaceId}", cfg.WorkspaceId);
                continue;
            }
            if (conn is null) continue;

            // Claim before work so a crash doesn't immediately re-poll.
            cfg.LastPolledAt = now;
            if (cfg.ReceivingProvider is { } provider) provider.LastPolledAt = now;
            await db.SaveChangesAsync(ct);

            try
            {
                var count = await mailboxReader.PollAsync(conn, async (email, token) =>
                {
                    var message = new InboundMessage(
                        email.MessageId, email.FromEmail, email.FromName, email.ToAddress,
                        email.Subject, email.TextBody, email.ReferenceIds,
                        email.Attachments.Select(a => new InboundAttachment(a.FileName, a.ContentType, a.Content)).ToList());
                    await inbound.ProcessAsync(cfg.WorkspaceId, message, token);
                }, ct);

                if (count > 0)
                    logger.LogInformation("Polled {Count} message(s) for workspace {WorkspaceId}", count, cfg.WorkspaceId);

                if (cfg.ReceivingProvider is { LastError: not null } ok)
                {
                    ok.LastError = null;
                    await db.SaveChangesAsync(ct);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "IMAP poll failed for workspace {WorkspaceId}", cfg.WorkspaceId);

                // Surfaced on the provider card. A mailbox that stopped
                // authenticating overnight is otherwise only visible in the log,
                // and nobody reads the log until the tickets stop arriving.
                if (cfg.ReceivingProvider is { } failed)
                {
                    failed.LastError = ex.Message;
                    await db.SaveChangesAsync(ct);
                }
            }
        }
    }
}
