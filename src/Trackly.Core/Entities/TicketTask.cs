namespace Trackly.Core.Entities;

/// <summary>
/// A piece of work that has to happen before the ticket is done.
///
/// A checklist, not sub-tickets. The distinction is the point: a sub-ticket has
/// its own requester, SLA, status vocabulary and inbox, and none of that is
/// wanted for "call the vendor" or "order the replacement". These are steps on
/// one ticket, and they close with it.
///
/// **Nothing blocks on them.** An open task does not stop the ticket being
/// resolved — the count is shown and the agent decides. A hard block would mean
/// a ticket nobody can close because of a checklist item somebody added and
/// forgot, and the usual escape from that is to delete the task, which loses the
/// record.
/// </summary>
public class TicketTask
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    public string Title { get; set; } = null!;

    /// <summary>
    /// Who is doing it. Optional and independent of the ticket's assignee — the
    /// point of a task list is often that one step belongs to somebody else.
    /// </summary>
    public Guid? AssigneeId { get; set; }
    public User? Assignee { get; set; }

    public DateTime? DueAt { get; set; }

    /// <summary>When it was ticked. Null means open. Doubles as the flag.</summary>
    public DateTime? CompletedAt { get; set; }
    public Guid? CompletedById { get; set; }
    public User? CompletedBy { get; set; }

    public int SortOrder { get; set; }

    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
