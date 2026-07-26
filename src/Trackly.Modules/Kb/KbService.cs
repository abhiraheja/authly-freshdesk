using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Kb;

// Knowledge base. Authoring is agent/admin (controller-enforced) and workspace-
// scoped; the public read methods only ever return published articles.
public class KbService(TracklyDbContext db)
{
    // ---- Authoring (agent/admin) --------------------------------------------

    public async Task<IReadOnlyList<KbArticleSummaryDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        return await db.KbArticles
            .Where(a => a.WorkspaceId == actor.WorkspaceId)
            .OrderByDescending(a => a.UpdatedAt)
            .Select(a => new KbArticleSummaryDto(
                a.Id, a.Title, a.Category != null ? a.Category.Name : null, a.Status, a.UpdatedAt))
            .ToListAsync(ct);
    }

    public async Task<KbArticleDto?> GetAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var a = await db.KbArticles
            .Include(x => x.Category)
            .SingleOrDefaultAsync(x => x.Id == id && x.WorkspaceId == actor.WorkspaceId, ct);
        return a is null ? null : ToDto(a);
    }

    public async Task<KbArticleDto> CreateAsync(Actor actor, SaveKbArticleRequest req, CancellationToken ct)
    {
        Validate(req);
        var article = new KbArticle
        {
            WorkspaceId = actor.WorkspaceId,
            Title = req.Title.Trim(),
            Body = req.Body.Trim(),
            CategoryId = await ValidCategoryAsync(actor, req.CategoryId, ct),
            Status = req.Status,
            PublishedAt = req.Status == KbArticleStatus.Published ? DateTime.UtcNow : null,
            CreatedBy = actor.UserId,
        };
        db.KbArticles.Add(article);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(actor, article.Id, ct))!;
    }

    public async Task<KbArticleDto?> UpdateAsync(Actor actor, Guid id, SaveKbArticleRequest req, CancellationToken ct)
    {
        Validate(req);
        var article = await db.KbArticles
            .SingleOrDefaultAsync(a => a.Id == id && a.WorkspaceId == actor.WorkspaceId, ct);
        if (article is null) return null;

        article.Title = req.Title.Trim();
        article.Body = req.Body.Trim();
        article.CategoryId = await ValidCategoryAsync(actor, req.CategoryId, ct);
        // Stamp published_at on the draft -> published transition.
        if (req.Status == KbArticleStatus.Published && article.Status != KbArticleStatus.Published)
            article.PublishedAt = DateTime.UtcNow;
        if (req.Status == KbArticleStatus.Draft)
            article.PublishedAt = null;
        article.Status = req.Status;
        article.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, id, ct);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var deleted = await db.KbArticles
            .Where(a => a.Id == id && a.WorkspaceId == actor.WorkspaceId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }

    // ---- Public (published only, by workspace slug) -------------------------

    public async Task<IReadOnlyList<PublicKbSummaryDto>> ListPublishedAsync(string slug, CancellationToken ct)
    {
        return await PublishedIn(slug)
            .OrderByDescending(a => a.PublishedAt)
            .Select(a => new PublicKbSummaryDto(
                a.Id, a.Title, a.Category != null ? a.Category.Name : null, Excerpt(a.Body)))
            .ToListAsync(ct);
    }

    public async Task<PublicKbArticleDto?> GetPublishedAsync(string slug, Guid id, CancellationToken ct)
    {
        var a = await PublishedIn(slug).Include(x => x.Category)
            .SingleOrDefaultAsync(x => x.Id == id, ct);
        return a is null ? null
            : new PublicKbArticleDto(a.Id, a.Title, a.Body, a.Category != null ? a.Category.Name : null, a.PublishedAt);
    }

    // Type-ahead deflection: published articles whose title matches the query.
    public async Task<IReadOnlyList<PublicKbSummaryDto>> SuggestAsync(string slug, string query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 3)
            return [];
        return await PublishedIn(slug)
            .Where(a => EF.Functions.ILike(a.Title, $"%{query.Trim()}%"))
            .OrderByDescending(a => a.PublishedAt)
            .Take(5)
            .Select(a => new PublicKbSummaryDto(
                a.Id, a.Title, a.Category != null ? a.Category.Name : null, Excerpt(a.Body)))
            .ToListAsync(ct);
    }

    private IQueryable<KbArticle> PublishedIn(string slug) =>
        db.KbArticles.Where(a => a.Workspace!.Slug == slug && a.Status == KbArticleStatus.Published);

    // ---- Helpers -------------------------------------------------------------

    private static void Validate(SaveKbArticleRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Title) || string.IsNullOrWhiteSpace(req.Body))
            throw new ArgumentException("Title and body are required.");
        if (!KbArticleStatus.All.Contains(req.Status))
            throw new ArgumentException("Invalid status.");
    }

    private async Task<Guid?> ValidCategoryAsync(Actor actor, Guid? categoryId, CancellationToken ct)
    {
        if (categoryId is null) return null;
        var ok = await db.Categories.AnyAsync(c => c.Id == categoryId && c.WorkspaceId == actor.WorkspaceId, ct);
        if (!ok) throw new ArgumentException("Unknown category.");
        return categoryId;
    }

    private static string Excerpt(string body) =>
        body.Length <= 160 ? body : body[..160].TrimEnd() + "…";

    private static KbArticleDto ToDto(KbArticle a) => new(
        a.Id, a.Title, a.Body, a.CategoryId, a.Category?.Name, a.Status, a.UpdatedAt, a.PublishedAt);
}

public record KbArticleSummaryDto(Guid Id, string Title, string? CategoryName, string Status, DateTime UpdatedAt);
public record KbArticleDto(
    Guid Id, string Title, string Body, Guid? CategoryId, string? CategoryName, string Status,
    DateTime UpdatedAt, DateTime? PublishedAt);
public record SaveKbArticleRequest(string Title, string Body, Guid? CategoryId, string Status);

public record PublicKbSummaryDto(Guid Id, string Title, string? CategoryName, string Excerpt);
public record PublicKbArticleDto(Guid Id, string Title, string Body, string? CategoryName, DateTime? PublishedAt);
