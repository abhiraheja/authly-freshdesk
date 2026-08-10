namespace Trackly.Core.Entities;

/// <summary>
/// How far one visitor has read one widget conversation.
///
/// <para>
/// Keyed by <b>visitor</b>, not by contact: the same verified person on a laptop
/// and on a phone is two <see cref="WidgetVisitor"/> rows, and each carries its
/// own unread count. Reading a thread at your desk should not silently clear the
/// badge on the phone in your pocket.
/// </para>
/// <para>
/// There is deliberately no <c>unread_count</c> column. The count is
/// <c>COUNT(public comments by an agent WHERE created_at &gt; last_read_at)</c>,
/// derived on every read, so it cannot drift out of step with the thread it
/// describes — which a stored counter does the first time a comment is deleted
/// or a write is lost.
/// </para>
/// </summary>
public class WidgetConversationRead
{
    public Guid VisitorId { get; set; }
    public WidgetVisitor Visitor { get; set; } = null!;

    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;

    public DateTime LastReadAt { get; set; } = DateTime.UtcNow;
}
