namespace Trackly.Core.Interfaces;

/// <summary>
/// Nudges the agent screens watching a ticket.
///
/// <para>
/// The mirror image of <see cref="IWidgetRealtime"/>, and it exists for the same
/// reason: a reply arrives from a surface the agent is not looking at. The
/// widget panel had a push and the agent's ticket page did not, so a visitor's
/// message sat unseen until somebody happened to reload — the desk is the one
/// screen where that is least acceptable.
/// </para>
/// <para>
/// An interface rather than a direct SignalR call because the reply paths live
/// in <c>Trackly.Modules</c> and the hub lives in <c>Trackly.Api</c>. The default
/// implementation does nothing, so a host that never maps the hub still works.
/// </para>
/// <para>
/// The payload is deliberately just an id. The screen re-fetches through the
/// endpoints that already apply workspace isolation and the private-note rules,
/// so nothing can leak down the socket that could not leak over HTTP.
/// </para>
/// </summary>
public interface ITicketRealtime
{
    /// <summary>
    /// Best-effort: never throws, and never fails the operation that triggered it.
    /// </summary>
    /// <param name="workspaceId">
    /// Passed in rather than looked up, because it is what names the group and
    /// the caller already has it. A push that had to re-read the ticket to find
    /// its workspace would be a second query on every reply.
    /// </param>
    Task TicketUpdatedAsync(Guid workspaceId, Guid ticketId, CancellationToken ct);
}

/// <summary>Used when no transport is wired up. Every call is a no-op.</summary>
public sealed class NoOpTicketRealtime : ITicketRealtime
{
    public Task TicketUpdatedAsync(Guid workspaceId, Guid ticketId, CancellationToken ct)
        => Task.CompletedTask;
}
