using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Text;
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
    EmailProviderService providers,
    IConfiguration configuration,
    ILogger<NotificationService> logger)
{
    private string FrontendBaseUrl => configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173";

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

            // Trackly's notifications are plain text, so a rich body has to be
            // flattened. Sending the markup would show the customer the tags.
            var body = comment.BodyFormat == CommentBodyFormat.Html
                ? RichText.ToPlainText(comment.Body)
                : comment.Body;

            if (authoredByAgent)
            {
                if (!ctx.Settings.NotifyCustomerOnReply) return;
                var (email, name) = Requester(ticket);
                if (email is null) return;
                await SendAsync(ctx, email, name,
                    $"[{Ref(ticket)}] {ticket.Subject}",
                    $"{body}\n\n---\n{(ctx.ReplyTo is not null ? "Reply to this email to respond." : PortalOrTrackingHint(ticket))}",
                    ticketId, messageId, replyable: ctx.ReplyTo is not null);
            }
            else
            {
                if (!ctx.Settings.NotifyAgentOnReply) return;
                foreach (var (email, name) in await AgentRecipientsAsync(ticket, ct))
                    await SendAsync(ctx, email, name,
                        $"[{Ref(ticket)}] {ticket.Subject}",
                        $"{Requester(ticket).Name ?? "The customer"} replied:\n\n{body}\n\n{AgentLink(ticket)}",
                        ticketId, messageId, replyable: ctx.ReplyTo is not null);
            }
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnReply notify failed for {TicketId}", ticketId); }
    }

    /// <summary>
    /// "X mentioned you on a ticket."
    ///
    /// Emailed as well as belled, because a mention is a direct request to a
    /// named person — the one notification that should find them whether or not
    /// they happen to have Trackly open.
    ///
    /// Deliberately not gated on <c>NotifyAgentOnReply</c>: that toggle is about
    /// the firehose of replies on tickets you are assigned. Being named by hand
    /// is not that, and silently swallowing it would make the feature unreliable
    /// in exactly the situation it exists for.
    /// </summary>
    public async Task OnMentionedAsync(
        Guid ticketId, IReadOnlyList<Guid> userIds, Guid actorId, string? excerpt, CancellationToken ct)
    {
        try
        {
            if (userIds.Count == 0) return;
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);

            var author = await db.Users.Where(u => u.Id == actorId).Select(u => u.Name ?? u.Email).SingleOrDefaultAsync(ct);
            // Naming yourself is a legitimate bookmark — it files the ticket
            // under "Mentioning me". Emailing yourself your own note is not.
            var recipients = await db.Users
                .Where(u => userIds.Contains(u.Id) && u.Id != actorId && u.IsActive && u.Email != null)
                .Select(u => new { u.Email, u.Name })
                .ToListAsync(ct);
            if (recipients.Count == 0) return;

            var quoted = string.IsNullOrWhiteSpace(excerpt) ? "" : $"\n\n{excerpt.Trim()}";
            foreach (var person in recipients)
                await SendAsync(ctx, person.Email!, person.Name,
                    $"[{Ref(ticket)}] {author ?? "Someone"} mentioned you — {ticket.Subject}",
                    $"{author ?? "Someone"} mentioned you on {Ref(ticket)} · {ticket.Subject}.{quoted}\n\n{AgentLink(ticket)}",
                    // replyable: false — an emailed reply would land as a public
                    // customer-visible comment, and a mention usually lives on an
                    // internal note. Answering means opening the ticket.
                    ticketId, null, replyable: false);
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnMentioned notify failed for {TicketId}", ticketId); }
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

    // Resolution email, optionally carrying a CSAT rating link (Phase 7C). Uses
    // the same NotifyCustomerOnStatus toggle as other status emails.
    public async Task OnResolvedAsync(Guid ticketId, string? csatToken, CancellationToken ct)
    {
        try
        {
            var ticket = await LoadAsync(ticketId, ct);
            if (ticket is null) return;
            var ctx = await ResolveAsync(ticket.WorkspaceId, ct);
            if (!ctx.Settings.NotifyCustomerOnStatus) return;

            var (email, name) = Requester(ticket);
            if (email is null) return;

            var body = $"Your ticket {Ref(ticket)} is now marked \"resolved\".";
            if (csatToken is not null)
                body += $"\n\nHow did we do? Rate your support experience:\n{CsatLink(ticket, csatToken)}";
            body += $"\n\n{PortalOrTrackingHint(ticket)}";

            await SendAsync(ctx, email, name,
                $"[{Ref(ticket)}] Resolved — {ticket.Subject}",
                body, ticketId, null, replyable: ctx.ReplyTo is not null);
        }
        catch (Exception ex) { logger.LogWarning(ex, "OnResolved notify failed for {TicketId}", ticketId); }
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
        var config = await db.EmailConfigs
            .Include(c => c.ReceivingProvider)
            .SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        var settings = await db.NotificationSettings.SingleOrDefaultAsync(s => s.WorkspaceId == workspaceId, ct)
                       ?? new NotificationSettings();
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspaceId, ct);

        var fromName = config?.FromName ?? branding?.PageTitle ?? workspace.Name;

        var smtp = await providers.ResolveSenderAsync(workspaceId, ct);

        return new Ctx(workspace, settings, config?.FromEmail, fromName, smtp, ReplyDomainFor(config));
    }

    // The address a customer's reply should go to, if the workspace can receive
    // replies at all. Placeholder {tid} is filled per-ticket in SendAsync.
    //
    // Requires Include(c => c.ReceivingProvider): the polled mailbox is the
    // connected account, and pointing replies anywhere else sends them to a
    // mailbox nothing reads.
    private static string? ReplyDomainFor(EmailConfig? config)
    {
        if (config is null || config.EmailMode == EmailMode.NotificationsOnly) return null;
        return config.InboundConnector switch
        {
            // reply+<ticket-uuid>@<subdomain> — the parse webhook decodes the ticket.
            InboundConnector.ParseWebhook when !string.IsNullOrEmpty(config.InboundReplyDomain)
                => $"reply+{{tid}}@{config.InboundReplyDomain}",
            // Fixed mailbox; threading is by Message-ID/In-Reply-To, not the
            // address. `account_email` is written from the OAuth grant itself, so
            // it names the mailbox that actually consented rather than whatever
            // was typed into a form.
            InboundConnector.MailboxPoll when config.ReceivingProvider?.AccountEmail is { Length: > 0 } mailbox
                => mailbox,
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
    private string CsatLink(Ticket t, string token) => $"{FrontendBaseUrl}/csat/{t.Id}?token={token}";

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
