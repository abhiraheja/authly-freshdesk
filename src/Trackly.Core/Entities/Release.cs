namespace Trackly.Core.Entities;

/// <summary>
/// One deployment to production, planned in advance and then executed.
///
/// This exists because the thing it replaces — a wiki page per release — is a
/// document, and a release is a procedure. A document has one state (written);
/// a procedure has a state per line, an owner per line and a timestamp per line,
/// and four people read it at the same time while it runs. Every design choice
/// below follows from that one difference.
///
/// It is deliberately NOT a ticket. A ticket is a request somebody made; a
/// release is work the workspace scheduled, and forcing it through the ticket
/// lifecycle would put it in queues, SLA clocks and customer-facing counts where
/// it does not belong.
/// </summary>
public class Release
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    /// <summary>Free text — "2.14.0", "2026-08-14", "Sprint 42". Whatever the team already says out loud.</summary>
    public string Version { get; set; } = null!;

    public string? Title { get; set; }

    /// <summary>One of <see cref="ReleaseStatus"/>.</summary>
    public string Status { get; set; } = ReleaseStatus.Planning;

    /// <summary>
    /// When it is meant to go out. Tentative by name and by nature — the plan is
    /// written days before anyone knows if it will hold, and pretending otherwise
    /// just means nobody fills it in.
    /// </summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>Who is driving it on the day. Not necessarily who wrote the plan.</summary>
    public Guid? ReleaseManagerId { get; set; }
    public User? ReleaseManager { get; set; }

    /// <summary>Everything the structured rows do not cover. The "aur bhi agar koi change hai" box.</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// How to undo it. Required before the release may leave
    /// <see cref="ReleaseStatus.Planning"/> — it is the field every team skips
    /// and the only one that matters on the night it goes wrong.
    /// </summary>
    public string? RollbackPlan { get; set; }

    public DateTime? StartedAt { get; set; }
    public DateTime? ReleasedAt { get; set; }

    public Guid CreatedBy { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ReleaseComponent> Components { get; set; } = new List<ReleaseComponent>();
    public ICollection<ReleaseWorkItem> WorkItems { get; set; } = new List<ReleaseWorkItem>();
}

/// <summary>
/// Deliberately linear, and deliberately without an approval gate.
///
/// <c>ready</c> is not a signature — it is a claim that the plan is complete and
/// tested, and the API only lets you make it when that is actually true (see
/// <c>ReleaseService.SetStatusAsync</c>). A CAB-style approval step would be the
/// obvious next thing to add and is the wrong thing to add first: the failures
/// this feature exists to stop are all "nobody knew", none are "nobody approved".
/// </summary>
public static class ReleaseStatus
{
    /// <summary>Being written. Everything is editable.</summary>
    public const string Planning = "planning";

    /// <summary>Plan complete, every work item tested. Nothing has shipped yet.</summary>
    public const string Ready = "ready";

    /// <summary>Deployment under way. This is the state the live checklist is for.</summary>
    public const string InProgress = "in_progress";

    /// <summary>Out, and verified.</summary>
    public const string Released = "released";

    /// <summary>Went out and came back. Kept distinct from cancelled — one is a scar, the other is a decision.</summary>
    public const string RolledBack = "rolled_back";

    /// <summary>Never shipped. Dropped before deployment started.</summary>
    public const string Cancelled = "cancelled";

    public static readonly string[] All = [Planning, Ready, InProgress, Released, RolledBack, Cancelled];
    public static bool IsKnown(string status) => All.Contains(status);

    /// <summary>Closed states are read-only: a shipped release is a record, not a draft.</summary>
    public static bool IsClosed(string status) => status is Released or RolledBack or Cancelled;
}

