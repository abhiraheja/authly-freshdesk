namespace Trackly.Core.Entities;

// A knowledge-base article. Draft articles are agent-only; published articles are
// served on the public branded /kb and suggested on the submit form (deflection).
public class KbArticle
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }
    public string Title { get; set; } = null!;
    public string Body { get; set; } = null!;
    public string Status { get; set; } = KbArticleStatus.Draft;
    public Guid CreatedBy { get; set; }
    public User CreatedByUser { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PublishedAt { get; set; }
}

public static class KbArticleStatus
{
    public const string Draft = "draft";
    public const string Published = "published";
    public static readonly string[] All = [Draft, Published];
}
