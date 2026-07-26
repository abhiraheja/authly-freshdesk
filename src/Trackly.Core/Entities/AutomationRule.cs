namespace Trackly.Core.Entities;

// A workspace automation rule: when the trigger fires and all conditions match,
// the actions are applied to the ticket. Conditions and Actions are stored as
// JSON (arrays of {field,op,value} / {type,value}) and parsed in the service.
public class AutomationRule
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string Trigger { get; set; } = AutomationTrigger.OnCreate;
    public string ConditionsJson { get; set; } = "[]";
    public string ActionsJson { get; set; } = "[]";
    public bool Enabled { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class AutomationTrigger
{
    public const string OnCreate = "on_create";
    public const string OnUpdate = "on_update";
    public static readonly string[] All = [OnCreate, OnUpdate];
}

public static class AutomationField
{
    public const string Priority = "priority";
    public const string Status = "status";
    public const string Channel = "channel";
    public const string Category = "category";
    public const string Subject = "subject";
    public static readonly string[] All = [Priority, Status, Channel, Category, Subject];
}

public static class AutomationOp
{
    public const string Eq = "equals";
    public const string NotEq = "not_equals";
    public const string Contains = "contains";
    public static readonly string[] All = [Eq, NotEq, Contains];
}

public static class AutomationActionType
{
    public const string SetPriority = "set_priority";
    public const string SetStatus = "set_status";
    public const string AssignTeam = "assign_team";
    public const string AddTag = "add_tag";
    public const string AddNote = "add_note";
    public static readonly string[] All = [SetPriority, SetStatus, AssignTeam, AddTag, AddNote];
}
