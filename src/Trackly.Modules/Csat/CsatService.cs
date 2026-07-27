using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Csat;

public enum CsatSubmit { Ok, NotFound, AlreadySubmitted, BadRating }

// Public view of a survey (rendered on the branded /csat page).
public record CsatView(string WorkspaceSlug, string TicketRef, string Subject, int? Rating, bool Submitted);

// Agent-facing view of a ticket's satisfaction result.
public record CsatResult(int? Rating, string? Comment, bool Submitted);

// Customer-satisfaction surveys. A survey is issued when a ticket is resolved
// (token returned once, for the email link); the customer rates it exactly once
// via the public endpoints. All reads are workspace-scoped for agents; the
// public rating path is authenticated only by the single-use hashed token.
public class CsatService(TracklyDbContext db)
{
    public const int MinRating = 1;
    public const int MaxRating = 5;

    // Called when a ticket transitions to Resolved. Returns the raw rating token
    // to embed in the resolution email, or null when no survey should be sent
    // (CSAT disabled for the workspace, or the ticket was already rated).
    public async Task<string?> IssueForResolutionAsync(Ticket ticket, CancellationToken ct)
    {
        var enabled = await db.NotificationSettings
            .Where(s => s.WorkspaceId == ticket.WorkspaceId)
            .Select(s => (bool?)s.CsatEnabled)
            .SingleOrDefaultAsync(ct) ?? true; // absent settings row ⇒ defaults on
        if (!enabled) return null;

        var token = TokenUtils.GenerateToken();
        var hash = TokenUtils.Sha256Hex(token);

        var survey = await db.CsatSurveys.SingleOrDefaultAsync(s => s.TicketId == ticket.Id, ct);
        if (survey is null)
        {
            db.CsatSurveys.Add(new CsatSurvey
            {
                WorkspaceId = ticket.WorkspaceId,
                TicketId = ticket.Id,
                TokenHash = hash,
                AgentId = ticket.AssigneeId,
                IssuedAt = DateTime.UtcNow,
            });
        }
        else if (survey.SubmittedAt is not null)
        {
            return null; // already rated — don't survey the same ticket twice
        }
        else
        {
            // Re-resolved before being rated: rotate the token (old link dies) and
            // refresh the attributed agent + issue time.
            survey.TokenHash = hash;
            survey.AgentId = ticket.AssigneeId;
            survey.IssuedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return token;
    }

    // ---- Public (token-authenticated) ---------------------------------------

    public async Task<CsatView?> GetPublicAsync(Guid ticketId, string token, CancellationToken ct)
    {
        var survey = await FindAsync(ticketId, token, ct);
        if (survey is null) return null;
        return new CsatView(
            survey.Ticket.Workspace.Slug,
            ShortRef(survey.TicketId),
            survey.Ticket.Subject,
            survey.Rating,
            survey.SubmittedAt is not null);
    }

    public async Task<CsatSubmit> SubmitAsync(Guid ticketId, string token, int rating, string? comment, CancellationToken ct)
    {
        if (rating < MinRating || rating > MaxRating) return CsatSubmit.BadRating;

        var survey = await FindAsync(ticketId, token, ct);
        if (survey is null) return CsatSubmit.NotFound;
        if (survey.SubmittedAt is not null) return CsatSubmit.AlreadySubmitted;

        survey.Rating = rating;
        survey.Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        survey.SubmittedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return CsatSubmit.Ok;
    }

    // ---- Agent-facing --------------------------------------------------------

    public async Task<CsatResult?> GetForTicketAsync(Guid workspaceId, Guid ticketId, CancellationToken ct)
    {
        var survey = await db.CsatSurveys
            .SingleOrDefaultAsync(s => s.TicketId == ticketId && s.WorkspaceId == workspaceId, ct);
        return survey is null ? null : new CsatResult(survey.Rating, survey.Comment, survey.SubmittedAt is not null);
    }

    // ---- Helpers -------------------------------------------------------------

    private Task<CsatSurvey?> FindAsync(Guid ticketId, string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token)) return Task.FromResult<CsatSurvey?>(null);
        var hash = TokenUtils.Sha256Hex(token);
        return db.CsatSurveys
            .Include(s => s.Ticket).ThenInclude(t => t.Workspace)
            .SingleOrDefaultAsync(s => s.TicketId == ticketId && s.TokenHash == hash, ct);
    }

    private static string ShortRef(Guid ticketId) => ticketId.ToString("N")[..8];
}
