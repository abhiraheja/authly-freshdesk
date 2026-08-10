namespace Trackly.Api.Widgets;

/// <summary>
/// The one cross-origin policy Trackly has. Named in one place so the endpoints
/// that opt in and the registration that defines it cannot drift apart — a typo
/// in either is a policy that silently does nothing.
/// </summary>
public static class WidgetCors
{
    public const string Policy = "widget-public";
}
