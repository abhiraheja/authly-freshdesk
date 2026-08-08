namespace Trackly.Core.Entities;

/// <summary>
/// Something the business runs that customers depend on: Payments, Email,
/// the VPN, the warehouse printer queue.
///
/// Named <c>BusinessService</c> rather than <c>Service</c> because the codebase
/// is full of <c>*Service</c> classes and a domain entity sharing that suffix
/// would be misread on every import line for the life of the project.
///
/// Separate from <see cref="Asset"/> on purpose. An asset is a thing you own; a
/// service is a thing you promise. "Payments is down" and "this laptop is
/// broken" are different sentences with different audiences, and a workspace
/// wants to count them separately.
/// </summary>
public class BusinessService
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string Name { get; set; } = null!;
    public string? Description { get; set; }

    /// <summary>
    /// The team that owns it. Optional, but it is the field that makes the
    /// catalogue worth keeping: it answers "who do we call" without asking.
    /// </summary>
    public Guid? OwnerTeamId { get; set; }
    public Team? OwnerTeam { get; set; }

    /// <summary>Retired rather than deleted — tickets referencing it keep their meaning.</summary>
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A service this ticket has taken down or degraded.
///
/// <see cref="Impact"/> is what makes the row worth having. "Payments" on a
/// ticket says almost nothing; "Payments — card captures failing for EU
/// customers since 09:40" is the sentence somebody writing the status page
/// needs, and it is written once here instead of three times in the thread.
/// </summary>
public class TicketImpactedService
{
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public Guid ServiceId { get; set; }
    public BusinessService? Service { get; set; }

    /// <summary>What is broken about it, and for whom. Free text.</summary>
    public string? Impact { get; set; }

    /// <summary>One of <see cref="ServiceImpactLevel"/>.</summary>
    public string Level { get; set; } = ServiceImpactLevel.Degraded;

    public Guid? AddedBy { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// How badly. Three levels, matching what every status page in the world shows,
/// because the point of this field is that somebody outside the ticket can read
/// it at a glance.
/// </summary>
public static class ServiceImpactLevel
{
    public const string Down = "down";
    public const string Degraded = "degraded";
    public const string Minor = "minor";
    public static readonly string[] All = [Down, Degraded, Minor];
    public static bool IsKnown(string level) => All.Contains(level);
}
