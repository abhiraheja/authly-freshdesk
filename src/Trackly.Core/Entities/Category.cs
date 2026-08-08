namespace Trackly.Core.Entities;

/// <summary>
/// What a ticket is about — Billing, Hardware, Access.
///
/// **Two levels, and only two.** A category with a <see cref="ParentId"/> is a
/// sub-category. Trackly stops there on purpose: three levels means an agent
/// navigating a tree to file a ticket, and the third level is invariably where
/// a taxonomy starts disagreeing with itself.
/// </summary>
public class Category
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Color { get; set; }

    /// <summary>Null for a top-level category. A sub-category's parent is always top-level.</summary>
    public Guid? ParentId { get; set; }
    public Category? Parent { get; set; }
    public ICollection<Category> Children { get; set; } = new List<Category>();
}