/// <summary>
/// One deployable thing inside a release — an API, a worker, a frontend.
///
/// Named <c>ReleaseComponent</c> and not <c>ReleaseService</c> for the same
/// reason <see cref="BusinessService"/> is not <c>Service</c>: this codebase is
/// full of <c>*Service</c> classes and a domain entity wearing that suffix gets
/// misread on every import line for the life of the project.
/// </summary>
public class ReleaseComponent
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ReleaseId { get; set; }
    public Release Release { get; set; } = null!;

    /// <summary>
    /// Points at the workspace's existing service catalogue rather than inventing
    /// a second list of service names. The catalogue already knows who owns each
    /// one, and the status board and the release then talk about the same
    /// "AuthV3" instead of two strings that only look alike.
    /// </summary>
    public Guid? ServiceId { get; set; }
    public BusinessService? Service { get; set; }

    /// <summary>
    /// Snapshotted at the moment it was added, and never refreshed from the
    /// catalogue. A release is a record of what actually shipped; if somebody
    /// renames or retires the service next year, last year's release must still
    /// say what it said on the night. Also the reason <see cref="ServiceId"/> is
    /// nullable — a component may name something that was never in the catalogue.
    /// </summary>
    public string Name { get; set; } = null!;

    /// <summary>Which build/tag/commit actually goes out. Blank while unknown.</summary>
    public string? BuildVersion { get; set; }

    /// <summary>
    /// The pipeline that deploys it, copied in from the catalogue when the
    /// component is added — copied, not read through, for the same reason
    /// <see cref="Name"/> is. Individual steps may carry their own.
    /// </summary>
    public string? PipelineUrl { get; set; }

    /// <summary>Who runs it. Optional — a release with one operator does not need this filled in six times.</summary>
    public Guid? OwnerId { get; set; }
    public User? Owner { get; set; }

    /// <summary>
    /// Order is data, not layout. "Deploy before the migration" is the most
    /// expensive mistake on the list and the one a document cannot prevent,
    /// so the sequence is stored and the API enforces it.
    /// </summary>
    public int Sequence { get; set; }

    /// <summary>One of <see cref="ReleaseComponentStatus"/>.</summary>
    public string Status { get; set; } = ReleaseComponentStatus.Pending;

    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid? CompletedBy { get; set; }
    public User? CompletedByUser { get; set; }

    public string? Notes { get; set; }

    public ICollection<ReleaseStep> Steps { get; set; } = new List<ReleaseStep>();
    public ICollection<ReleaseWorkItem> WorkItems { get; set; } = new List<ReleaseWorkItem>();
}

public static class ReleaseComponentStatus
{
    public const string Pending = "pending";
    public const string InProgress = "in_progress";
    public const string Done = "done";

    /// <summary>Tried and did not work. Distinct from <see cref="Skipped"/>, which was a choice.</summary>
    public const string Failed = "failed";
    public const string Skipped = "skipped";

    public static readonly string[] All = [Pending, InProgress, Done, Failed, Skipped];
    public static bool IsKnown(string status) => All.Contains(status);
    public static bool IsSettled(string status) => status is Done or Skipped;
}

/// <summary>
/// A single line of the runbook: run this pipeline, run this SQL, set this
/// variable, restart that, check this page.
///
/// This row is the whole reason the feature is not a wiki page. It carries a
/// tick, a name and a timestamp, which is the difference between "did anyone run
/// the migration on prod?" being answerable and being the question somebody asks
/// at 2am while four people guess.
/// </summary>
public class ReleaseStep
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ComponentId { get; set; }
    public ReleaseComponent Component { get; set; } = null!;

    /// <summary>One of <see cref="ReleaseStepKind"/>. Drives the icon and, for env changes, the redaction rule.</summary>
    public string Kind { get; set; } = ReleaseStepKind.Manual;

    public string Title { get; set; } = null!;

    /// <summary>
    /// The SQL, the command, the instruction. Stored verbatim — a script is not
    /// a secret, and the whole value of writing it down is that the person
    /// running it does not retype it from memory at midnight.
    ///
    /// For <see cref="ReleaseStepKind.EnvChange"/> this holds the variable NAME
    /// and where it is set, never the value. See <c>ReleaseService</c>.
    /// </summary>
    public string? Body { get; set; }

    /// <summary>Free text — "prod", "staging + prod". Which boxes this step touches.</summary>
    public string? TargetEnv { get; set; }

    /// <summary>The pipeline run page, the dashboard, the runbook. Whatever you would otherwise paste in chat.</summary>
    public string? Url { get; set; }

    public int Sequence { get; set; }

    /// <summary>One of <see cref="ReleaseStepStatus"/>.</summary>
    public string Status { get; set; } = ReleaseStepStatus.Pending;

    public Guid? DoneBy { get; set; }
    public User? DoneByUser { get; set; }
    public DateTime? DoneAt { get; set; }

    /// <summary>What happened. Mandatory in the UI when the step failed — a bare red tick teaches nobody anything.</summary>
    public string? Result { get; set; }
}

public static class ReleaseStepKind
{
    /// <summary>Run a deployment pipeline.</summary>
    public const string Pipeline = "pipeline";

    /// <summary>Run SQL against a database. The one step people most want a record of.</summary>
    public const string DbScript = "db_script";

    /// <summary>Add or change a configuration value. Name only — never the value.</summary>
    public const string EnvChange = "env_change";

    /// <summary>Anything a human does by hand.</summary>
    public const string Manual = "manual";

    /// <summary>Check that it worked. Belongs in the runbook, not in someone's head.</summary>
    public const string Verify = "verify";

