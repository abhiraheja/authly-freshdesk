using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules.Tickets;

// Automation engine + admin CRUD. On create/update, enabled rules for the trigger
// are evaluated in order; when every condition matches, the actions mutate the
// tracked ticket (and add tag/note entities) without saving — the caller's
// SaveChanges persists everything atomically. Automation's own mutations are not
// re-evaluated, so rules can't loop.
public class AutomationService(TracklyDbContext db, ILogger<AutomationService> logger)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public Task RunOnCreateAsync(Ticket ticket, CancellationToken ct)
        => RunAsync(ticket, AutomationTrigger.OnCreate, ct);

    public Task RunOnUpdateAsync(Ticket ticket, CancellationToken ct)
        => RunAsync(ticket, AutomationTrigger.OnUpdate, ct);

    private async Task RunAsync(Ticket ticket, string trigger, CancellationToken ct)
    {
        var rules = await db.AutomationRules
            .Where(r => r.WorkspaceId == ticket.WorkspaceId && r.Trigger == trigger && r.Enabled)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.CreatedAt)
            .ToListAsync(ct);

        foreach (var rule in rules)
        {
            try
            {
                var conditions = JsonSerializer.Deserialize<List<Condition>>(rule.ConditionsJson, Json) ?? [];
                if (!conditions.All(c => Matches(ticket, c))) continue;

                var actions = JsonSerializer.Deserialize<List<ActionDef>>(rule.ActionsJson, Json) ?? [];
                foreach (var action in actions)
                    await ApplyAsync(ticket, action, ct);
            }
            catch (Exception ex)
            {
                // A malformed rule must never break ticket creation/update.
                logger.LogWarning(ex, "Automation rule {RuleId} failed", rule.Id);
            }
        }
    }

    // ---- Condition evaluation ------------------------------------------------

    private static bool Matches(Ticket ticket, Condition c)
    {
        var actual = c.Field switch
        {
            AutomationField.Priority => ticket.Priority,
            AutomationField.Status => ticket.Status,
            AutomationField.Channel => ticket.Channel,
            AutomationField.Category => ticket.CategoryId?.ToString() ?? "",
            AutomationField.Subject => ticket.Subject,
            _ => null,
        };
        if (actual is null) return false;
        var value = c.Value ?? "";
        return c.Op switch
        {
            AutomationOp.Eq => string.Equals(actual, value, StringComparison.OrdinalIgnoreCase),
            AutomationOp.NotEq => !string.Equals(actual, value, StringComparison.OrdinalIgnoreCase),
            AutomationOp.Contains => actual.Contains(value, StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    // ---- Action application --------------------------------------------------

    private async Task ApplyAsync(Ticket ticket, ActionDef action, CancellationToken ct)
    {
        var value = action.Value ?? "";
        switch (action.Type)
        {
            case AutomationActionType.SetPriority when TicketPriority.All.Contains(value):
                ticket.Priority = value;
                break;

            case AutomationActionType.SetStatus when TicketStatus.All.Contains(value):
                ticket.Status = value;
                break;

            case AutomationActionType.AssignTeam when Guid.TryParse(value, out var teamId):
                if (await db.Teams.AnyAsync(t => t.Id == teamId && t.WorkspaceId == ticket.WorkspaceId, ct))
                {
                    ticket.TeamId = teamId;
                    var assignee = await RoundRobinAsync(ticket.WorkspaceId, teamId, ct);
                    if (assignee is not null)
                    {
                        ticket.AssigneeId = assignee;
                        db.TicketAssignments.Add(new TicketAssignment { TicketId = ticket.Id, AssignedTo = assignee.Value });
                    }
                }
                break;

            case AutomationActionType.AddTag when !string.IsNullOrWhiteSpace(value):
                await AddTagAsync(ticket, value.Trim(), ct);
                break;

            case AutomationActionType.AddNote when !string.IsNullOrWhiteSpace(value):
                db.Comments.Add(new Comment
                {
                    TicketId = ticket.Id,
                    AuthorId = null,           // system-generated
                    Body = value,
                    IsInternal = true,         // never shown to the customer
                    Source = CommentSource.Web,
                });
                break;
        }
    }

    private async Task AddTagAsync(Ticket ticket, string name, CancellationToken ct)
    {
        var tag = await db.Tags
            .SingleOrDefaultAsync(t => t.WorkspaceId == ticket.WorkspaceId && t.Name.ToLower() == name.ToLower(), ct);
        if (tag is null)
        {
            tag = new Tag { WorkspaceId = ticket.WorkspaceId, Name = name };
            db.Tags.Add(tag);   // Id assigned client-side
        }
        var alreadyTagged = await db.TicketTags.AnyAsync(tt => tt.TicketId == ticket.Id && tt.TagId == tag.Id, ct);
        if (!alreadyTagged)
            db.TicketTags.Add(new TicketTag { TicketId = ticket.Id, TagId = tag.Id });
    }

    private Task<Guid?> RoundRobinAsync(Guid workspaceId, Guid teamId, CancellationToken ct)
        => db.Users
            .Where(u => u.WorkspaceId == workspaceId && u.IsActive && u.Role == TracklyRoles.Agent
                        && db.TeamMembers.Any(m => m.TeamId == teamId && m.UserId == u.Id))
            .Select(u => new
            {
                u.Id,
                OpenCount = db.Tickets.Count(t =>
                    t.AssigneeId == u.Id && (t.Status == TicketStatus.Open || t.Status == TicketStatus.Pending)),
            })
            .OrderBy(x => x.OpenCount).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(ct);

    // ---- Admin CRUD ----------------------------------------------------------

    public async Task<IReadOnlyList<AutomationRuleDto>> ListAsync(Actor actor, CancellationToken ct)
    {
        var rules = await db.AutomationRules
            .Where(r => r.WorkspaceId == actor.WorkspaceId)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.CreatedAt)
            .ToListAsync(ct);
        return rules.Select(ToDto).ToList();
    }

    public async Task<AutomationRuleDto> CreateAsync(Actor actor, SaveAutomationRuleRequest req, CancellationToken ct)
    {
        Validate(req);
        var rule = new AutomationRule
        {
            WorkspaceId = actor.WorkspaceId,
            Name = req.Name.Trim(),
            Trigger = req.Trigger,
            ConditionsJson = JsonSerializer.Serialize(req.Conditions ?? []),
            ActionsJson = JsonSerializer.Serialize(req.Actions ?? []),
            Enabled = req.Enabled,
            SortOrder = req.SortOrder,
        };
        db.AutomationRules.Add(rule);
        await db.SaveChangesAsync(ct);
        return ToDto(rule);
    }

    public async Task<AutomationRuleDto?> UpdateAsync(Actor actor, Guid id, SaveAutomationRuleRequest req, CancellationToken ct)
    {
        Validate(req);
        var rule = await db.AutomationRules.SingleOrDefaultAsync(r => r.Id == id && r.WorkspaceId == actor.WorkspaceId, ct);
        if (rule is null) return null;
        rule.Name = req.Name.Trim();
        rule.Trigger = req.Trigger;
        rule.ConditionsJson = JsonSerializer.Serialize(req.Conditions ?? []);
        rule.ActionsJson = JsonSerializer.Serialize(req.Actions ?? []);
        rule.Enabled = req.Enabled;
        rule.SortOrder = req.SortOrder;
        rule.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ToDto(rule);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var deleted = await db.AutomationRules
            .Where(r => r.Id == id && r.WorkspaceId == actor.WorkspaceId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0;
    }

    private static void Validate(SaveAutomationRuleRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            throw new ArgumentException("Rule name is required.");
        if (!AutomationTrigger.All.Contains(req.Trigger))
            throw new ArgumentException("Invalid trigger.");
        foreach (var c in req.Conditions ?? [])
        {
            if (!AutomationField.All.Contains(c.Field)) throw new ArgumentException($"Invalid condition field: {c.Field}.");
            if (!AutomationOp.All.Contains(c.Op)) throw new ArgumentException($"Invalid operator: {c.Op}.");
        }
        foreach (var a in req.Actions ?? [])
            if (!AutomationActionType.All.Contains(a.Type)) throw new ArgumentException($"Invalid action: {a.Type}.");
    }

    private static AutomationRuleDto ToDto(AutomationRule r) => new(
        r.Id, r.Name, r.Trigger,
        JsonSerializer.Deserialize<List<Condition>>(r.ConditionsJson, Json) ?? [],
        JsonSerializer.Deserialize<List<ActionDef>>(r.ActionsJson, Json) ?? [],
        r.Enabled, r.SortOrder);
}

public record Condition(string Field, string Op, string? Value);
public record ActionDef(string Type, string? Value);
public record AutomationRuleDto(
    Guid Id, string Name, string Trigger,
    List<Condition> Conditions, List<ActionDef> Actions, bool Enabled, int SortOrder);
public record SaveAutomationRuleRequest(
    string Name, string Trigger, List<Condition>? Conditions, List<ActionDef>? Actions, bool Enabled, int SortOrder);
