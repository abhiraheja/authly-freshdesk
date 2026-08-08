namespace Trackly.Core.Entities;

/// <summary>
/// A thing the workspace owns and supports: a laptop, a printer, a licence, a
/// server.
///
/// **Deliberately thin.** A real CMDB has relationships, lifecycle states,
/// discovery agents and depreciation, and building a bad one is worse than
/// building none — people put data in it and then cannot trust it. What Trackly
/// needs is the ability to say *which machine this ticket is about*, and to find
/// the other tickets about that machine. That is what this holds and no more.
///
/// Everything except <see cref="Name"/> is optional so a workspace can start by
/// typing names in and add tags and serials when it turns out to need them.
/// </summary>
public class Asset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string Name { get; set; } = null!;

    /// <summary>Free text: "Laptop", "Printer", "Licence". Not an enum — the next workspace's list is different.</summary>
    public string? Kind { get; set; }

    /// <summary>Serial, asset tag, licence key — whatever this workspace uses to identify one.</summary>
    public string? Tag { get; set; }

    /// <summary>Where it is, or which office. Free text for the same reason as Kind.</summary>
    public string? Location { get; set; }

    /// <summary>
    /// Who has it. Optional: shared and unassigned equipment is normal, and
    /// forcing a holder would mean inventing one.
    /// </summary>
    public Guid? AssignedToId { get; set; }
    public User? AssignedTo { get; set; }

    public string? Notes { get; set; }

    /// <summary>Retired rather than deleted — tickets that reference it keep their meaning.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>The asset a ticket is about.</summary>
public class TicketAsset
{
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public Guid AssetId { get; set; }
    public Asset? Asset { get; set; }
    public Guid? AddedBy { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}