    public static readonly string[] All = [Pipeline, DbScript, EnvChange, Manual, Verify];
    public static bool IsKnown(string kind) => All.Contains(kind);
}

public static class ReleaseStepStatus
{
    public const string Pending = "pending";
    public const string Done = "done";
    public const string Failed = "failed";
    public const string Skipped = "skipped";

    public static readonly string[] All = [Pending, Done, Failed, Skipped];
    public static bool IsKnown(string status) => All.Contains(status);
    public static bool IsSettled(string status) => status is Done or Skipped;
}

/// <summary>
/// One task shipping in this release — "Task 55335 — Auth issue fix".
///
/// It does two jobs at once, and that is the point: it is the SCOPE (what is in
/// this release) and it is the TEST CHECKLIST (what somebody walks through before
/// deploy). A flat list in a wiki cannot be the second one, because a line of
/// text has exactly one state — written — so testing ends up being something
/// everybody knows should happen and nobody's name is against.
///
/// It carries an external reference AND an optional Trackly ticket, not one or
/// the other. Most teams track development work somewhere else (Azure DevOps,
/// Jira); Trackly holds the support ticket that reported the bug. Both are true
/// at once, and linking the ticket is what lets a customer be told their fix is
/// scheduled without anybody asking a developer.
/// </summary>
public class ReleaseWorkItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ReleaseId { get; set; }
    public Release Release { get; set; } = null!;

    /// <summary>Which component it ships with. Null means "release-wide" and sorts last.</summary>
    public Guid? ComponentId { get; set; }
    public ReleaseComponent? Component { get; set; }

    /// <summary>The tracker's own id — "55335". Rendered through the workspace's URL template.</summary>
    public string? ExternalKey { get; set; }

    /// <summary>Set only when the key does not fit the template, or there is no template.</summary>
    public string? ExternalUrl { get; set; }

    /// <summary>The Trackly ticket this fixes, when there is one.</summary>
    public Guid? TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    public string Title { get; set; } = null!;

    /// <summary>One of <see cref="ReleaseTestStatus"/>. Checked BEFORE deployment, on staging.</summary>
    public string TestStatus { get; set; } = ReleaseTestStatus.NotTested;
    public Guid? TestedBy { get; set; }
    public User? TestedByUser { get; set; }
    public DateTime? TestedAt { get; set; }
    public string? TestNotes { get; set; }

    /// <summary>
    /// One of <see cref="ReleaseTestStatus"/>, checked AFTER deployment on production.
    ///
    /// Separate from <see cref="TestStatus"/> rather than overwriting it, because
    /// they answer different questions: pre-deploy testing decides whether to
    /// ship, post-deploy verification decides whether to roll back. Collapsing
    /// them into one column loses the second question entirely — which is the
    /// one asked while the site is on fire.
    /// </summary>
    public string VerifyStatus { get; set; } = ReleaseTestStatus.NotTested;
    public Guid? VerifiedBy { get; set; }
    public User? VerifiedByUser { get; set; }
    public DateTime? VerifiedAt { get; set; }

    public int Sequence { get; set; }
}

public static class ReleaseTestStatus
{
    public const string NotTested = "not_tested";
    public const string Passed = "passed";
    public const string Failed = "failed";

    /// <summary>Could not be tested — environment down, dependency missing. Not the same as untouched.</summary>
    public const string Blocked = "blocked";

    /// <summary>Consciously not tested. Someone decided; the log says who.</summary>
    public const string Skipped = "skipped";

    public static readonly string[] All = [NotTested, Passed, Failed, Blocked, Skipped];
    public static bool IsKnown(string status) => All.Contains(status);

    /// <summary>Passed or consciously skipped. Anything else blocks the release from going <c>ready</c>.</summary>
    public static bool ClearsRelease(string status) => status is Passed or Skipped;
}

/// <summary>
/// Append-only record of who did what, and when. Never edited, never deleted.
///
/// The wiki loses this every time: the page is edited in place, or the next
/// release is copied from it, and "what did we actually change in env last
/// time?" has no answer. That missing answer is what turns a rollback into
/// guesswork.
/// </summary>
public class ReleaseActivity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ReleaseId { get; set; }
    public Release Release { get; set; } = null!;

    /// <summary>Null for anything the system did on its own.</summary>
    public Guid? ActorId { get; set; }
    public User? Actor { get; set; }

    /// <summary>Machine-readable verb — <c>status_changed</c>, <c>step_done</c>, <c>item_tested</c>.</summary>
    public string Action { get; set; } = null!;

    /// <summary>Human-readable subject: the step title, the work item, the old → new status.</summary>
    public string? Detail { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
