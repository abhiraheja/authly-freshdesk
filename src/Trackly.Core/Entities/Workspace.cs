namespace Trackly.Core.Entities;

public class Workspace
{
    public Guid Id { get; set; }
    public string Name { get; set; } = null!;
    public string Slug { get; set; } = null!;
    public bool EmailLoginEnabled { get; set; } = true;
    public bool AiEnabled { get; set; } = true;   // per-workspace kill switch for the AI copilot
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = new List<User>();
}
