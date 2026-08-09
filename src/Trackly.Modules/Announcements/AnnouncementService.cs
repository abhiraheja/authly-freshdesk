using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Announcements;

// Broadcast announcements: a mass email to every customer with a Trackly account
// in the workspace. Sending is best-effort per recipient with per-recipient
// delivery tracking. Admin-only (enforced by the controller policy).
public class AnnouncementService(
    TracklyDbContext db,
    IWorkspaceEmailSender sender,
    EmailProviderService providers,
    ILogger<AnnouncementService> logger)
{
    public async Task<IReadOnlyList<AnnouncementSummaryDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await db.Announcements
            .Where(a => a.WorkspaceId == actor.WorkspaceId)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new AnnouncementSummaryDto(
                a.Id, a.Type, a.Subject, a.ProblemId, a.ScheduledAt, a.SentAt,
                a.RecipientCount, a.SuccessCount, a.FailureCount, a.CreatedAt))
            .ToListAsync(ct);
    }

    public async Task<AnnouncementDetailDto?> GetAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var a = await db.Announcements
            .SingleOrDefaultAsync(x => x.Id == id && x.WorkspaceId == actor.WorkspaceId, ct);
        return a is null ? null : ToDetail(a);
    }

    public async Task<AnnouncementDetailDto> CreateAsync(Actor actor, CreateAnnouncementRequest req, CancellationToken ct)
    {
        if (!AnnouncementType.All.Contains(req.Type))
            throw new ArgumentException("Invalid announcement type.");
        if (string.IsNullOrWhiteSpace(req.Subject) || string.IsNullOrWhiteSpace(req.Body))
            throw new ArgumentException("Subject and body are required.");
        if (req.ProblemId is not null &&
            !await db.Problems.AnyAsync(p => p.Id == req.ProblemId && p.WorkspaceId == actor.WorkspaceId, ct))
            throw new ArgumentException("Unknown problem.");

        var announcement = new Announcement
        {
            WorkspaceId = actor.WorkspaceId,
            Type = req.Type,
            Subject = req.Subject.Trim(),
            Body = req.Body.Trim(),
            ProblemId = req.ProblemId,
            ScheduledAt = req.ScheduledAt,
            CreatedBy = actor.UserId,
        };
        db.Announcements.Add(announcement);
        await db.SaveChangesAsync(ct);
        return ToDetail(announcement);
    }

    // Manual "send now". Refuses to re-send an already-sent announcement.
    public async Task<AnnouncementDetailDto?> SendAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var announcement = await db.Announcements
            .SingleOrDefaultAsync(a => a.Id == id && a.WorkspaceId == actor.WorkspaceId, ct);
        if (announcement is null) return null;
        if (announcement.SentAt is not null)
            throw new ArgumentException("This announcement has already been sent.");

        await SendAnnouncementAsync(announcement, ct);
        return ToDetail(announcement);
    }

    // Called by the background worker: send any scheduled announcement now due.
    public async Task<int> SendDueAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var due = await db.Announcements
            .Where(a => a.SentAt == null && a.ScheduledAt != null && a.ScheduledAt <= now)
            .ToListAsync(ct);
        foreach (var a in due)
            await SendAnnouncementAsync(a, ct);
        return due.Count;
    }

    // ---- Sending -------------------------------------------------------------

    private async Task SendAnnouncementAsync(Announcement announcement, CancellationToken ct)
    {
        // Recipients: customers with a Trackly account (active, with email).
        // Guests are excluded — no verified opt-in.
        var recipients = await db.Users
            .Where(u => u.WorkspaceId == announcement.WorkspaceId
                        && u.Role == TracklyRoles.Customer
                        && u.IsActive
                        && u.Email != null)
            .Select(u => new { u.Id, u.Email })
            .ToListAsync(ct);

        // Claim before sending so a second worker tick can't pick it up again.
        announcement.RecipientCount = recipients.Count;
        announcement.SentAt = DateTime.UtcNow;
        var deliveries = recipients.Select(r => new AnnouncementDelivery
        {
            AnnouncementId = announcement.Id,
            UserId = r.Id,
            Email = r.Email!,
        }).ToList();
        db.AnnouncementDeliveries.AddRange(deliveries);
        await db.SaveChangesAsync(ct);

        var (smtp, fromEmail, fromName) = await ResolveSenderAsync(announcement.WorkspaceId, ct);
        var success = 0;
        var failure = 0;
        foreach (var delivery in deliveries)
        {
            try
            {
                await sender.SendAsync(smtp, new EmailMessage(
                    delivery.Email, announcement.Subject, announcement.Body,
                    HtmlBody: null, ToName: null, FromEmail: fromEmail, FromName: fromName), ct);
                delivery.Status = DeliveryStatus.Sent;
                delivery.SentAt = DateTime.UtcNow;
                success++;
            }
            catch (Exception ex)
            {
                delivery.Status = DeliveryStatus.Failed;
                delivery.Error = ex.Message;
                failure++;
                logger.LogWarning(ex, "Announcement {Id} delivery to {Email} failed", announcement.Id, delivery.Email);
            }
        }

        announcement.SuccessCount = success;
        announcement.FailureCount = failure;
        await db.SaveChangesAsync(ct);
    }

    private async Task<(SmtpSettings? Smtp, string? FromEmail, string FromName)> ResolveSenderAsync(
        Guid workspaceId, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);
        var fromName = config?.FromName ?? branding?.PageTitle ?? workspace.Name;

        var smtp = await providers.ResolveSenderAsync(workspaceId, ct);
        return (smtp, config?.FromEmail, fromName);
    }

    private static AnnouncementDetailDto ToDetail(Announcement a) => new(
        a.Id, a.Type, a.Subject, a.Body, a.ProblemId, a.ScheduledAt, a.SentAt,
        a.RecipientCount, a.SuccessCount, a.FailureCount, a.CreatedAt);
}
