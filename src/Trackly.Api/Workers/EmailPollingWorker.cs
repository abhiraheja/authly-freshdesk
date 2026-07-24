using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;
using Microsoft.EntityFrameworkCore;

namespace Trackly.Api.Workers;

// Option B — mailbox polling. Wakes on a short base tick and polls each
// mailbox-poll workspace at its own configured interval, feeding messages into
// the shared inbound pipeline. A fresh DI scope per tick (DbContext is scoped);
// last_polled_at is written BEFORE polling so a crash mid-poll can't hot-loop.
public class EmailPollingWorker(
    IServiceScopeFactory scopeFactory,
    IMailboxReader mailboxReader,
    ISecretProtector secrets,
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

        var configs = await db.EmailConfigs
            .Where(c => c.InboundConnector == InboundConnector.MailboxPoll
                        && c.MailboxProtocol == MailboxProtocol.Imap)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;
        foreach (var cfg in configs)
        {
            if (cfg.LastPolledAt is { } last && now - last < TimeSpan.FromSeconds(cfg.PollIntervalSeconds))
                continue;
            if (string.IsNullOrEmpty(cfg.MailboxHost) || string.IsNullOrEmpty(cfg.MailboxUsername)
                || cfg.MailboxPasswordEncrypted is not { Length: > 0 } encrypted)
                continue;

            // Claim before work so a crash doesn't immediately re-poll.
            cfg.LastPolledAt = now;
            await db.SaveChangesAsync(ct);

            try
            {
                var conn = new MailboxConnection(
                    cfg.MailboxHost!, cfg.MailboxPort ?? 993,
                    cfg.MailboxUsername!, secrets.Unprotect(encrypted));

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
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "IMAP poll failed for workspace {WorkspaceId}", cfg.WorkspaceId);
            }
        }
    }
}
