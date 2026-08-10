using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Infrastructure.Text;
using Trackly.Modules.Auth;
using Trackly.Modules.Email;
using Trackly.Modules.Guest;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Widgets;

/// <summary>
/// The anonymous, token-addressed half of the widget: what an embedded panel is
/// allowed to read and do before anybody has signed in to anything.
///
/// <para>
/// Two rules run through every method here.
/// </para>
/// <para>
/// <b>The workspace is resolved from the widget's public token, never from
/// anything the caller says</b> (invariant 1). No method on this class takes a
/// workspace id or slug.
/// </para>
/// <para>
/// <b>An identity is claimed until it is proven</b> (the trust rule, plan
/// § 3.3). A name and an email typed into a form — or handed over by a host page
/// with no signature — set <see cref="WidgetVisitor.IsVerified"/> to false and
/// leave <see cref="WidgetVisitor.UserId"/> null. Only a JWT signed with the
/// widget's secret, or a confirmed email code, links a visitor to a contact.
/// That link is what phase 3's conversation list keys off, so getting it wrong
/// here is what would turn "see everything I raised" into a way to read someone
/// else's support history.
/// </para>
/// </summary>
public class WidgetPublicService(
    TracklyDbContext db,
    ISecretProtector protector,
    TransactionalMailer mailer,
    TicketService ticketService,
    NotificationService notifications,
    SlaService sla,
    AutomationService automation,
    ActivityLog activity,
    IWorkspaceFileStorage storage,
    IConfiguration configuration,
    ILogger<WidgetPublicService> logger)
{
    private const string EmailVerifyPurpose = "widget_verify";
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    private const int MaxSendsPer15Minutes = 3;
    private const int MaxCodeAttempts = 5;

    /// <summary>
    /// How far back a finished conversation stays on the home list (plan § 8.1).
    /// Older ones drop off entirely — the panel is a support inbox, not an archive.
    /// </summary>
    private static readonly TimeSpan ClosedWindow = TimeSpan.FromDays(30);

    /// <summary>Threads on the home list. A panel that needs paging has other problems.</summary>
    private const int MaxConversations = 50;

    /// <summary>Characters of the last message kept for the one-line row preview.</summary>
    private const int PreviewLength = 160;

    // ---- Resolution ---------------------------------------------------------

    /// <summary>
    /// The widget named by its public token, if it is live.
    ///
    /// <para>
    /// <paramref name="origin"/> is the browser's <c>Origin</c> header. When the
    /// widget lists allowed origins and this is not one of them the call is
    /// refused — which is the whole of the allowlist's enforcement, because
    /// <c>frame-ancestors</c> cannot be set on a static SPA route (plan § 9.2).
    /// An unlisted site can still render the frame; it just gets nothing to
    /// render with.
    /// </para>
    /// </summary>
    public async Task<WidgetConfig?> ResolveAsync(string publicToken, string? origin, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(publicToken)) return null;

        var widget = await db.WidgetConfigs
            .Include(w => w.Workspace)
            .SingleOrDefaultAsync(w => w.PublicToken == publicToken && w.IsActive, ct);
        if (widget is null) return null;

        var allowed = WidgetService.SplitOrigins(widget.AllowedOrigins);
        if (allowed.Count > 0 && !allowed.Contains(origin ?? "", StringComparer.OrdinalIgnoreCase))
        {
            // Logged, because "the widget shows nothing on our staging site" is
            // otherwise an unanswerable support question.
            logger.LogInformation(
                "Widget {Token} refused origin {Origin}; allowed: {Allowed}",
                publicToken, origin ?? "(none)", string.Join(", ", allowed));
            throw new UnauthorizedAccessException("This origin is not allowed to load the widget.");
        }

        return widget;
    }

    public async Task<WidgetPublicConfigDto?> GetConfigAsync(string publicToken, string? origin, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return null;

        var branding = await db.WorkspaceBrandings
            .SingleOrDefaultAsync(b => b.WorkspaceId == widget.WorkspaceId, ct);
        var slug = widget.Workspace.Slug;

        var frontend = (configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173").TrimEnd('/');

        return new WidgetPublicConfigDto(
            widget.PublicToken,
            widget.Name,
            widget.Tagline,
            widget.Greeting,
            $"{frontend}/widget/{widget.PublicToken}",
            widget.Workspace.Name,
            // The widget's colour wins, the workspace's is the default, and the
            // Trackly blue is only ever the last resort (plan § 4.2).
            widget.PrimaryColor ?? branding?.PrimaryColor ?? "#2563EB",
            branding?.LogoStorageKey is null ? null : $"/api/public/workspaces/{slug}/logo",
            branding?.HidePoweredBy ?? false,
            widget.HideLauncher,
            widget.LaunchWidget,
            widget.ShowWidgetForm,
            widget.ShowCloseButton,
            widget.ShowSendButton,
            widget.IdentityVerificationEnabled,
            widget.RequireEmailVerification);
    }

    // ---- Session ------------------------------------------------------------

    /// <summary>
    /// Opens or resumes a visitor session.
    ///
    /// <para>
    /// A resumed session keeps its verification: the visitor token is the
    /// credential, and re-sending an unsigned identity payload on a later page
    /// load must not be able to <i>downgrade</i> a verified visitor, nor to
    /// re-point one at somebody else.
    /// </para>
    /// </summary>
    public async Task<WidgetSessionDto?> StartSessionAsync(
        string publicToken, string? origin, string? visitorToken,
        WidgetIdentityRequest? identity, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return null;

        var visitor = await FindVisitorAsync(widget, visitorToken, ct);
        string? issuedToken = null;
        if (visitor is null)
        {
            issuedToken = TokenUtils.GenerateToken();
            visitor = new WidgetVisitor
            {
                WorkspaceId = widget.WorkspaceId,
                WidgetId = widget.Id,
                VisitorTokenHash = TokenUtils.Sha256Hex(issuedToken),
            };
            db.WidgetVisitors.Add(visitor);
        }

        var error = await ApplyIdentityAsync(widget, visitor, identity, ct);
        visitor.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return await ToSessionAsync(widget, visitor, issuedToken, error, ct);
    }

    /// <summary>
    /// The details form's Submit, mid-session. Same upsert as
    /// <see cref="StartSessionAsync"/> — a typed name and email are a claim, so
    /// this cannot verify anybody on its own.
    /// </summary>
    public async Task<WidgetSessionDto?> UpdateSessionAsync(
        string publicToken, string? origin, string visitorToken,
        WidgetIdentityRequest identity, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return null;

        var visitor = await FindVisitorAsync(widget, visitorToken, ct);
        if (visitor is null) return null;

        var error = await ApplyIdentityAsync(widget, visitor, identity, ct);
        visitor.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return await ToSessionAsync(widget, visitor, null, error, ct);
    }

    public async Task<WidgetVisitor?> FindVisitorAsync(
        WidgetConfig widget, string? visitorToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(visitorToken)) return null;
        var hash = TokenUtils.Sha256Hex(visitorToken);
        return await db.WidgetVisitors.SingleOrDefaultAsync(
            v => v.VisitorTokenHash == hash
                 && v.WidgetId == widget.Id
                 && v.WorkspaceId == widget.WorkspaceId, ct);
    }

    /// <summary>
    /// Folds what the host page claims into the visitor row, and decides whether
    /// any of it counts as proof. Returns null when there was nothing wrong, or
    /// a message the panel may show a developer.
    /// </summary>
    private async Task<string?> ApplyIdentityAsync(
        WidgetConfig widget, WidgetVisitor visitor, WidgetIdentityRequest? identity, CancellationToken ct)
    {
        if (identity is null) return null;

        if (identity.Variables is { Count: > 0 })
        {
            // Merged, not replaced: a page that sets `plan` should not erase the
            // `account_id` an earlier page set.
            foreach (var (key, value) in identity.Variables)
                visitor.Variables[key] = value;
        }

        var claimedName = Trimmed(identity.Name);
        var claimedEmail = Trimmed(identity.Mail)?.ToLowerInvariant();
        var claimedPhone = Trimmed(identity.Number);
        var claimedId = Trimmed(identity.Identifier);

        string? error = null;
        var proven = false;

        if (!string.IsNullOrEmpty(identity.Token))
        {
            if (widget.SecretKeyEncrypted is null)
            {
                error = "This widget has no secret key, so a signed token cannot be checked.";
            }
            else
            {
                var result = WidgetService.VerifyIdentityToken(
                    identity.Token.Trim(), protector.Unprotect(widget.SecretKeyEncrypted));
                if (!result.Valid)
                {
                    error = result.Error;
                }
                else if (claimedId is not null && !string.Equals(result.UniqueId, claimedId, StringComparison.Ordinal))
                {
                    // Signing a token for one person and naming another in the
                    // plain config is either a bug in the host page or an attempt
                    // to ride a valid signature. Neither is honoured.
                    error = "The signed token identifies a different user than unique_id.";
                }
                else
                {
                    proven = true;
                    claimedId = result.UniqueId;
                    // Claims in the token outrank the plain config beside it.
                    claimedEmail = Trimmed(result.Claims.GetValueOrDefault("email"))?.ToLowerInvariant() ?? claimedEmail;
                    claimedName = Trimmed(result.Claims.GetValueOrDefault("name")) ?? claimedName;
                }
            }
        }
        else if (widget.IdentityVerificationEnabled && (claimedId is not null || claimedEmail is not null))
        {
            error = "Identity verification is on for this widget: send a signed token.";
        }

        // A verified visitor cannot be re-pointed or downgraded by a later
        // unsigned payload. Without this, a page that simply forgot the token on
        // one route would silently unlink the contact.
        if (visitor.IsVerified && !proven)
            return error;

        if (claimedName is not null) visitor.Name = claimedName;
        if (claimedEmail is not null) visitor.Email = claimedEmail;
        if (claimedPhone is not null) visitor.Phone = claimedPhone;
        if (claimedId is not null) visitor.ExternalId = claimedId;

        if (proven)
        {
            visitor.IsVerified = true;
            visitor.UserId = await UpsertContactAsync(
                widget.WorkspaceId, claimedEmail, claimedName, claimedPhone, ct);
        }

        return error;
    }

    // ---- Email verification --------------------------------------------------
    // The trust rule's second leg. Without it `require_email_verification` would
    // be a switch that makes the widget unusable, since a widget with no host-page
    // signature has no other way to reach verified.

    public async Task<bool> SendEmailCodeAsync(
        string publicToken, string? origin, string visitorToken, string email, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return false;
        var visitor = await FindVisitorAsync(widget, visitorToken, ct);
        if (visitor is null) return false;

        email = email.Trim().ToLowerInvariant();
        if (email.Length == 0 || !email.Contains('@'))
            throw new ArgumentException("A valid email address is required.");

        var windowStart = DateTime.UtcNow.AddMinutes(-15);
        var recent = await db.EmailTokens.CountAsync(
            t => t.Email == email && t.Purpose == EmailVerifyPurpose && t.CreatedAt >= windowStart, ct);
        if (recent >= MaxSendsPer15Minutes)
            throw new ArgumentException("Too many codes requested. Try again in a few minutes.");

        var code = TokenUtils.GenerateSixDigitCode();
        db.EmailTokens.Add(new EmailToken
        {
            WorkspaceId = widget.WorkspaceId,
            Email = email,
            Purpose = EmailVerifyPurpose,
            CodeHash = TokenUtils.Sha256Hex(code),
            ExpiresAt = DateTime.UtcNow.Add(OtpLifetime),
        });
        await db.SaveChangesAsync(ct);

        await mailer.SendAsync(widget.WorkspaceId, email, visitor.Name, "guest_otp", new()
        {
            ["otp"] = $"{code[..3]} {code[3..]}",
            ["expiry_minutes"] = ((int)OtpLifetime.TotalMinutes).ToString(),
        }, ct);
        return true;
    }

    public async Task<WidgetSessionDto?> ConfirmEmailCodeAsync(
        string publicToken, string? origin, string visitorToken,
        string email, string code, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return null;
        var visitor = await FindVisitorAsync(widget, visitorToken, ct);
        if (visitor is null) return null;

        email = email.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;
        var token = await db.EmailTokens
            .Where(t => t.Email == email
                        && t.Purpose == EmailVerifyPurpose
                        && t.WorkspaceId == widget.WorkspaceId
                        && t.ConsumedAt == null
                        && t.ExpiresAt >= now)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (token is null || token.Attempts >= MaxCodeAttempts)
            throw new ArgumentException("That code is not valid. Request a new one.");
        if (token.CodeHash != TokenUtils.Sha256Hex(code.Replace(" ", "")))
        {
            token.Attempts++;
            await db.SaveChangesAsync(ct);
            throw new ArgumentException("That code is not valid.");
        }

        token.ConsumedAt = now;
        visitor.Email = email;
        visitor.IsVerified = true;
        visitor.UserId = await UpsertContactAsync(widget.WorkspaceId, email, visitor.Name, visitor.Phone, ct);
        visitor.LastSeenAt = now;
        await db.SaveChangesAsync(ct);

        return await ToSessionAsync(widget, visitor, null, null, ct);
    }

    // ---- Contacts -------------------------------------------------------------

    /// <summary>
    /// The contact behind a <b>verified</b> visitor, created if this workspace
    /// has never seen them.
    ///
    /// <para>
    /// Never called for an unverified visitor: a typed email address must not be
    /// able to attach a browser to somebody else's contact record, and it must
    /// not be able to conjure contacts either.
    /// </para>
    /// <para>
    /// An address belonging to an agent or an admin is left alone and returns
    /// null (plan § 9.9). Linking would hand a widget session the ticket history
    /// of a staff account, and role is Trackly's to decide (invariant 2), never
    /// an embedding page's.
    /// </para>
    /// </summary>
    private async Task<Guid?> UpsertContactAsync(
        Guid workspaceId, string? email, string? name, string? phone, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;

        var existing = await db.Users.SingleOrDefaultAsync(
            u => u.WorkspaceId == workspaceId && u.Email == email, ct);

        if (existing is not null)
        {
            if (existing.Role != TracklyRoles.Customer)
            {
                logger.LogInformation(
                    "Widget identity {Email} matches a {Role} account; left unlinked", email, existing.Role);
                return null;
            }
            // Fill blanks only. The contact record is the desk's, and an agent
            // who corrected a customer's name should not have it overwritten by
            // whatever the host page happens to send on the next page load.
            if (string.IsNullOrWhiteSpace(existing.Name) && !string.IsNullOrWhiteSpace(name))
                existing.Name = name;
            if (string.IsNullOrWhiteSpace(existing.Phone) && !string.IsNullOrWhiteSpace(phone))
                existing.Phone = phone;
            existing.UpdatedAt = DateTime.UtcNow;
            return existing.Id;
        }

        var contact = new User
        {
            WorkspaceId = workspaceId,
            Email = email,
            Name = name,
            Phone = phone,
            Role = TracklyRoles.Customer,
            // No password and no invitation: this is a contact record, not an
            // account someone can sign in to. They reach their tickets through
            // the widget or an emailed link, exactly as a guest does.
        };
        db.Users.Add(contact);
        await db.SaveChangesAsync(ct);
        return contact.Id;
    }

    // ---- Conversations --------------------------------------------------------

    /// <summary>
    /// The first send in a new conversation. The ticket is created here, not when
    /// the visitor opens the composer (plan § 8.1), so an abandoned draft leaves
    /// nothing in the queue.
    /// </summary>
    public async Task<WidgetConversationCreatedDto?> CreateConversationAsync(
        string publicToken, string? origin, string visitorToken,
        CreateWidgetConversationRequest req, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return null;
        var visitor = await FindVisitorAsync(widget, visitorToken, ct);
        if (visitor is null) return null;

        var message = req.Message?.Trim();
        if (string.IsNullOrEmpty(message))
            throw new ArgumentException("A message is required.");

        if (widget.RequireEmailVerification && !visitor.IsVerified)
            throw new UnauthorizedAccessException("Confirm your email address before starting a conversation.");

        Guid? categoryId = null;
        if (req.CategoryId is not null)
        {
            categoryId = await db.Categories
                .Where(c => c.WorkspaceId == widget.WorkspaceId && c.Id == req.CategoryId)
                .Select(c => (Guid?)c.Id)
                .SingleOrDefaultAsync(ct);
        }

        // The guest token is minted for every widget ticket so the confirmation
        // email's tracking link works, and so phase 3 can hand the same thread to
        // the existing guest view without a second concept.
        var guestToken = TokenUtils.GenerateToken();
        var ticket = new Ticket
        {
            WorkspaceId = widget.WorkspaceId,
            Subject = string.IsNullOrWhiteSpace(req.Subject) ? SubjectFrom(message) : req.Subject.Trim(),
            Description = message,
            Channel = TicketChannel.Widget,
            CategoryId = categoryId,
            TeamId = widget.TeamId,
            WidgetVisitorId = visitor.Id,
            // The trust rule at the point it matters: a requester is a proven
            // identity. An unverified visitor's claimed details go in the guest
            // columns, exactly where a guest form's would.
            RequesterId = visitor.UserId,
            GuestName = visitor.UserId is null ? visitor.Name : null,
            GuestEmail = visitor.UserId is null ? visitor.Email : null,
            GuestTokenHash = TokenUtils.Sha256Hex(guestToken),
        };
        db.Tickets.Add(ticket);

        // Null actor, as for a guest ticket: the visitor has no session, and the
        // ticket's own requester or guest name answers "who raised this".
        activity.Happened(ticket.WorkspaceId, ticket.Id, null, TicketActivityType.Created, ticket.Subject);

        var assigneeId = await ticketService.PickRoundRobinAssigneeAsync(ticket.WorkspaceId, widget.TeamId, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment { Ticket = ticket, AssignedTo = assigneeId.Value });
        }
        await automation.RunOnCreateAsync(ticket, ct);
        await sla.ApplyOnCreateAsync(ticket, ct);

        visitor.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await notifications.OnTicketCreatedAsync(ticket.Id, ct);
        await SendConfirmationAsync(widget, visitor, ticket, guestToken, ct);

        return new WidgetConversationCreatedDto(
            ticket.Id, GuestService.Reference(ticket.Id), ticket.Subject, ticket.Status, ticket.CreatedAt);
    }

    /// <summary>
    /// "We got it", but only to an address we have proof of.
    ///
    /// <para>
    /// An unverified visitor's email is whatever they typed. Sending there would
    /// make any embed on the internet a way to post a Trackly-branded email to a
    /// stranger's inbox, so the confirmation is simply skipped — the panel is the
    /// visitor's receipt, and it is right in front of them.
    /// </para>
    /// </summary>
    private async Task SendConfirmationAsync(
        WidgetConfig widget, WidgetVisitor visitor, Ticket ticket, string guestToken, CancellationToken ct)
    {
        if (!visitor.IsVerified || string.IsNullOrWhiteSpace(visitor.Email)) return;

        var frontend = (configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173").TrimEnd('/');
        var reference = GuestService.Reference(ticket.Id);
        try
        {
            await mailer.SendAsync(widget.WorkspaceId, visitor.Email, visitor.Name, "ticket_received", new()
            {
                ["ticket_ref"] = reference,
                ["ticket_subject"] = ticket.Subject,
                ["ticket_url"] = $"{frontend}/tickets/{ticket.Id}?token={guestToken}",
                ["customer_name"] = visitor.Name ?? "there",
            }, ct);
        }
        catch (Exception ex)
        {
            // The ticket is already committed and the visitor already sees it in
            // the panel. A relay refusing the receipt must not turn a submitted
            // conversation into an error — they would only send it twice.
            logger.LogWarning(ex,
                "Widget confirmation for {TicketId} could not be sent; the ticket was created", ticket.Id);
        }
    }

    // ---- The trust rule, as two queries ----------------------------------------
    // Plan § 3.3 and § 9.7. These are separate methods on purpose: the verified
    // scope is strictly wider, and the only way to reach it is to ask for it by
    // name on a visitor that has actually been proven. Everything that lists,
    // opens, replies to or attaches to a conversation goes through
    // <see cref="Conversations"/> — there is no other path to a ticket in this
    // file, so dropping the filter is not something a new endpoint can do by
    // forgetting.

    /// <summary>
    /// What one browser raised. The whole of an unverified visitor's world.
    /// Matched by the visitor row, never by a claimed email address — that is the
    /// difference between "my conversations" and "type any address, read their
    /// support history".
    /// </summary>
    private IQueryable<Ticket> OwnConversations(WidgetVisitor visitor) =>
        db.Tickets.Where(t => t.WorkspaceId == visitor.WorkspaceId && t.WidgetVisitorId == visitor.Id);

    /// <summary>
    /// Everything belonging to the contact behind a <b>proven</b> identity,
    /// whatever channel it arrived on, plus anything this browser raised before
    /// it was proven.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// If the visitor is not verified. A guard, not a validation: reaching here
    /// with an unverified visitor would be the data leak the trust rule exists to
    /// prevent, so it fails loudly rather than returning rows.
    /// </exception>
    private IQueryable<Ticket> ContactConversations(WidgetVisitor visitor)
    {
        if (!visitor.IsVerified || visitor.UserId is null)
            throw new InvalidOperationException("The contact scope is only for a verified visitor.");

        var userId = visitor.UserId.Value;
        return db.Tickets.Where(t => t.WorkspaceId == visitor.WorkspaceId
                                     && (t.RequesterId == userId || t.WidgetVisitorId == visitor.Id));
    }

    private IQueryable<Ticket> Conversations(WidgetVisitor visitor)
        => visitor is { IsVerified: true, UserId: not null }
            ? ContactConversations(visitor)
            : OwnConversations(visitor);

    // ---- Reading conversations ---------------------------------------------------

    /// <summary>
    /// The home list: open threads always, finished ones only while they are
    /// recent.
    /// </summary>
    public async Task<IReadOnlyList<WidgetConversationDto>?> ListConversationsAsync(
        string publicToken, string? origin, string visitorToken, CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return null;

        var cutoff = DateTime.UtcNow - ClosedWindow;
        var tickets = await Conversations(visitor)
            .Where(t => (t.StatusCategory != TicketStatusCategory.Resolved
                         && t.StatusCategory != TicketStatusCategory.Closed)
                        || t.UpdatedAt >= cutoff)
            .OrderByDescending(t => t.UpdatedAt)
            .Take(MaxConversations)
            .Select(t => new
            {
                t.Id, t.Subject, t.Status, t.StatusCategory,
                t.Description, t.CreatedAt, t.UpdatedAt,
            })
            .ToListAsync(ct);
        if (tickets.Count == 0) return [];

        var ids = tickets.Select(t => t.Id).ToList();

        // One pass over the public comments of those threads. The body is cut to
        // the preview length in SQL — the row shows one line, and a panel asking
        // for its list has no use for fifty full messages.
        var messages = await db.Comments
            .Where(c => ids.Contains(c.TicketId) && !c.IsInternal)
            .Select(c => new
            {
                c.TicketId,
                c.CreatedAt,
                Body = c.Body.Length > PreviewLength ? c.Body.Substring(0, PreviewLength) : c.Body,
                c.BodyFormat,
                AuthorName = c.Author != null ? c.Author.Name : null,
                AuthorRole = c.Author != null ? c.Author.Role : null,
            })
            .ToListAsync(ct);

        var reads = await db.WidgetConversationReads
            .Where(r => r.VisitorId == visitor.Id && ids.Contains(r.TicketId))
            .ToDictionaryAsync(r => r.TicketId, r => r.LastReadAt, ct);

        var visitorName = await VisitorNameAsync(visitor, ct);

        return tickets.Select(t =>
        {
            var thread = messages.Where(m => m.TicketId == t.Id).OrderBy(m => m.CreatedAt).ToList();
            var last = thread.LastOrDefault();

            // No read marker means never opened, so every agent message counts.
            var lastRead = reads.TryGetValue(t.Id, out var at) ? at : DateTime.MinValue;
            var unread = thread.Count(m => IsAgent(m.AuthorRole) && m.CreatedAt > lastRead);

            var lastFromAgent = last is not null && IsAgent(last.AuthorRole);
            return new WidgetConversationDto(
                t.Id,
                GuestService.Reference(t.Id),
                t.Subject,
                t.Status,
                t.StatusCategory,
                // The opening message is the visitor's own, so an empty thread
                // reads "You: ..." rather than having no sender at all.
                last is null ? visitorName : lastFromAgent ? last.AuthorName : visitorName,
                lastFromAgent,
                Preview(last?.Body ?? t.Description, last?.BodyFormat ?? CommentBodyFormat.Text),
                unread,
                t.CreatedAt,
                last?.CreatedAt ?? t.CreatedAt);
        }).ToList();
    }

    /// <summary>
    /// One thread. The ticket's own description is the first message — it is what
    /// the visitor typed into the composer, and the panel has no other place to
    /// show it.
    /// </summary>
    public async Task<WidgetThreadDto?> GetConversationAsync(
        string publicToken, string? origin, string visitorToken, Guid conversationId, CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return null;

        var ticket = await Conversations(visitor)
            .Include(t => t.Assignee)
            .SingleOrDefaultAsync(t => t.Id == conversationId, ct);
        if (ticket is null) return null;

        // Private notes and their attachments never reach a widget (invariant 5),
        // so the filter is on the comment query rather than on the projection.
        var comments = await db.Comments
            .Where(c => c.TicketId == ticket.Id && !c.IsInternal)
            .Include(c => c.Author)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);
        var attachments = await db.Attachments
            .Where(a => a.TicketId == ticket.Id)
            .OrderBy(a => a.CreatedAt)
            .ToListAsync(ct);

        AttachmentDto ToDto(Attachment a) =>
            new(a.Id, a.CommentId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt);

        var visitorName = await VisitorNameAsync(visitor, ct);
        var messages = new List<WidgetMessageDto>
        {
            // The opening message carries the ticket's id, not a comment's. It is
            // the one message with no comment row behind it, and the frame only
            // needs the id to be stable and unique within the thread.
            new(ticket.Id, false, visitorName, ticket.Description, CommentBodyFormat.Text,
                attachments.Where(a => a.CommentId == null).Select(ToDto).ToList(),
                ticket.CreatedAt),
        };
        messages.AddRange(comments.Select(c => new WidgetMessageDto(
            c.Id,
            IsAgent(c.Author?.Role),
            // The author's name or the visitor's, never an email address: an
            // anonymous panel showing "someone@example.com replied" would leak an
            // address to whoever is sitting at that browser.
            IsAgent(c.Author?.Role) ? c.Author?.Name : visitorName,
            c.Body,
            c.BodyFormat,
            attachments.Where(a => a.CommentId == c.Id).Select(ToDto).ToList(),
            c.CreatedAt)));

        var lastRead = await db.WidgetConversationReads
            .Where(r => r.VisitorId == visitor.Id && r.TicketId == ticket.Id)
            .Select(r => (DateTime?)r.LastReadAt)
            .SingleOrDefaultAsync(ct) ?? DateTime.MinValue;

        return new WidgetThreadDto(
            ticket.Id,
            GuestService.Reference(ticket.Id),
            ticket.Subject,
            ticket.Status,
            ticket.StatusCategory,
            ticket.Assignee?.Name,
            messages,
            comments.Count(c => IsAgent(c.Author?.Role) && c.CreatedAt > lastRead),
            ticket.CreatedAt,
            ticket.UpdatedAt);
    }

    // ---- Writing to a conversation -----------------------------------------------

    /// <summary>
    /// A reply from the panel. Reopening a resolved thread is exactly this — the
    /// same thing the guest view does, and the same thing automation already
    /// watches for.
    /// </summary>
    public async Task<WidgetMessageDto?> ReplyAsync(
        string publicToken, string? origin, string visitorToken,
        Guid conversationId, string? body, CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return null;

        var message = body?.Trim();
        if (string.IsNullOrEmpty(message))
            throw new ArgumentException("A message is required.");

        var ticket = await Conversations(visitor).SingleOrDefaultAsync(t => t.Id == conversationId, ct);
        if (ticket is null) return null;

        var comment = new Comment
        {
            TicketId = ticket.Id,
            // A proven visitor writes as their contact; an unproven one writes as
            // the guest they are, with the address they claimed — the same split
            // the ticket itself was created under.
            AuthorId = visitor.UserId,
            GuestEmail = visitor.UserId is null ? visitor.Email ?? ticket.GuestEmail : null,
            // Plain text, always. Accepting markup from an anonymous caller would
            // make the widget the softest way into every agent's screen.
            Body = message,
            BodyFormat = CommentBodyFormat.Text,
            IsInternal = false,
            Visibility = CommentVisibility.Public,
        };
        db.Comments.Add(comment);
        ticket.UpdatedAt = DateTime.UtcNow;
        activity.Happened(ticket.WorkspaceId, ticket.Id, visitor.UserId, TicketActivityType.Replied);

        // You have read what you just wrote. Without this the visitor's own reply
        // would leave the thread's earlier agent messages counted as unread on the
        // next poll, and the badge would come back for no reason.
        await StampReadAsync(visitor.Id, ticket.Id, ticket.UpdatedAt, ct);

        visitor.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent: false, ct);

        var name = await VisitorNameAsync(visitor, ct);
        return new WidgetMessageDto(
            comment.Id, false, name, comment.Body, comment.BodyFormat, [], comment.CreatedAt);
    }

    /// <summary>
    /// The read receipt. Stamped when the visitor opens a thread, which is what
    /// stops the badge coming back on the next poll (plan § 8.1, unread step 3).
    /// </summary>
    public async Task<bool> MarkReadAsync(
        string publicToken, string? origin, string visitorToken, Guid conversationId, CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return false;

        var exists = await Conversations(visitor).AnyAsync(t => t.Id == conversationId, ct);
        if (!exists) return false;

        await StampReadAsync(visitor.Id, conversationId, DateTime.UtcNow, ct);
        visitor.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task StampReadAsync(Guid visitorId, Guid ticketId, DateTime at, CancellationToken ct)
    {
        var row = await db.WidgetConversationReads
            .SingleOrDefaultAsync(r => r.VisitorId == visitorId && r.TicketId == ticketId, ct);
        if (row is null)
        {
            db.WidgetConversationReads.Add(new WidgetConversationRead
            {
                VisitorId = visitorId, TicketId = ticketId, LastReadAt = at,
            });
            return;
        }
        // Never moves backwards: two tabs posting receipts out of order must not
        // resurrect a badge that one of them already cleared.
        if (at > row.LastReadAt) row.LastReadAt = at;
    }

    // ---- Attachments ----------------------------------------------------------------

    public async Task<AttachmentDto?> UploadAttachmentAsync(
        string publicToken, string? origin, string visitorToken, Guid conversationId,
        Guid? commentId, string fileName, string contentType, long sizeBytes, Stream content,
        CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return null;

        var ticket = await Conversations(visitor).SingleOrDefaultAsync(t => t.Id == conversationId, ct);
        if (ticket is null) return null;

        if (sizeBytes is <= 0 or > AttachmentService.MaxSizeBytes)
            throw new ArgumentException("File must be between 1 byte and 10 MB.");
        if (commentId is not null)
        {
            // `!IsInternal` as well as the ticket check: attaching to a private
            // note would put a customer's file inside something they cannot see,
            // and would tell them the note exists.
            var belongs = await db.Comments.AnyAsync(
                c => c.Id == commentId && c.TicketId == ticket.Id && !c.IsInternal, ct);
            if (!belongs)
                throw new ArgumentException("Message does not belong to this conversation.");
        }

        var storageKey = await storage.SaveAsync(
            ticket.WorkspaceId, $"{ticket.WorkspaceId}/{ticket.Id}", fileName, content, ct: ct);
        var attachment = new Attachment
        {
            WorkspaceId = ticket.WorkspaceId,
            TicketId = ticket.Id,
            CommentId = commentId,
            UploadedBy = visitor.UserId,
            FileName = Path.GetFileName(fileName),
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
            SizeBytes = sizeBytes,
            StorageKey = storageKey,
        };
        db.Attachments.Add(attachment);
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return new AttachmentDto(attachment.Id, attachment.CommentId, attachment.FileName,
            attachment.ContentType, attachment.SizeBytes, attachment.CreatedAt);
    }

    /// <summary>
    /// Downloading is not in the plan's endpoint table, but without it the panel
    /// can attach files and never show one back — including the agent's. Scoped
    /// the same way as everything else here: the attachment's ticket has to be
    /// one the trust rule already lets this visitor read.
    /// </summary>
    public async Task<(AttachmentDto Meta, Stream Content)?> DownloadAttachmentAsync(
        string publicToken, string? origin, string visitorToken, Guid conversationId,
        Guid attachmentId, CancellationToken ct)
    {
        var (_, visitor) = await ResolveVisitorAsync(publicToken, origin, visitorToken, ct);
        if (visitor is null) return null;

        var ticket = await Conversations(visitor).SingleOrDefaultAsync(t => t.Id == conversationId, ct);
        if (ticket is null) return null;

        var attachment = await db.Attachments
            .Include(a => a.Comment)
            .SingleOrDefaultAsync(a => a.Id == attachmentId && a.TicketId == ticket.Id, ct);
        if (attachment is null || attachment.Comment?.IsInternal == true) return null;

        var stream = await storage.OpenReadAsync(attachment.WorkspaceId, attachment.StorageKey, ct);
        return (new AttachmentDto(attachment.Id, attachment.CommentId, attachment.FileName,
            attachment.ContentType, attachment.SizeBytes, attachment.CreatedAt), stream);
    }

    // ---- Shared ---------------------------------------------------------------

    /// <summary>
    /// Widget + visitor, or nothing. Every conversation endpoint starts here, so
    /// none of them can be called without both.
    /// </summary>
    private async Task<(WidgetConfig? Widget, WidgetVisitor? Visitor)> ResolveVisitorAsync(
        string publicToken, string? origin, string visitorToken, CancellationToken ct)
    {
        var widget = await ResolveAsync(publicToken, origin, ct);
        if (widget is null) return (null, null);
        return (widget, await FindVisitorAsync(widget, visitorToken, ct));
    }

    /// <summary>
    /// Anyone who is not a customer wrote as the desk. Role is Trackly's
    /// (invariant 2), so this is the only honest test — a null author is a guest
    /// or an inbound email, never an agent.
    /// </summary>
    private static bool IsAgent(string? role) => role is not null && role != TracklyRoles.Customer;

    private async Task<string?> VisitorNameAsync(WidgetVisitor visitor, CancellationToken ct)
    {
        if (visitor.UserId is null) return visitor.Name;
        return await db.Users
            .Where(u => u.Id == visitor.UserId && u.WorkspaceId == visitor.WorkspaceId)
            .Select(u => u.Name)
            .SingleOrDefaultAsync(ct) ?? visitor.Name;
    }

    /// <summary>One line of plain text. An HTML body is flattened, never truncated as markup.</summary>
    private static string Preview(string? body, string format)
    {
        var text = format == CommentBodyFormat.Html ? RichText.ToPlainText(body) : body ?? "";
        text = text.Replace('\r', ' ').Replace('\n', ' ').Trim();
        while (text.Contains("  ")) text = text.Replace("  ", " ");
        return text.Length <= PreviewLength ? text : text[..(PreviewLength - 1)] + "…";
    }

    private async Task<WidgetSessionDto> ToSessionAsync(
        WidgetConfig widget, WidgetVisitor visitor, string? issuedToken, string? identityError, CancellationToken ct)
    {
        // A linked contact is the better source: an agent may have corrected the
        // name after the host page supplied it.
        string? name = visitor.Name, email = visitor.Email, phone = visitor.Phone;
        if (visitor.UserId is not null)
        {
            var contact = await db.Users
                .Where(u => u.Id == visitor.UserId && u.WorkspaceId == widget.WorkspaceId)
                .Select(u => new { u.Name, u.Email, u.Phone })
                .SingleOrDefaultAsync(ct);
            if (contact is not null)
            {
                name = contact.Name ?? name;
                email = contact.Email ?? email;
                phone = contact.Phone ?? phone;
            }
        }

        var identified = !string.IsNullOrWhiteSpace(name) || !string.IsNullOrWhiteSpace(email);
        return new WidgetSessionDto(
            issuedToken, visitor.Id, visitor.IsVerified,
            name, email, phone, visitor.ExternalId,
            widget.ShowWidgetForm && !identified,
            identityError);
    }

    private static string SubjectFrom(string message)
    {
        var line = message.Split('\n', 2)[0].Trim();
        if (line.Length == 0) return "Widget conversation";
        return line.Length <= 80 ? line : line[..77] + "…";
    }

    private static string? Trimmed(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
