using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Email;
using Trackly.Modules.Tickets;

namespace Trackly.Modules.Releases;

/// <summary>
/// Release plans — the thing a wiki page per deployment was doing badly.
///
/// Agent/admin only (the controller policy enforces that); every query here is
/// still workspace-scoped, per invariant 1.
///
/// Two rules run through everything below and are worth reading before the code:
///
/// <list type="number">
/// <item>
/// <b>The plan gates the deployment, not the paperwork.</b> A release may only
/// become <c>ready</c> or <c>in_progress</c> when it has components, a rollback
/// plan, and every work item tested. That is the whole reason the test state
/// lives on the work item instead of in somebody's head.
/// </item>
/// <item>
/// <b>Accountability, not obstruction.</b> Where a rule would block real work at
/// midnight — ticking a step out of order — the API asks once and then records
/// what happened, rather than refusing. A rule that cannot be overridden is a
/// rule that gets worked around outside the tool, where nothing is recorded.
/// </item>
/// </list>
/// </summary>
public class ReleaseService(
    TracklyDbContext db,
    TicketStatusService statuses,
    ActivityLog activity,
    NotificationService notifications)
{
    private IQueryable<Release> Visible(Actor actor) =>
        db.Releases.Where(r => r.WorkspaceId == actor.WorkspaceId);

    // ── Reading ──────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<ReleaseSummaryDto>> ListAsync(Actor actor, string? status, CancellationToken ct)
    {
        var query = Visible(actor);
        if (!string.IsNullOrWhiteSpace(status))
        {
            // "open" is the default board: everything that has not finished yet.
            query = status == "open"
                ? query.Where(r => r.Status == ReleaseStatus.Planning
                    || r.Status == ReleaseStatus.Ready
                    || r.Status == ReleaseStatus.InProgress)
                : query.Where(r => r.Status == status);
        }

        return await query
            // Scheduled first and soonest-first, because the question this list
            // answers is "what is going out next" — not "what changed last".
            // Unscheduled releases are still being written, so they sort after.
            .OrderBy(r => r.ScheduledAt == null)
            .ThenBy(r => r.ScheduledAt)
            .ThenByDescending(r => r.CreatedAt)
            .Select(r => new ReleaseSummaryDto(
                r.Id, r.Version, r.Title, r.Status, r.ScheduledAt,
                UserSummaryDto.From(r.ReleaseManager),
                r.Components.Count,
                r.Components.Count(c => c.Status == ReleaseComponentStatus.Done
                    || c.Status == ReleaseComponentStatus.Skipped),
                r.Components.SelectMany(c => c.Steps).Count(),
                r.Components.SelectMany(c => c.Steps).Count(s => s.Status == ReleaseStepStatus.Done
                    || s.Status == ReleaseStepStatus.Skipped),
                r.WorkItems.Count,
                r.WorkItems.Count(w => w.TestStatus == ReleaseTestStatus.Passed
                    || w.TestStatus == ReleaseTestStatus.Skipped),
                r.ReleasedAt, r.CreatedAt, r.UpdatedAt))
            .ToListAsync(ct);
    }

    public async Task<ReleaseDetailDto?> GetAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var release = await Visible(actor)
            .Include(r => r.ReleaseManager)
            .Include(r => r.CreatedByUser)
            .SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return null;

        var template = await db.Workspaces
            .Where(w => w.Id == actor.WorkspaceId)
            .Select(w => w.WorkItemUrlTemplate)
            .FirstOrDefaultAsync(ct);

        var components = await db.ReleaseComponents
            .Where(c => c.ReleaseId == id)
            .OrderBy(c => c.Sequence).ThenBy(c => c.Name)
            .Select(c => new
            {
                c.Id, c.ServiceId, c.Name, c.BuildVersion, c.PipelineUrl,
                Owner = UserSummaryDto.From(c.Owner),
                c.Sequence, c.Status, c.StartedAt, c.CompletedAt,
                CompletedBy = UserSummaryDto.From(c.CompletedByUser),
                c.Notes,
                Steps = c.Steps.OrderBy(s => s.Sequence).Select(s => new ReleaseStepDto(
                    s.Id, s.Kind, s.Title, s.Body, s.TargetEnv, s.Url, s.Sequence, s.Status,
                    UserSummaryDto.From(s.DoneByUser), s.DoneAt, s.Result)).ToList(),
            })
            .ToListAsync(ct);

        // Projected into the DTO with a placeholder Url, then rewritten below —
        // the template lives in memory, not in the query, so resolving the link
        // cannot be translated into SQL.
        var items = await db.ReleaseWorkItems
            .Where(w => w.ReleaseId == id)
            .OrderBy(w => w.Sequence).ThenBy(w => w.Title)
            .Select(w => new ReleaseWorkItemDto(
                w.Id, w.ComponentId, w.ExternalKey, w.ExternalUrl,
                w.TicketId, w.Ticket != null ? w.Ticket.Subject : null, w.Title,
                w.TestStatus, UserSummaryDto.From(w.TestedByUser), w.TestedAt, w.TestNotes,
                w.VerifyStatus, UserSummaryDto.From(w.VerifiedByUser), w.VerifiedAt,
                w.Sequence))
            .ToListAsync(ct);

        items = items
            .Select(w => w with { Url = ResolveWorkItemUrl(w.Url, w.ExternalKey, template) })
            .ToList();

        var componentDtos = components.Select(c => new ReleaseComponentDto(
            c.Id, c.ServiceId, c.Name, c.BuildVersion, c.PipelineUrl, c.Owner, c.Sequence,
            c.Status, c.StartedAt, c.CompletedAt, c.CompletedBy, c.Notes, c.Steps,
            items.Where(w => w.ComponentId == c.Id).ToList())).ToList();

        var log = await db.ReleaseActivities
            .Where(a => a.ReleaseId == id)
            .OrderByDescending(a => a.CreatedAt)
            .Take(60)
            .Select(a => new ReleaseActivityDto(
                a.Id, UserSummaryDto.From(a.Actor), a.Action, a.Detail, a.CreatedAt))
            .ToListAsync(ct);

        var openTickets = await OpenLinkedTickets(id).CountAsync(ct);

        return new ReleaseDetailDto(
            release.Id, release.Version, release.Title, release.Status, release.ScheduledAt,
            UserSummaryDto.From(release.ReleaseManager),
            release.Notes, release.RollbackPlan, release.StartedAt, release.ReleasedAt,
            UserSummaryDto.From(release.CreatedByUser),
            componentDtos,
            items.Where(w => w.ComponentId == null).ToList(),
            log,
            Readiness(release, componentDtos.Count, items.Select(w => w.TestStatus)),
            openTickets,
            release.CreatedAt, release.UpdatedAt);
    }

    /// <summary>
    /// The link for a task number. Explicit URL wins; otherwise the workspace
    /// template, which exists so nobody has to paste a URL to make a task
    /// clickable — and an unclickable task number cannot be tested by anyone who
    /// did not write it.
    /// </summary>
    private static string? ResolveWorkItemUrl(string? explicitUrl, string? key, string? template)
    {
        if (!string.IsNullOrWhiteSpace(explicitUrl)) return explicitUrl;
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(template)) return null;
        return template.Replace("{id}", Uri.EscapeDataString(key.Trim()), StringComparison.Ordinal);
    }

    /// <summary>
    /// What still stands between this release and being shippable.
    ///
    /// Returned on every read rather than only when the button is pressed, so the
    /// plan itself shows what is missing while it is being written — which is the
    /// only time anybody can cheaply fix it.
    /// </summary>
    private static ReleaseReadinessDto Readiness(Release release, int componentCount, IEnumerable<string> testStatuses)
    {
        var blockers = new List<ReleaseBlockerDto>();
        if (componentCount == 0) blockers.Add(new ReleaseBlockerDto(ReleaseBlocker.NoComponents, 0));
        if (string.IsNullOrWhiteSpace(release.RollbackPlan))
            blockers.Add(new ReleaseBlockerDto(ReleaseBlocker.NoRollbackPlan, 0));

        var statuses = testStatuses.ToList();
        var failed = statuses.Count(s => s is ReleaseTestStatus.Failed or ReleaseTestStatus.Blocked);
        var untested = statuses.Count(s => s == ReleaseTestStatus.NotTested);
        if (failed > 0) blockers.Add(new ReleaseBlockerDto(ReleaseBlocker.FailedItems, failed));
        if (untested > 0) blockers.Add(new ReleaseBlockerDto(ReleaseBlocker.UntestedItems, untested));

        return new ReleaseReadinessDto(blockers.Count == 0, blockers);
    }

    // ── The release itself ───────────────────────────────────────────────────

    public async Task<ReleaseDetailDto> CreateAsync(Actor actor, CreateReleaseRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Version))
            throw new ArgumentException("A version is required.");

        var release = new Release
        {
            WorkspaceId = actor.WorkspaceId,
            Version = req.Version.Trim(),
            Title = Clean(req.Title),
            ScheduledAt = req.ScheduledAt,
            ReleaseManagerId = await ValidateAgentAsync(actor, req.ReleaseManagerId, ct),
            Notes = Clean(req.Notes),
            RollbackPlan = Clean(req.RollbackPlan),
            CreatedBy = actor.UserId,
        };
        db.Releases.Add(release);
        Log(release.Id, actor, ReleaseAction.Created, release.Version);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(actor, release.Id, ct))!;
    }

    public async Task<ReleaseDetailDto?> UpdateAsync(Actor actor, Guid id, UpdateReleaseRequest req, CancellationToken ct)
    {
        var release = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return null;
        RequireOpen(release);

        if (!string.IsNullOrWhiteSpace(req.Version)) release.Version = req.Version.Trim();
        if (req.Title is not null) release.Title = Clean(req.Title);
        if (req.Notes is not null) release.Notes = Clean(req.Notes);
        if (req.RollbackPlan is not null) release.RollbackPlan = Clean(req.RollbackPlan);
        if (req.ClearSchedule) release.ScheduledAt = null;
        else if (req.ScheduledAt.HasValue) release.ScheduledAt = req.ScheduledAt;

        if (req.ClearManager) release.ReleaseManagerId = null;
        else if (req.ReleaseManagerId.HasValue)
            release.ReleaseManagerId = await ValidateAgentAsync(actor, req.ReleaseManagerId, ct);

        Touch(release);
        Log(release.Id, actor, ReleaseAction.Updated, release.Version);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, id, ct);
    }

    /// <summary>
    /// Moves the release along its lifecycle, and is where the gate lives.
    ///
    /// The transitions are deliberately linear. Going to <c>ready</c> or straight
    /// to <c>in_progress</c> both run the readiness check — the gate belongs to
    /// *starting the deployment*, not to the label, so skipping the label cannot
    /// skip the check.
    /// </summary>
    public async Task<ReleaseDetailDto?> SetStatusAsync(
        Actor actor, Guid id, string status, bool resolveTickets, CancellationToken ct)
    {
        if (!ReleaseStatus.IsKnown(status)) throw new ArgumentException("Unknown release status.");

        var release = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return null;
        if (release.Status == status) return await GetAsync(actor, id, ct);

        if (!CanTransition(release.Status, status))
            throw new ArgumentException($"A release cannot go from {release.Status} to {status}.");

        if (status is ReleaseStatus.Ready or ReleaseStatus.InProgress)
            await RequireReadyAsync(release, ct);

        var from = release.Status;
        release.Status = status;
        if (status == ReleaseStatus.InProgress) release.StartedAt ??= DateTime.UtcNow;
        if (status == ReleaseStatus.Released) release.ReleasedAt ??= DateTime.UtcNow;
        Touch(release);
        Log(release.Id, actor, ReleaseAction.StatusChanged, $"{from} → {status}");
        await db.SaveChangesAsync(ct);

        if (status == ReleaseStatus.Released && resolveTickets)
            await ResolveLinkedTicketsAsync(actor, release, ct);

        return await GetAsync(actor, id, ct);
    }

    /// <summary>Linked Trackly tickets that have not finished yet.</summary>
    private IQueryable<Ticket> OpenLinkedTickets(Guid releaseId) =>
        db.ReleaseWorkItems
            .Where(w => w.ReleaseId == releaseId && w.TicketId != null)
            .Select(w => w.Ticket!)
            .Distinct()
            .Where(t => t.StatusCategory != TicketStatusCategory.Resolved
                        && t.StatusCategory != TicketStatusCategory.Closed);

    /// <summary>
    /// Closes the loop the wiki never could: the fix shipped, so the people who
    /// reported it get told, in one action instead of an agent remembering to
    /// walk the list.
    ///
    /// Opt-in, never automatic. Shipping a fix and telling a customer are two
    /// decisions, and the second one reaches people outside the workspace — the
    /// kind of thing that has to be asked for rather than assumed.
    ///
    /// Mirrors <c>ProblemService.ResolveAsync</c> deliberately, including
    /// bypassing the status workflow: a release landing is a decision about all
    /// of its tickets at once, and a transition rule that blocked one of them
    /// would leave the release shipped with a ticket still open under it.
    /// </summary>
    private async Task ResolveLinkedTicketsAsync(Actor actor, Release release, CancellationToken ct)
    {
        var resolved = await statuses.DefaultForCategoryAsync(
            actor.WorkspaceId, TicketStatusCategory.Resolved, ct);

        // The status each ticket is leaving, kept beside its id: the bulk update
        // overwrites it and the activity log has to say what it was.
        var affected = await OpenLinkedTickets(release.Id)
            .Select(t => new { t.Id, t.Status })
            .ToListAsync(ct);
        if (affected.Count == 0) return;

        var ticketIds = affected.Select(t => t.Id).ToList();

        await db.Tickets
            .Where(t => ticketIds.Contains(t.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, resolved.Value)
                .SetProperty(t => t.StatusCategory, resolved.Category)
                .SetProperty(t => t.ResolvedAt, DateTime.UtcNow)
                .SetProperty(t => t.UpdatedAt, DateTime.UtcNow), ct);

        // Names resolved once outside the loop; a release can carry hundreds.
        var names = await db.TicketStatuses
            .Where(s => s.WorkspaceId == actor.WorkspaceId)
            .ToDictionaryAsync(s => s.Value, s => s.Name, ct);

        // Two entries per ticket, matching a hand-made resolve: the status move,
        // and the "resolved" event a manager scans for. Without them a queue of
        // tickets goes quiet with nothing on any of them saying why — and here
        // the why is unusually worth having, because it names the release.
        var reason = string.IsNullOrWhiteSpace(release.Title)
            ? release.Version
            : $"{release.Version} — {release.Title}";

        foreach (var ticket in affected)
        {
            activity.Changed(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Status,
                names.GetValueOrDefault(ticket.Status, ticket.Status), resolved.Name);
            activity.Happened(actor.WorkspaceId, ticket.Id, actor.UserId,
                TicketActivityType.Resolved, reason);
        }

        Log(release.Id, actor, ReleaseAction.TicketsResolved, affected.Count.ToString());
        await db.SaveChangesAsync(ct);

        foreach (var ticketId in ticketIds)
            await notifications.OnStatusChangedAsync(ticketId, resolved.Name, ct);
    }

    /// <summary>
    /// Linear on purpose. <c>ready → planning</c> is the one step backwards
    /// allowed: noticing something is missing while the plan is still on the
    /// ground is exactly what the state is there to catch.
    /// </summary>
    private static bool CanTransition(string from, string to) => (from, to) switch
    {
        (ReleaseStatus.Planning, ReleaseStatus.Ready) => true,
        (ReleaseStatus.Planning, ReleaseStatus.InProgress) => true,
        (ReleaseStatus.Planning, ReleaseStatus.Cancelled) => true,
        (ReleaseStatus.Ready, ReleaseStatus.InProgress) => true,
        (ReleaseStatus.Ready, ReleaseStatus.Planning) => true,
        (ReleaseStatus.Ready, ReleaseStatus.Cancelled) => true,
        (ReleaseStatus.InProgress, ReleaseStatus.Released) => true,
        (ReleaseStatus.InProgress, ReleaseStatus.RolledBack) => true,
        // A release can go bad hours after it went out, and the record has to be
        // able to say so — otherwise the only honest option is editing history.
        (ReleaseStatus.Released, ReleaseStatus.RolledBack) => true,
        _ => false,
    };

    private async Task RequireReadyAsync(Release release, CancellationToken ct)
    {
        var componentCount = await db.ReleaseComponents.CountAsync(c => c.ReleaseId == release.Id, ct);
        var statuses = await db.ReleaseWorkItems
            .Where(w => w.ReleaseId == release.Id)
            .Select(w => w.TestStatus)
            .ToListAsync(ct);

        var readiness = Readiness(release, componentCount, statuses);
        if (!readiness.CanMarkReady)
            throw new ArgumentException(
                "This release is not ready: " + string.Join(", ", readiness.Blockers.Select(b => b.Code)));
    }

    /// <summary>
    /// Deleting is for plans that never happened. Anything that shipped is a
    /// record of a night, and the point of keeping it is that next time somebody
    /// can read what was actually done.
    /// </summary>
    public async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();

        var release = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return false;
        if (release.Status is not (ReleaseStatus.Planning or ReleaseStatus.Cancelled))
            throw new ArgumentException("Only a release that has not shipped can be deleted. Cancel it instead.");

        db.Releases.Remove(release);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Starts the next release from this one.
    ///
    /// Copies the SHAPE and never the RECORD: components and their repeatable
    /// steps carry over, ticks and timestamps do not. Work items do not either —
    /// they are the one thing that is different every single time.
    ///
    /// <c>db_script</c> and <c>env_change</c> steps are deliberately dropped.
    /// Last release's migration is not this release's migration, and a copied
    /// script sitting in a plan with somebody else's SQL in it is worse than an
    /// empty plan — it is a plan that looks filled in.
    /// </summary>
    public async Task<ReleaseDetailDto?> CloneAsync(Actor actor, Guid id, CloneReleaseRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Version))
            throw new ArgumentException("A version is required.");

        var source = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (source is null) return null;

        var clone = new Release
        {
            WorkspaceId = actor.WorkspaceId,
            Version = req.Version.Trim(),
            Title = Clean(req.Title),
            ScheduledAt = req.ScheduledAt,
            ReleaseManagerId = source.ReleaseManagerId,
            // Rollback plans are usually the same shape twice, and starting from
            // the last one beats starting from an empty box that stays empty.
            RollbackPlan = source.RollbackPlan,
            CreatedBy = actor.UserId,
        };
        db.Releases.Add(clone);

        var components = await db.ReleaseComponents
            .Where(c => c.ReleaseId == id)
            .Include(c => c.Steps)
            .OrderBy(c => c.Sequence)
            .ToListAsync(ct);

        foreach (var previous in components)
        {
            var component = new ReleaseComponent
            {
                ReleaseId = clone.Id,
                ServiceId = previous.ServiceId,
                Name = previous.Name,
                PipelineUrl = previous.PipelineUrl,
                OwnerId = previous.OwnerId,
                Sequence = previous.Sequence,
                // BuildVersion is intentionally not copied: shipping last
                // release's build is the mistake this whole feature exists to stop.
            };
            db.ReleaseComponents.Add(component);

            foreach (var step in previous.Steps
                .Where(s => s.Kind is ReleaseStepKind.Pipeline or ReleaseStepKind.Manual or ReleaseStepKind.Verify)
                .OrderBy(s => s.Sequence))
            {
                db.ReleaseSteps.Add(new ReleaseStep
                {
                    ComponentId = component.Id,
                    Kind = step.Kind,
                    Title = step.Title,
                    Body = step.Body,
                    TargetEnv = step.TargetEnv,
                    Url = step.Url,
                    Sequence = step.Sequence,
                });
            }
        }

        Log(clone.Id, actor, ReleaseAction.Created, $"{clone.Version} ← {source.Version}");
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, clone.Id, ct);
    }

    // ── Components ───────────────────────────────────────────────────────────

    public async Task<ReleaseDetailDto?> AddComponentAsync(Actor actor, Guid id, AddComponentRequest req, CancellationToken ct)
    {
        var release = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return null;
        RequireOpen(release);

        var name = Clean(req.Name);
        string? pipelineUrl = Clean(req.PipelineUrl);
        Guid? serviceId = null;

        if (req.ServiceId.HasValue)
        {
            var service = await db.BusinessServices
                .Where(s => s.WorkspaceId == actor.WorkspaceId && s.Id == req.ServiceId)
                .Select(s => new { s.Id, s.Name, s.PipelineUrl })
                .SingleOrDefaultAsync(ct)
                ?? throw new ArgumentException("That service is not in this workspace.");

            serviceId = service.Id;
            // Snapshotted, not read through — see ReleaseComponent.Name.
            name ??= service.Name;
            pipelineUrl ??= service.PipelineUrl;
        }

        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Pick a service, or type a name.");

        var next = await db.ReleaseComponents.Where(c => c.ReleaseId == id)
            .Select(c => (int?)c.Sequence).MaxAsync(ct) ?? 0;

        var component = new ReleaseComponent
        {
            ReleaseId = id,
            ServiceId = serviceId,
            Name = name,
            BuildVersion = Clean(req.BuildVersion),
            PipelineUrl = pipelineUrl,
            OwnerId = await ValidateAgentAsync(actor, req.OwnerId, ct),
            Sequence = next + 1,
        };
        db.ReleaseComponents.Add(component);
        Touch(release);
        Log(id, actor, ReleaseAction.ComponentAdded, component.Name);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, id, ct);
    }

    public async Task<ReleaseDetailDto?> UpdateComponentAsync(
        Actor actor, Guid componentId, UpdateComponentRequest req, CancellationToken ct)
    {
        var component = await LoadComponentAsync(actor, componentId, ct);
        if (component is null) return null;
        RequireOpen(component.Release);

        if (!string.IsNullOrWhiteSpace(req.Name)) component.Name = req.Name.Trim();
        if (req.BuildVersion is not null) component.BuildVersion = Clean(req.BuildVersion);
        if (req.PipelineUrl is not null) component.PipelineUrl = Clean(req.PipelineUrl);
        if (req.Notes is not null) component.Notes = Clean(req.Notes);
        if (req.Sequence.HasValue) component.Sequence = req.Sequence.Value;
        if (req.ClearOwner) component.OwnerId = null;
        else if (req.OwnerId.HasValue) component.OwnerId = await ValidateAgentAsync(actor, req.OwnerId, ct);

        Touch(component.Release);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, component.ReleaseId, ct);
    }

    public async Task<ReleaseDetailDto?> SetComponentStatusAsync(
        Actor actor, Guid componentId, SetComponentStatusRequest req, CancellationToken ct)
    {
        if (!ReleaseComponentStatus.IsKnown(req.Status)) throw new ArgumentException("Unknown component status.");

        var component = await LoadComponentAsync(actor, componentId, ct);
        if (component is null) return null;
        RequireRunning(component.Release, actor);

        component.Status = req.Status;
        if (req.Notes is not null) component.Notes = Clean(req.Notes);
        if (req.Status == ReleaseComponentStatus.InProgress) component.StartedAt ??= DateTime.UtcNow;
        if (ReleaseComponentStatus.IsSettled(req.Status) || req.Status == ReleaseComponentStatus.Failed)
        {
            component.CompletedAt = DateTime.UtcNow;
            component.CompletedBy = actor.UserId;
        }

        Touch(component.Release);
        Log(component.ReleaseId, actor, ReleaseAction.ComponentStatus, $"{component.Name} → {req.Status}");
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, component.ReleaseId, ct);
    }

    public async Task<ReleaseDetailDto?> RemoveComponentAsync(Actor actor, Guid componentId, CancellationToken ct)
    {
        var component = await LoadComponentAsync(actor, componentId, ct);
        if (component is null) return null;
        RequireOpen(component.Release);

        var releaseId = component.ReleaseId;
        db.ReleaseComponents.Remove(component);
        Touch(component.Release);
        Log(releaseId, actor, ReleaseAction.ComponentRemoved, component.Name);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, releaseId, ct);
    }

    // ── Steps ────────────────────────────────────────────────────────────────

    public async Task<ReleaseDetailDto?> AddStepAsync(Actor actor, Guid componentId, AddStepRequest req, CancellationToken ct)
    {
        if (!ReleaseStepKind.IsKnown(req.Kind)) throw new ArgumentException("Unknown step kind.");
        if (string.IsNullOrWhiteSpace(req.Title)) throw new ArgumentException("A step needs a title.");

        var component = await LoadComponentAsync(actor, componentId, ct);
        if (component is null) return null;
        RequireOpen(component.Release);

        var next = await db.ReleaseSteps.Where(s => s.ComponentId == componentId)
            .Select(s => (int?)s.Sequence).MaxAsync(ct) ?? 0;

        db.ReleaseSteps.Add(new ReleaseStep
        {
            ComponentId = componentId,
            Kind = req.Kind,
            Title = req.Title.Trim(),
            Body = Clean(req.Body),
            TargetEnv = Clean(req.TargetEnv),
            Url = Clean(req.Url),
            Sequence = next + 1,
        });

        Touch(component.Release);
        Log(component.ReleaseId, actor, ReleaseAction.StepAdded, req.Title.Trim());
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, component.ReleaseId, ct);
    }

    public async Task<ReleaseDetailDto?> UpdateStepAsync(Actor actor, Guid stepId, UpdateStepRequest req, CancellationToken ct)
    {
        var step = await LoadStepAsync(actor, stepId, ct);
        if (step is null) return null;
        RequireOpen(step.Component.Release);

        if (!string.IsNullOrWhiteSpace(req.Kind))
        {
            if (!ReleaseStepKind.IsKnown(req.Kind)) throw new ArgumentException("Unknown step kind.");
            step.Kind = req.Kind;
        }
        if (!string.IsNullOrWhiteSpace(req.Title)) step.Title = req.Title.Trim();
        if (req.Body is not null) step.Body = Clean(req.Body);
        if (req.TargetEnv is not null) step.TargetEnv = Clean(req.TargetEnv);
        if (req.Url is not null) step.Url = Clean(req.Url);
        if (req.Sequence.HasValue) step.Sequence = req.Sequence.Value;

        Touch(step.Component.Release);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, step.Component.ReleaseId, ct);
    }

    /// <summary>
    /// Ticking a step — the single most-used call in this whole module, and the
    /// one the wiki could never do, because a line of text cannot hold a name and
    /// a timestamp.
    /// </summary>
    public async Task<ReleaseDetailDto?> SetStepStatusAsync(
        Actor actor, Guid stepId, SetStepStatusRequest req, CancellationToken ct)
    {
        if (!ReleaseStepStatus.IsKnown(req.Status)) throw new ArgumentException("Unknown step status.");

        var step = await LoadStepAsync(actor, stepId, ct);
        if (step is null) return null;
        var release = step.Component.Release;
        RequireRunning(release, actor);

        if (req.Status is ReleaseStepStatus.Done or ReleaseStepStatus.Skipped)
        {
            // "Deploy before the migration" is the expensive one, and a document
            // cannot stop it. Asking once and recording the answer can.
            var earlierPending = await db.ReleaseSteps
                .AnyAsync(s => s.ComponentId == step.ComponentId
                    && s.Sequence < step.Sequence
                    && s.Status == ReleaseStepStatus.Pending, ct);

            if (earlierPending && !req.Force)
                throw new ReleaseConfirmException(
                    ReleaseConfirmException.StepsOutOfOrder,
                    "An earlier step in this component has not been done yet.");

            if (earlierPending)
                Log(release.Id, actor, ReleaseAction.StepOutOfOrder, step.Title);
        }

        step.Status = req.Status;
        if (req.Result is not null) step.Result = Clean(req.Result);
        if (req.Status == ReleaseStepStatus.Pending)
        {
            step.DoneBy = null;
            step.DoneAt = null;
        }
        else
        {
            step.DoneBy = actor.UserId;
            step.DoneAt = DateTime.UtcNow;
        }

        // The component starts itself. Somebody who has just run the first
        // pipeline should not also have to remember to press "start".
        if (step.Component.Status == ReleaseComponentStatus.Pending
            && req.Status is ReleaseStepStatus.Done or ReleaseStepStatus.Failed)
        {
            step.Component.Status = ReleaseComponentStatus.InProgress;
            step.Component.StartedAt ??= DateTime.UtcNow;
        }

        Touch(release);
        Log(release.Id, actor,
            req.Status == ReleaseStepStatus.Failed ? ReleaseAction.StepFailed : ReleaseAction.StepDone,
            step.Title);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, release.Id, ct);
    }

    public async Task<ReleaseDetailDto?> RemoveStepAsync(Actor actor, Guid stepId, CancellationToken ct)
    {
        var step = await LoadStepAsync(actor, stepId, ct);
        if (step is null) return null;
        RequireOpen(step.Component.Release);

        var releaseId = step.Component.ReleaseId;
        db.ReleaseSteps.Remove(step);
        Touch(step.Component.Release);
        Log(releaseId, actor, ReleaseAction.StepRemoved, step.Title);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, releaseId, ct);
    }

    // ── Work items (scope, and the test checklist) ───────────────────────────

    public async Task<ReleaseDetailDto?> AddWorkItemAsync(Actor actor, Guid id, AddWorkItemRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) throw new ArgumentException("A task needs a title.");

        var release = await Visible(actor).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (release is null) return null;
        RequireOpen(release);

        if (req.ComponentId.HasValue
            && !await db.ReleaseComponents.AnyAsync(c => c.Id == req.ComponentId && c.ReleaseId == id, ct))
            throw new ArgumentException("That component is not part of this release.");

        if (req.TicketId.HasValue
            && !await db.Tickets.AnyAsync(t => t.Id == req.TicketId && t.WorkspaceId == actor.WorkspaceId, ct))
            throw new ArgumentException("That ticket is not in this workspace.");

        var next = await db.ReleaseWorkItems.Where(w => w.ReleaseId == id)
            .Select(w => (int?)w.Sequence).MaxAsync(ct) ?? 0;

        db.ReleaseWorkItems.Add(new ReleaseWorkItem
        {
            ReleaseId = id,
            ComponentId = req.ComponentId,
            ExternalKey = Clean(req.ExternalKey),
            ExternalUrl = Clean(req.ExternalUrl),
            TicketId = req.TicketId,
            Title = req.Title.Trim(),
            Sequence = next + 1,
        });

        Touch(release);
        Log(id, actor, ReleaseAction.ItemAdded, Describe(req.ExternalKey, req.Title));
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, id, ct);
    }

    public async Task<ReleaseDetailDto?> UpdateWorkItemAsync(
        Actor actor, Guid itemId, UpdateWorkItemRequest req, CancellationToken ct)
    {
        var item = await LoadWorkItemAsync(actor, itemId, ct);
        if (item is null) return null;
        RequireOpen(item.Release);

        if (!string.IsNullOrWhiteSpace(req.Title)) item.Title = req.Title.Trim();
        if (req.ExternalKey is not null) item.ExternalKey = Clean(req.ExternalKey);
        if (req.ExternalUrl is not null) item.ExternalUrl = Clean(req.ExternalUrl);
        if (req.Sequence.HasValue) item.Sequence = req.Sequence.Value;

        if (req.ClearComponent) item.ComponentId = null;
        else if (req.ComponentId.HasValue)
        {
            if (!await db.ReleaseComponents.AnyAsync(c => c.Id == req.ComponentId && c.ReleaseId == item.ReleaseId, ct))
                throw new ArgumentException("That component is not part of this release.");
            item.ComponentId = req.ComponentId;
        }

        if (req.ClearTicket) item.TicketId = null;
        else if (req.TicketId.HasValue)
        {
            if (!await db.Tickets.AnyAsync(t => t.Id == req.TicketId && t.WorkspaceId == actor.WorkspaceId, ct))
                throw new ArgumentException("That ticket is not in this workspace.");
            item.TicketId = req.TicketId;
        }

        Touch(item.Release);
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, item.ReleaseId, ct);
    }

    /// <summary>
    /// The pre-deploy pass, run on staging. This is the state that gates the
    /// release: it is why the task list is worth linking rather than retyping,
    /// because a tester who cannot open the task cannot test it.
    /// </summary>
    public async Task<ReleaseDetailDto?> SetWorkItemTestAsync(
        Actor actor, Guid itemId, SetWorkItemTestRequest req, CancellationToken ct)
    {
        if (!ReleaseTestStatus.IsKnown(req.Status)) throw new ArgumentException("Unknown test status.");

        var item = await LoadWorkItemAsync(actor, itemId, ct);
        if (item is null) return null;
        if (ReleaseStatus.IsClosed(item.Release.Status))
            throw new ArgumentException("This release is closed.");

        item.TestStatus = req.Status;
        if (req.Notes is not null) item.TestNotes = Clean(req.Notes);
        if (req.Status == ReleaseTestStatus.NotTested)
        {
            item.TestedBy = null;
            item.TestedAt = null;
        }
        else
        {
            item.TestedBy = actor.UserId;
            item.TestedAt = DateTime.UtcNow;
        }

        Touch(item.Release);
        Log(item.ReleaseId, actor, ReleaseAction.ItemTested,
            $"{Describe(item.ExternalKey, item.Title)} → {req.Status}");
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, item.ReleaseId, ct);
    }

    /// <summary>
    /// The post-deploy pass, run on production. Kept separate from the pre-deploy
    /// one because they answer different questions — ship or not, versus roll back
    /// or not — and only one of them is asked while the site is on fire.
    /// </summary>
    public async Task<ReleaseDetailDto?> SetWorkItemVerifyAsync(
        Actor actor, Guid itemId, SetWorkItemVerifyRequest req, CancellationToken ct)
    {
        if (!ReleaseTestStatus.IsKnown(req.Status)) throw new ArgumentException("Unknown verification status.");

        var item = await LoadWorkItemAsync(actor, itemId, ct);
        if (item is null) return null;
        if (item.Release.Status is not (ReleaseStatus.InProgress or ReleaseStatus.Released))
            throw new ArgumentException("Production verification starts once the release is under way.");

        item.VerifyStatus = req.Status;
        if (req.Status == ReleaseTestStatus.NotTested)
        {
            item.VerifiedBy = null;
            item.VerifiedAt = null;
        }
        else
        {
            item.VerifiedBy = actor.UserId;
            item.VerifiedAt = DateTime.UtcNow;
        }

        Touch(item.Release);
        Log(item.ReleaseId, actor, ReleaseAction.ItemVerified,
            $"{Describe(item.ExternalKey, item.Title)} → {req.Status}");
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, item.ReleaseId, ct);
    }

    public async Task<ReleaseDetailDto?> RemoveWorkItemAsync(Actor actor, Guid itemId, CancellationToken ct)
    {
        var item = await LoadWorkItemAsync(actor, itemId, ct);
        if (item is null) return null;
        RequireOpen(item.Release);

        var releaseId = item.ReleaseId;
        db.ReleaseWorkItems.Remove(item);
        Touch(item.Release);
        Log(releaseId, actor, ReleaseAction.ItemRemoved, Describe(item.ExternalKey, item.Title));
        await db.SaveChangesAsync(ct);
        return await GetAsync(actor, releaseId, ct);
    }

    /// <summary>
    /// Which release a ticket is going out in. Read from the ticket side, which
    /// is where the question is actually asked — by an agent about to tell a
    /// customer when their fix lands.
    /// </summary>
    public async Task<IReadOnlyList<ReleaseSummaryDto>> ForTicketAsync(Actor actor, Guid ticketId, CancellationToken ct)
    {
        return await db.ReleaseWorkItems
            .Where(w => w.TicketId == ticketId && w.Release.WorkspaceId == actor.WorkspaceId)
            .Select(w => w.Release)
            .Distinct()
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new ReleaseSummaryDto(
                r.Id, r.Version, r.Title, r.Status, r.ScheduledAt,
                UserSummaryDto.From(r.ReleaseManager),
                r.Components.Count, 0, 0, 0, r.WorkItems.Count, 0,
                r.ReleasedAt, r.CreatedAt, r.UpdatedAt))
            .ToListAsync(ct);
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Kept here rather than on the generic Configuration screen because this is
    /// the only feature that reads it, and a setting filed away from the thing it
    /// affects is a setting nobody finds.
    /// </summary>
    public async Task<ReleaseSettingsDto> GetSettingsAsync(Actor actor, CancellationToken ct)
    {
        var template = await db.Workspaces
            .Where(w => w.Id == actor.WorkspaceId)
            .Select(w => w.WorkItemUrlTemplate)
            .SingleAsync(ct);
        return new ReleaseSettingsDto(template);
    }

    public async Task<ReleaseSettingsDto> SaveSettingsAsync(
        Actor actor, ReleaseSettingsDto req, CancellationToken ct)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();

        var template = Clean(req.WorkItemUrlTemplate);
        if (template is not null && !template.Contains("{id}", StringComparison.Ordinal))
            throw new ArgumentException("The template must contain {id}, which the task number replaces.");

        await db.Workspaces
            .Where(w => w.Id == actor.WorkspaceId)
            .ExecuteUpdateAsync(s => s.SetProperty(w => w.WorkItemUrlTemplate, template), ct);

        return new ReleaseSettingsDto(template);
    }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    private Task<ReleaseComponent?> LoadComponentAsync(Actor actor, Guid componentId, CancellationToken ct) =>
        db.ReleaseComponents
            .Include(c => c.Release)
            .SingleOrDefaultAsync(c => c.Id == componentId && c.Release.WorkspaceId == actor.WorkspaceId, ct);

    private Task<ReleaseStep?> LoadStepAsync(Actor actor, Guid stepId, CancellationToken ct) =>
        db.ReleaseSteps
            .Include(s => s.Component).ThenInclude(c => c.Release)
            .SingleOrDefaultAsync(s => s.Id == stepId && s.Component.Release.WorkspaceId == actor.WorkspaceId, ct);

    private Task<ReleaseWorkItem?> LoadWorkItemAsync(Actor actor, Guid itemId, CancellationToken ct) =>
        db.ReleaseWorkItems
            .Include(w => w.Release)
            .SingleOrDefaultAsync(w => w.Id == itemId && w.Release.WorkspaceId == actor.WorkspaceId, ct);

    /// <summary>A shipped release is a record. Editing its plan afterwards would make it a lie.</summary>
    private static void RequireOpen(Release release)
    {
        if (ReleaseStatus.IsClosed(release.Status))
            throw new ArgumentException("This release is closed and can no longer be edited.");
    }

    /// <summary>
    /// Ticking anything means the deployment is happening. From <c>ready</c> that
    /// is unambiguous, so the first tick starts the release rather than making
    /// somebody remember a button. From <c>planning</c> it is not — the plan has
    /// not passed its own checks yet, and saying so is the point.
    /// </summary>
    private void RequireRunning(Release release, Actor actor)
    {
        if (release.Status == ReleaseStatus.InProgress) return;

        if (release.Status == ReleaseStatus.Ready)
        {
            release.Status = ReleaseStatus.InProgress;
            release.StartedAt ??= DateTime.UtcNow;
            Log(release.Id, actor, ReleaseAction.StatusChanged, $"{ReleaseStatus.Ready} → {ReleaseStatus.InProgress}");
            return;
        }

        throw new ArgumentException(release.Status == ReleaseStatus.Planning
            ? "Start the release before ticking anything off."
            : "This release is closed.");
    }

    private async Task<Guid?> ValidateAgentAsync(Actor actor, Guid? userId, CancellationToken ct)
    {
        if (!userId.HasValue) return null;
        var ok = await db.Users.AnyAsync(u => u.Id == userId
            && u.WorkspaceId == actor.WorkspaceId
            && (u.Role == TracklyRoles.Agent || u.Role == TracklyRoles.Admin), ct);
        if (!ok) throw new ArgumentException("That person is not an agent in this workspace.");
        return userId;
    }

    private void Log(Guid releaseId, Actor actor, string action, string? detail) =>
        db.ReleaseActivities.Add(new ReleaseActivity
        {
            ReleaseId = releaseId,
            ActorId = actor.UserId,
            Action = action,
            Detail = detail,
        });

    private static void Touch(Release release) => release.UpdatedAt = DateTime.UtcNow;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Describe(string? key, string title) =>
        string.IsNullOrWhiteSpace(key) ? title : $"{key} — {title}";
}

/// <summary>
/// Activity verbs. Codes, never sentences — the sentence is assembled in the UI
/// from a translation key, and the detail travelling beside it is user data
/// (a step title, a task number), which is not translated at all.
/// </summary>
public static class ReleaseAction
{
    public const string Created = "created";
    public const string Updated = "updated";
    public const string StatusChanged = "status_changed";
    public const string ComponentAdded = "component_added";
    public const string ComponentRemoved = "component_removed";
    public const string ComponentStatus = "component_status";
    public const string StepAdded = "step_added";
    public const string StepRemoved = "step_removed";
    public const string StepDone = "step_done";
    public const string StepFailed = "step_failed";
    public const string StepOutOfOrder = "step_out_of_order";
    public const string ItemAdded = "item_added";
    public const string ItemRemoved = "item_removed";
    public const string ItemTested = "item_tested";
    public const string ItemVerified = "item_verified";

    /// <summary>Detail carries the count — the log's job is to say how many people were written to.</summary>
    public const string TicketsResolved = "tickets_resolved";
}
