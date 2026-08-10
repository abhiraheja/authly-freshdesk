namespace Trackly.Core.Interfaces;

/// <summary>
/// Nudges any embedded widget panel that is watching a ticket.
///
/// <para>
/// An interface, and not a direct SignalR call, because the reply paths that
/// need to fire it all live in <c>Trackly.Modules</c> while the hub lives in
/// <c>Trackly.Api</c>. The default implementation does nothing, so a host that
/// never maps the hub still works — the panel polls as well (plan § 10, phase 3).
/// </para>
/// <para>
/// The payload is deliberately just an id. The panel re-fetches the thread
/// through the endpoint that already applies the trust rule and strips internal
/// notes, so nothing can leak down the socket that could not leak over HTTP.
/// </para>
/// </summary>
public interface IWidgetRealtime
{
    /// <summary>
    /// Best-effort: never throws, and never fails the operation that triggered it.
    /// </summary>
    Task ConversationUpdatedAsync(Guid ticketId, CancellationToken ct);
}

/// <summary>Used when no transport is wired up. Every call is a no-op.</summary>
public sealed class NoOpWidgetRealtime : IWidgetRealtime
{
    public Task ConversationUpdatedAsync(Guid ticketId, CancellationToken ct) => Task.CompletedTask;
}
