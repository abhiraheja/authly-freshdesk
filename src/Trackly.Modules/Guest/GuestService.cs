using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Guest;

public class GuestService(
    TracklyDbContext db,
    IEmailSender emailSender,
    IFileStorage storage,
    IConfiguration configuration,
    TicketService ticketService,
    NotificationService notifications)
{
    private const int MaxSendsPer15Minutes = 3;
    private const int MaxCodeAttempts = 5;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SubmissionTokenLifetime = TimeSpan.FromMinutes(30);

    // The plan's "guest_verify" purpose covers the emailed OTP; once verified we
    // issue a second, short-lived row ("guest_submit") whose token authorises the
    // actual ticket creation without re-verifying.
    private const string SubmitPurpose = "guest_submit";

    // ---- OTP ---------------------------------------------------------------

    public async Task<GuestOtpStatus> SendOtpAsync(string email, string workspaceSlug, CancellationToken ct)
    {
        email = email.Trim().ToLowerInvariant();
        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Slug == workspaceSlug, ct);
        if (workspace is null)
            return GuestOtpStatus.WorkspaceNotFound;

        var windowStart = DateTime.UtcNow.AddMinutes(-15);
        var recentSends = await db.EmailTokens
            .CountAsync(t => t.Email == email && t.CreatedAt >= windowStart, ct);
        if (recentSends >= MaxSendsPer15Minutes)
            return GuestOtpStatus.RateLimited;

        var code = TokenUtils.GenerateSixDigitCode();
        db.EmailTokens.Add(new EmailToken
        {
            WorkspaceId = workspace.Id,
            Email = email,
            Purpose = EmailTokenPurpose.GuestVerify,
            CodeHash = TokenUtils.Sha256Hex(code),
            ExpiresAt = DateTime.UtcNow.Add(OtpLifetime),
        });
        await db.SaveChangesAsync(ct);

        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == workspace.Id, ct);
        var productName = branding?.PageTitle ?? workspace.Name;
        await emailSender.SendAsync(new EmailMessage(
            email,
            $"Your {productName} verification code",
            $"""
            Confirm your email

            Enter this code to submit your support ticket: {code[..3]} {code[3..]}

            The code expires in 10 minutes. If you didn't request this, ignore this email.
            """), ct);
        return GuestOtpStatus.Sent;
    }

    public async Task<GuestOtpVerifyResult> VerifyOtpAsync(
        string email, string code, string workspaceSlug, CancellationToken ct)
    {
        email = email.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;
        var token = await db.EmailTokens
            .Where(t => t.Email == email
                        && t.Purpose == EmailTokenPurpose.GuestVerify
                        && t.Workspace!.Slug == workspaceSlug
                        && t.ConsumedAt == null
                        && t.ExpiresAt >= now)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (token is null)
            return new GuestOtpVerifyResult(false, false, null);
        if (token.Attempts >= MaxCodeAttempts)
            return new GuestOtpVerifyResult(false, true, null);
        if (token.CodeHash != TokenUtils.Sha256Hex(code.Replace(" ", "")))
        {
            token.Attempts++;
            await db.SaveChangesAsync(ct);
            return new GuestOtpVerifyResult(false, token.Attempts >= MaxCodeAttempts, null);
        }

        token.ConsumedAt = now;
        var submissionToken = TokenUtils.GenerateToken();
        db.EmailTokens.Add(new EmailToken
        {
            WorkspaceId = token.WorkspaceId,
            Email = email,
            Purpose = SubmitPurpose,
            LinkTokenHash = TokenUtils.Sha256Hex(submissionToken),
            CodeHash = "-", // unused for submission tokens
            ExpiresAt = now.Add(SubmissionTokenLifetime),
        });
        await db.SaveChangesAsync(ct);
        return new GuestOtpVerifyResult(true, false, submissionToken);
    }

    // ---- Ticket creation ------------------------------------------------------

    public async Task<GuestTicketCreated?> CreateTicketAsync(
        string workspaceSlug, CreateGuestTicketRequest request, CancellationToken ct)
    {
        var hash = TokenUtils.Sha256Hex(request.SubmissionToken);
        var now = DateTime.UtcNow;
        var token = await db.EmailTokens
            .Include(t => t.Workspace)
            .SingleOrDefaultAsync(t => t.LinkTokenHash == hash
                                       && t.Purpose == SubmitPurpose
                                       && t.ConsumedAt == null
                                       && t.ExpiresAt >= now
                                       && t.Workspace!.Slug == workspaceSlug, ct);
        if (token is null)
            return null;

        Guid? categoryId = null;
        if (request.CategoryId is not null)
        {
            categoryId = await db.Categories
                .Where(c => c.WorkspaceId == token.WorkspaceId && c.Id == request.CategoryId)
                .Select(c => (Guid?)c.Id)
                .SingleOrDefaultAsync(ct);
        }

        var guestToken = TokenUtils.GenerateToken();
        var ticket = new Ticket
        {
            WorkspaceId = token.WorkspaceId!.Value,
            Subject = request.Subject.Trim(),
            Description = request.Description.Trim(),
            CategoryId = categoryId,
            GuestEmail = token.Email,
            GuestName = request.Name.Trim(),
            GuestTokenHash = TokenUtils.Sha256Hex(guestToken),
        };
        db.Tickets.Add(ticket);
        token.ConsumedAt = now;

        var assigneeId = await ticketService.PickRoundRobinAssigneeAsync(ticket.WorkspaceId, ct);
        if (assigneeId is not null)
        {
            ticket.AssigneeId = assigneeId;
            db.TicketAssignments.Add(new TicketAssignment { Ticket = ticket, AssignedTo = assigneeId.Value });
        }
        await db.SaveChangesAsync(ct);

        var reference = Reference(ticket.Id);
        var frontendBaseUrl = configuration["App:FrontendBaseUrl"] ?? "http://localhost:5173";
        var trackUrl = $"{frontendBaseUrl}/tickets/{ticket.Id}?token={guestToken}&workspace={workspaceSlug}";
        var branding = await db.WorkspaceBrandings.SingleOrDefaultAsync(b => b.WorkspaceId == ticket.WorkspaceId, ct);
        var productName = branding?.PageTitle ?? token.Workspace!.Name;
        await emailSender.SendAsync(new EmailMessage(
            token.Email,
            $"[{reference}] We received your ticket — {productName}",
            $"""
            Your ticket has been received

            Reference: {reference}
            Subject: {ticket.Subject}

            Track this ticket or reply using your private link (no account needed):
            {trackUrl}

            Tip: sign in later with this email address and the ticket will appear in your account automatically.
            """, null, request.Name), ct);

        return new GuestTicketCreated(ticket.Id, reference, guestToken);
    }

    public static string Reference(Guid ticketId) => $"#{ticketId.ToString("N")[..8].ToUpperInvariant()}";

    // ---- Magic-link view + reply ------------------------------------------------

    private async Task<Ticket?> ResolveGuestTicketAsync(Guid ticketId, string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token))
            return null;
        var hash = TokenUtils.Sha256Hex(token);
        return await db.Tickets.SingleOrDefaultAsync(t => t.Id == ticketId && t.GuestTokenHash == hash, ct);
    }

    public async Task<GuestTicketView?> GetTicketAsync(Guid ticketId, string token, CancellationToken ct)
    {
        var ticket = await ResolveGuestTicketAsync(ticketId, token, ct);
        if (ticket is null)
            return null;

        await db.Entry(ticket).Reference(t => t.Category).LoadAsync(ct);

        // Private notes and their attachments never reach guest views.
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

        return new GuestTicketView(
            ticket.Id,
            Reference(ticket.Id),
            ticket.Subject,
            ticket.Description,
            ticket.Status,
            CategoryDto.From(ticket.Category),
            ticket.GuestName ?? "Guest",
            ticket.GuestEmail!,
            comments.Select(c => new CommentDto(
                c.Id, UserSummaryDto.From(c.Author), c.GuestEmail, c.Body, false, c.Source,
                attachments.Where(a => a.CommentId == c.Id).Select(ToDto).ToList(),
                c.CreatedAt)).ToList(),
            attachments.Where(a => a.CommentId == null).Select(ToDto).ToList(),
            ticket.CreatedAt,
            ticket.UpdatedAt);
    }

    public async Task<CommentDto?> AddCommentAsync(Guid ticketId, string token, string body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body))
            throw new ArgumentException("Comment body is required.");

        var ticket = await ResolveGuestTicketAsync(ticketId, token, ct);
        if (ticket is null)
            return null;

        var comment = new Comment
        {
            TicketId = ticket.Id,
            GuestEmail = ticket.GuestEmail,
            Body = body.Trim(),
            IsInternal = false,
        };
        db.Comments.Add(comment);
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // A guest reply is a customer-side reply → notify the assignee + watchers.
        await notifications.OnReplyAsync(ticket.Id, comment.Id, authoredByAgent: false, ct);

        return new CommentDto(comment.Id, null, comment.GuestEmail, comment.Body, false, comment.Source, [], comment.CreatedAt);
    }

    // ---- Guest attachments ---------------------------------------------------------

    public async Task<AttachmentDto?> UploadAttachmentAsync(
        Guid ticketId, string token, Guid? commentId,
        string fileName, string contentType, long sizeBytes, Stream content,
        CancellationToken ct)
    {
        var ticket = await ResolveGuestTicketAsync(ticketId, token, ct);
        if (ticket is null)
            return null;

        if (sizeBytes is <= 0 or > AttachmentService.MaxSizeBytes)
            throw new ArgumentException("File must be between 1 byte and 10 MB.");
        if (commentId is not null)
        {
            var belongs = await db.Comments.AnyAsync(
                c => c.Id == commentId && c.TicketId == ticket.Id && !c.IsInternal, ct);
            if (!belongs)
                throw new ArgumentException("Comment does not belong to this ticket.");
        }

        var storageKey = await storage.SaveAsync($"{ticket.WorkspaceId}/{ticket.Id}", fileName, content, ct);
        var attachment = new Attachment
        {
            WorkspaceId = ticket.WorkspaceId,
            TicketId = ticket.Id,
            CommentId = commentId,
            UploadedBy = null, // guest
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

    public async Task<(AttachmentDto Meta, Stream Content)?> DownloadAttachmentAsync(
        Guid attachmentId, string token, CancellationToken ct)
    {
        var attachment = await db.Attachments
            .Include(a => a.Ticket)
            .Include(a => a.Comment)
            .SingleOrDefaultAsync(a => a.Id == attachmentId, ct);
        if (attachment is null || string.IsNullOrEmpty(token))
            return null;
        if (attachment.Ticket.GuestTokenHash != TokenUtils.Sha256Hex(token))
            return null;
        if (attachment.Comment?.IsInternal == true)
            return null;

        var stream = await storage.OpenReadAsync(attachment.StorageKey, ct);
        return (new AttachmentDto(attachment.Id, attachment.CommentId, attachment.FileName,
            attachment.ContentType, attachment.SizeBytes, attachment.CreatedAt), stream);
    }
}
