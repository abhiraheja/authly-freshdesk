namespace Trackly.Core.Entities;

public class Category
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Color { get; set; }
}
