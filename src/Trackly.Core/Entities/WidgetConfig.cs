namespace Trackly.Core.Entities;

// Per-workspace embeddable widget settings. Fields holds a JSON object describing
// which submit-form fields to show/require/prefill. One row per workspace.
public class WidgetConfig
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string EmbedType { get; set; } = WidgetEmbedType.Floating;
    public string Fields { get; set; } = """{"fields":["name","email","subject","description"]}""";
    public string Theme { get; set; } = "light";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class WidgetEmbedType
{
    public const string Floating = "floating";
    public const string Inline = "inline";
    public const string Link = "link";
    public static readonly string[] All = [Floating, Inline, Link];
}
