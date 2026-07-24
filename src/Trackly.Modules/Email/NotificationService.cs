using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Guest;

namespace Trackly.Modules.Email;

// Outbound ticket notifications. Every method is best-effort: a send (or SMTP
// misconfiguration) must never fail the ticket operation that triggered it, so
// each public entry point swallows and logs its own exceptions. Recipients and
// gating come from NotificationSettings; transport and threading headers come
// from the workspace's EmailConfig.
public class NotificationService(
    TracklyDbContext db,
    IWorkspaceEmailSender sender,
    ISecretProtector secrets,
    IConfiguration configuration,
    ILogger<NotificationService> logger)
{
    private string FrontendBaseUrl => configuration["App:FrontendBaseUrl"] ?? "http://localhost:5173";

    // ---- Public events -------------------------------------------------------

    public async Task OnTicketCreatedAsync(Guid ticketId, CancellationToken ct)
    {
        try
        {
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);

            // Notify the auto-assigned agent. (Guests already got their submit
            // confirmation from GuestService; portal requesters get the create note.)
            if (ctx.Settings.NotifyAgentOnAssign && ticket.Assignee?.Email is { } agentEmail)
                await SendAsync(ctx, agentEmail, ticket.Assignee.Name,
                    $"[{Ref(ticket)}] Assigned to you — {ticket.Subject}",
                    $"You have been assigned a new ticket.\n\n{Ref(ticket)} · {ticket.Subject}\n\n{AgentLink(ticket)}",
                    ticketId, null, replyable: false);

            if (ctx.Settings.NotifyCustomerOnCreate && ticket.RequesterId is not null && ticket.Requester?.Email is { } custEmail)
                await SendAsync(ctx, custEmail, ticket.Requester.Name,
                    $"[{Ref(ticket)}] We received your request — {ticket.Subject}",
                    $"Thanks — your request has been logged and a member of our team will respond soon.\n\n{Ref(ticket)} · {ticket.Subject}\n\n{PortalLink(ticket)}",
                    ticketId, null, replyable: ctx.ReplyTo is not null);
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnTicketCreated notify failed for {TicketId}", ticketId); }
    }

    // A non-internal reply. authoredByAgent decides direction: agent → customer,
    // customer/guest → assignee + watchers.
    public async Task OnReplyAsync(Guid ticketId, Guid commentId, bool authoredByAgent, CancellationToken ct)
    {
        try
        {
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);

            var comment = await db.Comments.SingleOrDefaultAsync(c => c.Id == commentId, ct);
            if (comment is null || comment.IsInternal) return;

            // Stamp + persist the Message-ID so an inbound reply's In-Reply-To can
            // be matched back to this comment (threading fallback).
            var messageId = CommentMessageId(ticketId, commentId);
            if (comment.EmailMessageId is null)
            {
                comment.EmailMessageId = messageId;
                await db.SaveChangesAsync(ct);
            }

            if (authoredByAgent)
            {
                if (!ctx.Settings.NotifyCustomerOnReply) return;
                var (email, name) = Requester(ticket);
                if (email is null) return;
                await SendAsync(ctx, email, name,
                    $"[{Ref(ticket)}] {ticket.Subject}",
                    $"{comment.Body}\n\n---\n{(ctx.ReplyTo is not null ? "Reply to this email to respond." : PortalOrTrackingHint(ticket))}",
                    ticketId, messageId, replyable: ctx.ReplyTo is not null);
            }
            else
            {
                if (!ctx.Settings.NotifyAgentOnReply) return;
                foreach (var (email, name) in await AgentRecipientsAsync(ticket, ct))
                    await SendAsync(ctx, email, name,
                        $"[{Ref(ticket)}] {ticket.Subject}",
                        $"{Requester(ticket).Name ?? "The customer"} replied:\n\n{comment.Body}\n\n{AgentLink(ticket)}",
                        ticketId, messageId, replyable: ctx.ReplyTo is not null);
            }
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnReply notify failed for {TicketId}", ticketId); }
    }

    public async Task OnStatusChangedAsync(Guid ticketId, string newStatus, CancellationToken ct)
    {
        try
        {
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);
            if (!ctx.Settings.NotifyCustomerOnStatus) return;

            var (email, name) = Requester(ticket);
            if (email is null) return;
            await SendAsync(ctx, email, name,
                $"[{Ref(ticket)}] Status updated to {newStatus} — {ticket.Subject}",
                $"Your ticket {Ref(ticket)} is now marked \"{newStatus}\".\n\n{PortalOrTrackingHint(ticket)}",
                ticketId, null, replyable: ctx.ReplyTo is not null);
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnStatusChanged notify failed for {TicketId}", ticketId); }
    }

    public async Task OnAssignmentAsync(Guid ticketId, Guid assigneeId, bool reassigned, CancellationToken ct)
    {
        try
        {
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);
            var wanted = reassigned ? ctx.Settings.NotifyAgentOnReassign : ctx.Settings.NotifyAgentOnAssign;
            if (!wanted) return;

            var agent = await db.Users.SingleOrDefaultAsync(u => u.Id == assigneeId, ct);
            if (agent?.Email is not { } email) return;
            await SendAsync(ctx, email, agent.Name,
                $"[{Ref(ticket)}] Assigned to you — {ticket.Subject}",
                $"This ticket has been assigned to you.\n\n{Ref(ticket)} · {ticket.Subject}\n\n{AgentLink(ticket)}",
                ticketId, null, replyable: false);
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnAssignment notify failed for {TicketId}", ticketId); }
    }

    // ---- Context + recipients ------------------------------------------------

    private sealed record Ctx(
        Workspace Workspace,
        NotificationSettings Settings,
        string? FromEmail,
        string FromName,
        SmtpSettings? Smtp,
        string? ReplyTo);

    private async Task<Ctx> ResolveAsync(Guid workspaceId, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);
        var config = await db.EmailConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        var settings = await db.NotificationSettings.SingleOrDefaultAsync(s => s.WorkspaceId == workspaceId, ct)
                       ?? new NotificationSettings();
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);

        var fromName = config?.FromName ?? branding?.PageTitle ?? workspace.Name;

        SmtpSettings? smtp = null;
        if (config is { UseSharedSmtp: false, SmtpHost: { Length: > 0 } host })
        {
            var password = config.SmtpPasswordEncrypted is { Length: > 0 } enc ? secrets.Unprotect(enc) : null;
            smtp = new SmtpSettings(host, config.SmtpPort ?? 587, config.SmtpUser, password, config.SmtpUseStartTls);
        }

        return new Ctx(workspace, settings, config?.FromEmail, fromName, smtp, ReplyDomainFor(config));
    }

    // The address a customer's reply should go to, if the workspace can receive
    // replies at all. Placeholder {tid} is filled per-ticket in SendAsync.
    private static string? ReplyDomainFor(EmailConfig? config)
    {
        if (config is null || config.EmailMode == EmailMode.NotificationsOnly) return null;
        return config.InboundConnector switch
        {
            // reply+<ticket-uuid>@<subdomain> — the parse webhook decodes the ticket.
            InboundConnector.ParseWebhook when !string.IsNullOrEmpty(config.InboundReplyDomain)
                => $"reply+{{tid}}@{config.InboundReplyDomain}",
            // Fixed mailbox; threading is by Message-ID/In-Reply-To, not the address.
            InboundConnector.MailboxPoll when !string.IsNullOrEmpty(config.MailboxAddress)
                => config.MailboxAddress,
            _ => null,
        };
    }

    private async Task<IReadOnlyList<(string Email, string? Name)>> AgentRecipientsAsync(Ticket ticket, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();
        if (ticket.AssigneeId is { } a) ids.Add(a);
        var watcherIds = await db.TicketWatchers.Where(w => w.TicketId == ticket.Id).Select(w => w.AgentId).ToListAsync(ct);
        foreach (var w in watcherIds) ids.Add(w);
        if (ids.Count == 0) return [];

        return await db.Users
            .Where(u => ids.Contains(u.Id) && u.IsActive && u.Email != null)
            .Select(u => new ValueTuple<string, string?>(u.Email!, u.Name))
            .ToListAsync(ct);
    }

    private static (string? Email, string? Name) Requester(Ticket t) =>
        t.RequesterId is not null ? (t.Requester?.Email, t.Requester?.Name) : (t.GuestEmail, t.GuestName);

    // ---- Send + helpers ------------------------------------------------------

    private async Task SendAsync(
        Ctx ctx, string toEmail, string? toName, string subject, string body,
        Guid ticketId, string? messageId, bool replyable)
    {
        var replyTo = replyable && ctx.ReplyTo is not null
            ? ctx.ReplyTo.Replace("{tid}", ticketId.ToString("N"))
            : null;

        await sender.SendAsync(ctx.Smtp, new EmailMessage(
            toEmail, subject, body,
            HtmlBody: null,
            ToName: toName,
            FromEmail: ctx.FromEmail,
            FromName: ctx.FromName,
            ReplyTo: replyTo,
            MessageId: messageId ?? NewMessageId(ticketId)));
    }

    private static string Ref(Ticket t) => GuestService.Reference(t.Id);
    private string AgentLink(Ticket t) => $"{FrontendBaseUrl}/dashboard/tickets/{t.Id}";
    private string PortalLink(Ticket t) => $"{FrontendBaseUrl}/portal/tickets/{t.Id}";

    private string PortalOrTrackingHint(Ticket t) => t.RequesterId is not null
        ? $"View your ticket: {PortalLink(t)}"
        : "Use the private tracking link from your original confirmation email to view this ticket.";

    // <ticket-uuid>.<comment-uuid>@trackly — carried on the comment for threading.
    // Stored canonical (no angle brackets); MimeKit adds the brackets in the header
    // and strips them again on the way back in, so inbound refs match this form.
    private static string CommentMessageId(Guid ticketId, Guid commentId)
        => $"{ticketId:N}.{commentId:N}@trackly";

    private static string NewMessageId(Guid ticketId)
        => $"{ticketId:N}.{Guid.NewGuid():N}@trackly";

    private async Task<Ticket?> LoadAsync(Guid ticketId, CancellationToken ct) =>
        await db.Tickets
            .Include(t => t.Requester)
            .Include(t => t.Assignee)
            .SingleOrDefaultAsync(t => t.Id == ticketId, ct);
}
