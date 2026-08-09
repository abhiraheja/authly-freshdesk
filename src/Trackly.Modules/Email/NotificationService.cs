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
// from the workspace's EmailConfig; subject and body come from
// EmailTemplateService, which resolves the admin's customisation or the built-in.
public class NotificationService(
    TracklyDbContext db,
    IWorkspaceEmailSender sender,
    EmailProviderService providers,
    EmailTemplateService templates,
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
                await SendAsync(ctx, agentEmail, ticket.Assignee.Name, "ticket_assigned",
                    TicketVars(ticket, AgentLink(ticket), ("agent_name", ticket.Assignee.Name)),
                    ticketId, null, replyable: false);

            if (ctx.Settings.NotifyCustomerOnCreate && ticket.RequesterId is not null && ticket.Requester?.Email is { } custEmail)
                await SendAsync(ctx, custEmail, ticket.Requester.Name, "ticket_created_customer",
                    TicketVars(ticket, PortalLink(ticket), ("customer_name", ticket.Requester.Name)),
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

            // Emails are HTML now, so a rich body goes through as markup rather
            // than being flattened. It is already sanitised — RichText.SanitizeHtml
            // ran on write — which is what makes it safe to pass as a raw
            // `{{{body}}}` rather than an escaped one. A plain-text comment still
            // has to be encoded and have its newlines turned into markup, or it
            // arrives as one paragraph with tags showing.
            var body = comment.BodyFormat == CommentBodyFormat.Html
                ? comment.Body
                : RichText.ToHtmlParagraphs(comment.Body);

            if (authoredByAgent)
            {
                if (!ctx.Settings.NotifyCustomerOnReply) return;
                var (email, name) = Requester(ticket);
                if (email is null) return;
                await SendAsync(ctx, email, name, "ticket_reply_customer",
                    TicketVars(ticket, PortalOrTrackingLink(ticket),
                        ("body", body),
                        ("can_reply", ctx.ReplyTo is not null ? "true" : ""),
                        ("customer_name", name)),
                    ticketId, messageId, replyable: ctx.ReplyTo is not null);
            }
            else
            {
                if (!ctx.Settings.NotifyAgentOnReply) return;
                foreach (var (email, name) in await AgentRecipientsAsync(ticket, ct))
                    await SendAsync(ctx, email, name, "ticket_reply_agent",
                        TicketVars(ticket, AgentLink(ticket),
                            ("body", body),
                            ("author_name", Requester(ticket).Name ?? "The customer")),
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

            var quoted = string.IsNullOrWhiteSpace(excerpt) ? "" : RichText.ToHtmlParagraphs(excerpt.Trim());
            foreach (var person in recipients)
                await SendAsync(ctx, person.Email!, person.Name, "ticket_mention",
                    TicketVars(ticket, AgentLink(ticket),
                        ("author_name", author ?? "Someone"),
                        ("excerpt", quoted)),
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
            await SendAsync(ctx, email, name, "ticket_status_changed",
                TicketVars(ticket, PortalOrTrackingLink(ticket),
                    ("status", newStatus),
                    ("customer_name", name)),
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

            await SendAsync(ctx, email, name, "ticket_resolved",
                TicketVars(ticket, PortalOrTrackingLink(ticket),
                    ("csat_url", csatToken is null ? null : CsatLink(ticket, csatToken)),
                    ("customer_name", name)),
                ticketId, null, replyable: ctx.ReplyTo is not null);
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
            await SendAsync(ctx, email, agent.Name, "ticket_assigned",
                TicketVars(ticket, AgentLink(ticket), ("agent_name", agent.Name)),
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
        Ctx ctx, string toEmail, string? toName, string templateKey,
        Dictionary<string, string?> variables,
        Guid ticketId, string? messageId, bool replyable)
    {
        var replyTo = replyable && ctx.ReplyTo is not null
            ? ctx.ReplyTo.Replace("{tid}", ticketId.ToString("N"))
            : null;

        var rendered = await templates.RenderAsync(ctx.Workspace.Id, templateKey, variables, CancellationToken.None);

        await sender.SendAsync(ctx.Smtp, new EmailMessage(
            toEmail, rendered.Subject, rendered.Text,
            // Both parts, always. The text alternative is derived from the same
            // render, so the two cannot describe different things.
            HtmlBody: rendered.Html,
            ToName: toName,
            FromEmail: ctx.FromEmail,
            FromName: ctx.FromName,
            ReplyTo: replyTo,
            MessageId: messageId ?? NewMessageId(ticketId)));
    }

    /// <summary>
    /// The variables every ticket email shares, plus whatever the caller adds.
    ///
    /// Note what is *not* here: nothing derived from a comment's `is_internal`
    /// flag, and no collection a template could walk. The dictionary is the
    /// whole reachable surface, which is what makes invariant 5 structural
    /// rather than a rule someone has to remember.
    /// </summary>
    private static Dictionary<string, string?> TicketVars(
        Ticket t, string? url, params (string Key, string? Value)[] extra)
    {
        var variables = new Dictionary<string, string?>
        {
            ["ticket_ref"] = Ref(t),
            ["ticket_subject"] = t.Subject,
            ["ticket_url"] = url,
        };
        foreach (var (key, value) in extra)
            variables[key] = value;
        return variables;
    }

    private static string Ref(Ticket t) => GuestService.Reference(t.Id);
    private string AgentLink(Ticket t) => $"{FrontendBaseUrl}/dashboard/tickets/{t.Id}";
    private string PortalLink(Ticket t) => $"{FrontendBaseUrl}/portal/tickets/{t.Id}";
    private string CsatLink(Ticket t, string token) => $"{FrontendBaseUrl}/csat/{t.Id}?token={token}";

    /// <summary>
    /// The portal link for a signed-in requester, and null for a guest.
    ///
    /// Null rather than a link because a guest's ticket is reachable only
    /// through the private tokened link in their original confirmation email,
    /// and this is not the place to reissue one. The templates guard their
    /// buttons with <c>{{#if ticket_url}}</c> for exactly this case.
    /// </summary>
    private string? PortalOrTrackingLink(Ticket t) => t.RequesterId is not null ? PortalLink(t) : null;

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
