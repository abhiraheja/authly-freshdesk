using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Trackly.Core.Email;
using Trackly.Core.Entities;

namespace Trackly.Infrastructure.Data;

public class TracklyDbContext(DbContextOptions<TracklyDbContext> options) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<EmailToken> EmailTokens => Set<EmailToken>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<TicketOption> TicketOptions => Set<TicketOption>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<TicketAssignment> TicketAssignments => Set<TicketAssignment>();
    public DbSet<TicketWatcher> TicketWatchers => Set<TicketWatcher>();
    public DbSet<TicketTimeEntry> TicketTimeEntries => Set<TicketTimeEntry>();
    public DbSet<TicketLink> TicketLinks => Set<TicketLink>();
    public DbSet<TicketActivity> TicketActivities => Set<TicketActivity>();
    public DbSet<TicketRelation> TicketRelations => Set<TicketRelation>();
    public DbSet<TicketTask> TicketTasks => Set<TicketTask>();
    public DbSet<TicketResponder> TicketResponders => Set<TicketResponder>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<TicketAsset> TicketAssets => Set<TicketAsset>();
    public DbSet<BusinessService> BusinessServices => Set<BusinessService>();
    public DbSet<TicketImpactedService> TicketImpactedServices => Set<TicketImpactedService>();
    public DbSet<TicketField> TicketFields => Set<TicketField>();
    public DbSet<TicketFieldValue> TicketFieldValues => Set<TicketFieldValue>();
    public DbSet<TicketPin> TicketPins => Set<TicketPin>();
    public DbSet<RewardGoal> RewardGoals => Set<RewardGoal>();
    public DbSet<AgentRewardAward> AgentRewardAwards => Set<AgentRewardAward>();
    public DbSet<BusinessHours> BusinessHours => Set<BusinessHours>();
    public DbSet<BusinessHourDay> BusinessHourDays => Set<BusinessHourDay>();
    public DbSet<BusinessHoliday> BusinessHolidays => Set<BusinessHoliday>();
    public DbSet<TicketStatus> TicketStatuses => Set<TicketStatus>();
    public DbSet<TicketStatusTransition> TicketStatusTransitions => Set<TicketStatusTransition>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CommentMention> CommentMentions => Set<CommentMention>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<WorkspaceBranding> WorkspaceBrandings => Set<WorkspaceBranding>();
    public DbSet<WorkspaceInvitation> WorkspaceInvitations => Set<WorkspaceInvitation>();
    public DbSet<EmailConfig> EmailConfigs => Set<EmailConfig>();
    public DbSet<EmailProvider> EmailProviders => Set<EmailProvider>();
    public DbSet<EmailOAuthState> EmailOAuthStates => Set<EmailOAuthState>();
    public DbSet<EmailTemplate> EmailTemplates => Set<EmailTemplate>();
    public DbSet<StorageConfig> StorageConfigs => Set<StorageConfig>();
    public DbSet<NotificationSettings> NotificationSettings => Set<NotificationSettings>();
    public DbSet<InboundEmailEvent> InboundEmailEvents => Set<InboundEmailEvent>();
    public DbSet<SsoConnection> SsoConnections => Set<SsoConnection>();
    public DbSet<SsoGroupRoleMapping> SsoGroupRoleMappings => Set<SsoGroupRoleMapping>();
    public DbSet<UserIdentity> UserIdentities => Set<UserIdentity>();
    public DbSet<SsoLoginState> SsoLoginStates => Set<SsoLoginState>();
    public DbSet<Problem> Problems => Set<Problem>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<TicketTag> TicketTags => Set<TicketTag>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<TeamMember> TeamMembers => Set<TeamMember>();
    public DbSet<SlaPolicy> SlaPolicies => Set<SlaPolicy>();
    public DbSet<KbArticle> KbArticles => Set<KbArticle>();
    public DbSet<CannedResponse> CannedResponses => Set<CannedResponse>();
    public DbSet<AutomationRule> AutomationRules => Set<AutomationRule>();
    public DbSet<Announcement> Announcements => Set<Announcement>();
    public DbSet<AnnouncementDelivery> AnnouncementDeliveries => Set<AnnouncementDelivery>();
    public DbSet<WidgetConfig> WidgetConfigs => Set<WidgetConfig>();
    public DbSet<WidgetVisitor> WidgetVisitors => Set<WidgetVisitor>();
    public DbSet<CsatSurvey> CsatSurveys => Set<CsatSurvey>();
    public DbSet<ChannelConnector> ChannelConnectors => Set<ChannelConnector>();
    public DbSet<ChannelConversation> ChannelConversations => Set<ChannelConversation>();
    public DbSet<InboundChannelEvent> InboundChannelEvents => Set<InboundChannelEvent>();
    public DbSet<ChatSession> ChatSessions => Set<ChatSession>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Workspace>(e =>
        {
            e.ToTable("workspaces");
            e.HasIndex(w => w.Slug).IsUnique();
            e.Property(w => w.EmailLoginEnabled).HasDefaultValue(true);
            // Must be true, and must be declared here rather than only on the
            // entity: without it the migration adds the column defaulting to
            // false, which turns password sign-in OFF for every existing
            // workspace — locking out an installation whose email is not yet
            // proven to work. The default is what backfills existing rows.
            e.Property(w => w.PasswordLoginEnabled).HasDefaultValue(true);
            e.Property(w => w.AiEnabled).HasDefaultValue(true);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users", t =>
                t.HasCheckConstraint("email_or_phone", "email IS NOT NULL OR phone IS NOT NULL"));
            e.HasIndex(u => new { u.WorkspaceId, u.Email }).IsUnique();
            e.Property(u => u.Role).HasDefaultValue(TracklyRoles.Customer);
            e.Property(u => u.IsActive).HasDefaultValue(true);

            // jsonb, not a child table: these are read and written whole, always
            // with their user, and never queried across users. A table would buy
            // joins nobody needs and lose the "just save the dictionary" write.
            //
            // The comparer is not optional. Without one EF compares Dictionary by
            // REFERENCE, so editing an existing customer's fields in place looks
            // unchanged and the save silently does nothing.
            e.Property(u => u.CustomFields)
                .HasColumnName("custom_fields")
                .HasColumnType("jsonb")
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, (JsonSerializerOptions?)null)
                         ?? new Dictionary<string, string>(),
                    new ValueComparer<Dictionary<string, string>>(
                        (a, b) => a != null && b != null && a.Count == b.Count && !a.Except(b).Any(),
                        v => v.Aggregate(0, (hash, kv) => HashCode.Combine(hash, kv.Key, kv.Value)),
                        v => new Dictionary<string, string>(v)));
            e.HasOne(u => u.Workspace)
                .WithMany(w => w.Users)
                .HasForeignKey(u => u.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Session>(e =>
        {
            e.ToTable("sessions");
            e.HasIndex(s => s.TokenHash).IsUnique();
            e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.Workspace).WithMany().HasForeignKey(s => s.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EmailToken>(e =>
        {
            e.ToTable("email_tokens");
            e.HasIndex(t => t.LinkTokenHash).IsUnique();
            e.HasIndex(t => new { t.Email, t.CreatedAt }); // send rate-limit lookups
            e.Property(t => t.Attempts).HasDefaultValue(0);
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Category>(e =>
        {
            e.ToTable("categories");
            // Unique on (workspace, parent, name): "Access" may exist once at the
            // top level and again under two different parents, which is normal in
            // a taxonomy and would be blocked by a workspace-wide unique name.
            e.HasIndex(c => new { c.WorkspaceId, c.ParentId, c.Name }).IsUnique();
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            // Cascade: deleting a category takes its sub-categories, because a
            // sub-category with no parent is a label with nothing above it.
            e.HasOne(c => c.Parent).WithMany(c => c.Children).HasForeignKey(c => c.ParentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketOption>(e =>
        {
            e.ToTable("ticket_options");
            // (workspace, kind, value) is the identity: the value is what lands
            // on a ticket, so two rows sharing one would make a ticket ambiguous.
            e.HasIndex(o => new { o.WorkspaceId, o.Kind, o.Value }).IsUnique();
            e.Property(o => o.Kind).HasMaxLength(32);
            e.Property(o => o.Value).HasMaxLength(64);
            e.Property(o => o.Label).HasMaxLength(64);
            e.Property(o => o.Color).HasMaxLength(32);
            e.HasOne(o => o.Workspace).WithMany().HasForeignKey(o => o.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Ticket>(e =>
        {
            // There used to be a `requester_or_guest` CHECK here. It was dropped
            // because the invariant stopped being true: an agent can raise a
            // ticket before knowing who it is for — a phone call to log, an
            // internal request — and links the customer afterwards. Forcing a
            // requester at insert meant the agent themselves, which made every
            // internally-raised ticket look like their own support request.
            //
            // Nothing depended on the guarantee: every customer-facing send in
            // NotificationService already bails on a null email.
            e.ToTable("tickets");
            e.Property(t => t.Status).HasDefaultValue(TicketStatusCategory.DefaultValue);
            e.Property(t => t.StatusCategory).HasDefaultValue(TicketStatusCategory.Open);
            e.Property(t => t.Priority).HasDefaultValue(TicketPriority.Medium);
            e.Property(t => t.Channel).HasDefaultValue(TicketChannel.Web);
            e.HasIndex(t => new { t.WorkspaceId, t.Status });
            // Every rule in Trackly filters on the category, not the status, so
            // this is the index that actually gets used by the queue counts, the
            // SLA sweep and the "needs attention" views.
            e.HasIndex(t => new { t.WorkspaceId, t.StatusCategory });
            e.HasIndex(t => new { t.WorkspaceId, t.AssigneeId });
            e.HasIndex(t => new { t.WorkspaceId, t.RequesterId });
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.Category).WithMany().HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.Requester).WithMany().HasForeignKey(t => t.RequesterId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.Assignee).WithMany().HasForeignKey(t => t.AssigneeId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.Problem).WithMany().HasForeignKey(t => t.ProblemId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.Team).WithMany().HasForeignKey(t => t.TeamId)
                .OnDelete(DeleteBehavior.SetNull);
            // NoAction on the two narrower columns. SetNull would give PostgreSQL
            // a second path from categories/teams into tickets and it refuses the
            // schema outright; the services clear these explicitly when the
            // parent goes, which is the one place that knows both are nulled
            // together anyway.
            e.HasOne(t => t.SubCategory).WithMany().HasForeignKey(t => t.SubCategoryId)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(t => t.SubTeam).WithMany().HasForeignKey(t => t.SubTeamId)
                .OnDelete(DeleteBehavior.NoAction);
            // SetNull: the flag is a fact about the ticket and outlives whoever
            // raised it — losing the flag because somebody left would quietly
            // demote a ticket the team had marked.
            e.HasOne(t => t.FlaggedBy).WithMany().HasForeignKey(t => t.FlaggedById)
                .OnDelete(DeleteBehavior.SetNull);
            // Partial: flagged tickets are a handful out of the whole table, and
            // the list filters on exactly this.
            e.HasIndex(t => new { t.WorkspaceId, t.FlaggedAt })
                .HasFilter("flagged_at IS NOT NULL");
            // SetNull, not Cascade: deactivating and removing an agent must not
            // take the resolution of every ticket they ever closed with them.
            e.HasOne(t => t.ResolvedBy).WithMany().HasForeignKey(t => t.ResolvedById)
                .OnDelete(DeleteBehavior.SetNull);
            // SlaBreachWorker's own query: open tickets with a deadline coming
            // up, swept across every workspace at once — hence no workspace_id
            // leading column. Partial, because resolved and closed tickets are
            // the bulk of the table and can never match.
            //
            // Declared here rather than as raw SQL in a migration: it used to be
            // the latter, which meant it existed in the database but not in the
            // model, so it silently vanished the first time the migrations were
            // squashed. The name is pinned because the worker's plan is the whole
            // reason this index exists.
            e.HasIndex(t => new { t.ResolveDueAt, t.FirstResponseDueAt })
                .HasDatabaseName("ix_tickets_sla_sweep")
                .HasFilter("status_category NOT IN ('resolved', 'closed')");
            // The widget's "everything I have raised" query. Partial, because
            // only widget traffic ever sets it and that is a slice of the table.
            e.HasIndex(t => t.WidgetVisitorId)
                .HasFilter("widget_visitor_id IS NOT NULL");
            // SetNull, and it is the delete path for "Delete Widget": the widget
            // cascades to its visitors, and each of their tickets stays in the
            // queue as an ordinary ticket with nobody able to claim it. Restrict
            // would make deleting a widget impossible the moment anyone used it;
            // cascade would delete real support history to tidy up a config row.
            e.HasOne(t => t.WidgetVisitor).WithMany().HasForeignKey(t => t.WidgetVisitorId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketTimeEntry>(e =>
        {
            e.ToTable("ticket_time_entries", t =>
                t.HasCheckConstraint("time_entry_minutes_positive", "minutes > 0"));
            // The ticket's own panel is the only reader, and it wants them newest
            // first — so the index carries the sort, not just the filter.
            e.HasIndex(x => new { x.TicketId, x.SpentAt });
            e.HasIndex(x => new { x.WorkspaceId, x.UserId });
            e.HasOne(x => x.Workspace).WithMany().HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Ticket).WithMany(t => t.TimeEntries).HasForeignKey(x => x.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // Restrict, deliberately: a user row cannot be deleted while their
            // logged work still exists. Trackly deactivates people rather than
            // deleting them, and time already spent is a record of what the
            // workspace was billed for — losing it silently is not acceptable.
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<TicketStatus>(e =>
        {
            e.ToTable("ticket_statuses");
            e.Property(s => s.IsActive).HasDefaultValue(true);
            // The value is what sits on every ticket, so it has to be unique
            // within a workspace or two statuses would be indistinguishable
            // once stored.
            e.HasIndex(s => new { s.WorkspaceId, s.Value }).IsUnique();
            e.HasOne(s => s.Workspace).WithMany().HasForeignKey(s => s.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketStatusTransition>(e =>
        {
            e.ToTable("ticket_status_transitions");
            e.HasIndex(t => new { t.WorkspaceId, t.FromStatusId });
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            // NoAction on both: the service deletes a status's transitions
            // explicitly, and two cascade paths from ticket_statuses into this
            // table is a schema PostgreSQL will not create.
            e.HasOne(t => t.FromStatus).WithMany().HasForeignKey(t => t.FromStatusId)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(t => t.ToStatus).WithMany().HasForeignKey(t => t.ToStatusId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<TicketLink>(e =>
        {
            e.ToTable("ticket_links");
            e.Property(x => x.Kind).HasDefaultValue(TicketLinkKind.Related);
            // Unique per ticket: the same URL added twice is a mistake every
            // time, and it is far easier to stop it here than to explain two
            // identical rows in the card afterwards.
            e.HasIndex(x => new { x.TicketId, x.Url }).IsUnique();
            e.HasOne(x => x.Workspace).WithMany().HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Ticket).WithMany(t => t.Links).HasForeignKey(x => x.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // SetNull: the link is about the work, not about who filed it, so it
            // outlives the agent's account.
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketPin>(e =>
        {
            e.ToTable("ticket_pins");
            e.HasKey(p => new { p.TicketId, p.AgentId });
            // "My pins, newest first" — the only query that does not start from a
            // ticket, and what the list sorts by.
            e.HasIndex(p => new { p.AgentId, p.PinnedAt });
            e.HasOne(p => p.Ticket).WithMany(t => t.Pins).HasForeignKey(p => p.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // Cascade: a pin is one person's bookmark and means nothing without
            // them. Unlike a time entry it is not a record of work.
            e.HasOne(p => p.Agent).WithMany().HasForeignKey(p => p.AgentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RewardGoal>(e =>
        {
            e.ToTable("reward_goals");
            // The admin's own order, then name — the same shape as every other
            // workspace-configured list.
            e.HasIndex(g => new { g.WorkspaceId, g.SortOrder });
            e.Property(g => g.Name).HasMaxLength(120);
            e.Property(g => g.Description).HasMaxLength(500);
            e.Property(g => g.Metric).HasMaxLength(40);
            e.Property(g => g.Period).HasMaxLength(20);
            e.Property(g => g.Tier).HasMaxLength(20);
            e.HasOne(g => g.Workspace).WithMany().HasForeignKey(g => g.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AgentRewardAward>(e =>
        {
            e.ToTable("agent_reward_awards");
            // **This index is the idempotency.** The evaluation sweep runs on a
            // timer and recomputes the whole current period every time; without a
            // unique constraint on the triple it would hand out August's gold once
            // an hour, forever.
            e.HasIndex(a => new { a.GoalId, a.AgentId, a.PeriodKey }).IsUnique();
            // "What has this agent earned", newest first — the badge row on a
            // dashboard, and the only query that does not start from a goal.
            e.HasIndex(a => new { a.AgentId, a.AwardedAt });
            e.Property(a => a.PeriodKey).HasMaxLength(20);
            e.HasOne(a => a.Workspace).WithMany().HasForeignKey(a => a.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            // Cascade from the goal: deleting a goal retracts its badges, which is
            // the honest outcome — a badge for a target nobody can look up is a
            // trophy with the engraving rubbed off. Retiring the goal (IsActive
            // false) is the move that keeps the history, and the admin screen
            // steers there.
            e.HasOne(a => a.Goal).WithMany().HasForeignKey(a => a.GoalId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.Agent).WithMany().HasForeignKey(a => a.AgentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BusinessHours>(e =>
        {
            e.ToTable("business_hours");
            // One schedule per workspace, so the workspace id IS the key — no
            // second identifier to keep unique and nothing that can produce two.
            e.HasKey(h => h.WorkspaceId);
            e.Property(h => h.TimeZone).HasDefaultValue("UTC");
            e.HasOne(h => h.Workspace).WithMany().HasForeignKey(h => h.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BusinessHourDay>(e =>
        {
            e.ToTable("business_hour_days");
            // Loaded as a set for one workspace, never queried by day alone.
            e.HasIndex(d => d.WorkspaceId);
            e.HasOne(d => d.BusinessHours).WithMany(h => h.Days).HasForeignKey(d => d.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BusinessHoliday>(e =>
        {
            e.ToTable("business_holidays");
            // Unique: the same date twice is a duplicate the calendar would
            // silently ignore, and the admin screen would show twice.
            e.HasIndex(h => new { h.WorkspaceId, h.Date }).IsUnique();
            e.HasOne(h => h.BusinessHours).WithMany(x => x.Holidays).HasForeignKey(h => h.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketRelation>(e =>
        {
            e.ToTable("ticket_relations");
            // One row per pair per direction. The same two tickets can be linked
            // twice with different meanings ("relates" and "blocks") but not
            // twice with the same one, which is only ever a double-click.
            e.HasIndex(r => new { r.TicketId, r.RelatedTicketId, r.Kind }).IsUnique();
            // Read from the other end too — "what points AT me" is half the card.
            e.HasIndex(r => r.RelatedTicketId);
            e.HasOne(r => r.Workspace).WithMany().HasForeignKey(r => r.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Ticket).WithMany().HasForeignKey(r => r.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // NoAction: two cascade paths from tickets into one table is a schema
            // PostgreSQL will not create. Deleting a ticket clears rows pointing
            // at it explicitly — see TicketRelationService.
            e.HasOne(r => r.RelatedTicket).WithMany().HasForeignKey(r => r.RelatedTicketId)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(r => r.CreatedBy).WithMany().HasForeignKey(r => r.CreatedById)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketTask>(e =>
        {
            e.ToTable("ticket_tasks");
            e.HasIndex(t => new { t.TicketId, t.SortOrder });
            // "My open tasks" across the workspace — the only query that does not
            // start from a ticket.
            e.HasIndex(t => new { t.AssigneeId, t.CompletedAt });
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.Ticket).WithMany(x => x.Tasks).HasForeignKey(t => t.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // SetNull on all three people: a task is a record of work, and it
            // outlives whoever was assigned it or ticked it off.
            e.HasOne(t => t.Assignee).WithMany().HasForeignKey(t => t.AssigneeId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.CompletedBy).WithMany().HasForeignKey(t => t.CompletedById)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.CreatedBy).WithMany().HasForeignKey(t => t.CreatedById)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketResponder>(e =>
        {
            e.ToTable("ticket_responders");
            e.HasKey(r => new { r.TicketId, r.AgentId });
            // "Tickets I'm responding on" — the agent's own working set.
            e.HasIndex(r => r.AgentId);
            e.HasOne(r => r.Ticket).WithMany(t => t.Responders).HasForeignKey(r => r.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Agent).WithMany().HasForeignKey(r => r.AgentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Asset>(e =>
        {
            e.ToTable("assets");
            e.HasIndex(a => new { a.WorkspaceId, a.Name });
            // Sparse unique: two assets may both have no tag, but a tag that IS
            // set has to identify exactly one thing or it is not an asset tag.
            e.HasIndex(a => new { a.WorkspaceId, a.Tag })
                .IsUnique()
                .HasFilter("tag IS NOT NULL");
            e.HasOne(a => a.Workspace).WithMany().HasForeignKey(a => a.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.AssignedTo).WithMany().HasForeignKey(a => a.AssignedToId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketAsset>(e =>
        {
            e.ToTable("ticket_assets");
            e.HasKey(x => new { x.TicketId, x.AssetId });
            // "Everything raised about this machine" — the reason to keep a
            // register at all.
            e.HasIndex(x => x.AssetId);
            e.HasOne(x => x.Ticket).WithMany(t => t.Assets).HasForeignKey(x => x.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Asset).WithMany().HasForeignKey(x => x.AssetId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BusinessService>(e =>
        {
            e.ToTable("business_services");
            e.HasIndex(s => new { s.WorkspaceId, s.Name }).IsUnique();
            e.HasOne(s => s.Workspace).WithMany().HasForeignKey(s => s.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.OwnerTeam).WithMany().HasForeignKey(s => s.OwnerTeamId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketImpactedService>(e =>
        {
            e.ToTable("ticket_impacted_services");
            e.HasKey(x => new { x.TicketId, x.ServiceId });
            // "What is currently hitting Payments" — the incident view.
            e.HasIndex(x => x.ServiceId);
            e.HasOne(x => x.Ticket).WithMany(t => t.ImpactedServices).HasForeignKey(x => x.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Service).WithMany().HasForeignKey(x => x.ServiceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketField>(e =>
        {
            e.ToTable("ticket_fields");
            // The key is what every stored answer points at, so two fields
            // sharing one would make an answer ambiguous.
            e.HasIndex(f => new { f.WorkspaceId, f.Key }).IsUnique();
            e.HasOne(f => f.Workspace).WithMany().HasForeignKey(f => f.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketFieldValue>(e =>
        {
            e.ToTable("ticket_field_values");
            e.HasKey(v => new { v.TicketId, v.FieldId });
            // Filtering the list by a custom field's answer.
            e.HasIndex(v => new { v.FieldId, v.Value });
            e.HasOne(v => v.Ticket).WithMany(t => t.FieldValues).HasForeignKey(v => v.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // Cascade: deleting a field deletes its answers. Retiring is the
            // non-destructive option and is what the admin screen offers.
            e.HasOne(v => v.Field).WithMany().HasForeignKey(v => v.FieldId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketActivity>(e =>
        {
            e.ToTable("ticket_activities");
            // The only query the feed makes: one ticket, oldest first. Nothing
            // filters or searches it, so one composite index is the whole story.
            e.HasIndex(a => new { a.TicketId, a.CreatedAt });
            e.HasOne(a => a.Ticket).WithMany().HasForeignKey(a => a.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            // SetNull, not Cascade: the log is a record of what happened to the
            // ticket. Deactivating or removing an agent must not quietly erase
            // the changes they made — the row survives and reads as "system".
            e.HasOne(a => a.Actor).WithMany().HasForeignKey(a => a.ActorId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Notification>(e =>
        {
            e.ToTable("notifications");
            // The bell's only query: mine, newest first, unread on top. One
            // index carries the filter and the sort together.
            e.HasIndex(n => new { n.UserId, n.CreatedAt });
            e.HasIndex(n => new { n.UserId, n.ReadAt });
            e.HasOne(n => n.Workspace).WithMany().HasForeignKey(n => n.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(n => n.User).WithMany().HasForeignKey(n => n.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            // The ticket going away takes its notifications with it — a bell row
            // that leads to a 404 is worse than no row.
            e.HasOne(n => n.Ticket).WithMany().HasForeignKey(n => n.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(n => n.Actor).WithMany().HasForeignKey(n => n.ActorId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CommentMention>(e =>
        {
            e.ToTable("comment_mentions");
            e.HasKey(m => new { m.CommentId, m.UserId });
            // "Tickets where I was mentioned" — the nav item and its count.
            e.HasIndex(m => new { m.UserId, m.TicketId });
            e.HasOne(m => m.Comment).WithMany(c => c.Mentions).HasForeignKey(m => m.CommentId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            // NoAction because a second cascade path from tickets is a schema
            // PostgreSQL refuses to create.
            //
            // This used to say the comment's own cascade already removed these
            // rows, so deleting a ticket was safe. It is not: PostgreSQL checks
            // the ticket's referencing keys against the row being deleted, while
            // the cascade that would empty this table hangs off `comments`, one
            // level further down — so the constraint fires first and the delete
            // is refused. Anything that deletes a ticket must clear these rows
            // itself, exactly as it does for ticket_relations. See
            // TicketBulkService.DeleteAsync, which is the only such caller.
            e.HasOne(m => m.Ticket).WithMany().HasForeignKey(m => m.TicketId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Comment>(e =>
        {
            e.ToTable("comments");
            e.Property(c => c.IsInternal).HasDefaultValue(false);
            e.Property(c => c.Source).HasDefaultValue(CommentSource.Web);
            e.Property(c => c.BodyFormat).HasDefaultValue(CommentBodyFormat.Text);
            e.Property(c => c.Visibility).HasDefaultValue(CommentVisibility.Public);
            e.HasIndex(c => new { c.TicketId, c.CreatedAt });
            e.HasIndex(c => c.EmailMessageId); // inbound threading fallback lookups
            e.HasOne(c => c.Ticket).WithMany(t => t.Comments).HasForeignKey(c => c.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Author).WithMany().HasForeignKey(c => c.AuthorId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TicketAssignment>(e =>
        {
            e.ToTable("ticket_assignments");
            e.HasOne(a => a.Ticket).WithMany().HasForeignKey(a => a.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.AssignedToUser).WithMany().HasForeignKey(a => a.AssignedTo)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(a => a.AssignedByUser).WithMany().HasForeignKey(a => a.AssignedBy)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<TicketWatcher>(e =>
        {
            e.ToTable("ticket_watchers");
            e.HasKey(w => new { w.TicketId, w.AgentId });
            e.HasOne(w => w.Ticket).WithMany(t => t.Watchers).HasForeignKey(w => w.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(w => w.Agent).WithMany().HasForeignKey(w => w.AgentId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(w => w.AddedByUser).WithMany().HasForeignKey(w => w.AddedBy)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<WorkspaceBranding>(e =>
        {
            e.ToTable("workspace_branding");
            e.HasIndex(b => b.WorkspaceId).IsUnique();
            e.Property(b => b.PrimaryColor).HasDefaultValue("#2563EB");
            e.Property(b => b.HidePoweredBy).HasDefaultValue(false);
            e.HasOne(b => b.Workspace).WithMany().HasForeignKey(b => b.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<WorkspaceInvitation>(e =>
        {
            e.ToTable("workspace_invitations");
            e.HasIndex(i => i.TokenHash).IsUnique();
            e.HasIndex(i => new { i.WorkspaceId, i.Email });
            e.HasOne(i => i.Workspace).WithMany().HasForeignKey(i => i.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(i => i.InvitedByUser).WithMany().HasForeignKey(i => i.InvitedBy)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EmailConfig>(e =>
        {
            e.ToTable("email_configs");
            e.HasIndex(c => c.WorkspaceId).IsUnique();
            e.Property(c => c.EmailMode).HasDefaultValue(EmailMode.NotificationsOnly);
            e.Property(c => c.NewTicketViaEmail).HasDefaultValue(false);
            e.Property(c => c.PollIntervalSeconds).HasDefaultValue(60);
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            // SetNull, not Cascade: deleting a provider must not delete the
            // workspace's entire email configuration along with it. Losing the
            // pointer falls back to the shared relay, which still delivers.
            e.HasOne(c => c.SendingProvider).WithMany().HasForeignKey(c => c.SendingProviderId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(c => c.ReceivingProvider).WithMany().HasForeignKey(c => c.ReceivingProviderId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<EmailProvider>(e =>
        {
            e.ToTable("email_providers");
            // One row per provider. Two Gmail connections would be two sets of
            // credentials for one mailbox with nothing to tell them apart.
            e.HasIndex(p => new { p.WorkspaceId, p.Provider }).IsUnique();
            e.Property(p => p.Enabled).HasDefaultValue(false);
            e.Property(p => p.SmtpUseStartTls).HasDefaultValue(true);
            e.HasOne(p => p.Workspace).WithMany().HasForeignKey(p => p.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EmailOAuthState>(e =>
        {
            e.ToTable("email_oauth_states");
            // Unique because it is what the callback is looked up by, and two
            // rows sharing a state would make "single-use" unenforceable.
            e.HasIndex(s => s.State).IsUnique();
            e.HasIndex(s => s.ExpiresAt); // cleanup sweeps
            e.HasOne(s => s.Workspace).WithMany().HasForeignKey(s => s.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EmailTemplate>(e =>
        {
            e.ToTable("email_templates");
            // One customisation per key per language. Rows exist only for keys an
            // admin actually changed — everything else renders from the catalogue.
            e.HasIndex(t => new { t.WorkspaceId, t.Key, t.Locale }).IsUnique();
            e.Property(t => t.Locale).HasDefaultValue(EmailTemplateCatalog.DefaultLocale);
            e.Property(t => t.IsActive).HasDefaultValue(true);
            e.Property(t => t.Standalone).HasDefaultValue(false);
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            // SetNull: an agent leaving must not delete the template they last
            // edited. The attribution is a convenience, the template is the asset.
            e.HasOne(t => t.UpdatedBy).WithMany().HasForeignKey(t => t.UpdatedById)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<StorageConfig>(e =>
        {
            e.ToTable("storage_configs");
            e.HasIndex(c => c.WorkspaceId).IsUnique();
            e.Property(c => c.Provider).HasDefaultValue(StorageProviders.Local);
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<NotificationSettings>(e =>
        {
            e.ToTable("notification_settings");
            e.HasIndex(s => s.WorkspaceId).IsUnique();
            e.Property(s => s.NotifyCustomerOnCreate).HasDefaultValue(true);
            e.Property(s => s.NotifyCustomerOnReply).HasDefaultValue(true);
            e.Property(s => s.NotifyCustomerOnStatus).HasDefaultValue(true);
            e.Property(s => s.NotifyAgentOnAssign).HasDefaultValue(true);
            e.Property(s => s.NotifyAgentOnReply).HasDefaultValue(true);
            e.Property(s => s.NotifyAgentOnReassign).HasDefaultValue(true);
            e.HasOne(s => s.Workspace).WithMany().HasForeignKey(s => s.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<InboundEmailEvent>(e =>
        {
            e.ToTable("inbound_email_events");
            // Exactly-once ingestion: a duplicate provider Message-ID collides here.
            e.HasIndex(x => new { x.WorkspaceId, x.MessageId }).IsUnique();
            e.HasOne(x => x.Workspace).WithMany().HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SsoConnection>(e =>
        {
            e.ToTable("sso_connections");
            // Several providers per workspace — "Continue with Google" and
            // "Continue with Microsoft" are two rows. Ordered for the sign-in page.
            e.HasIndex(c => new { c.WorkspaceId, c.SortOrder });
            // …but only one of each well-known provider. Two corporate IdPs is a
            // real setup, so the custom kinds are excluded from the constraint;
            // two Googles is always a mistake.
            e.HasIndex(c => new { c.WorkspaceId, c.Provider })
                .IsUnique()
                .HasFilter("provider NOT IN ('oidc', 'saml')");
            e.Property(c => c.Provider).HasDefaultValue(SsoProviderKind.Oidc);
            e.Property(c => c.Status).HasDefaultValue(SsoStatus.Pending);
            e.Property(c => c.IsEnabled).HasDefaultValue(true);
            e.Property(c => c.ShowOnStaffLogin).HasDefaultValue(true);
            e.Property(c => c.ShowOnCustomerLogin).HasDefaultValue(false);
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SsoGroupRoleMapping>(e =>
        {
            e.ToTable("sso_group_role_mappings");
            e.HasIndex(m => m.ConnectionId);
            e.HasOne(m => m.Connection).WithMany(c => c.GroupMappings).HasForeignKey(m => m.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserIdentity>(e =>
        {
            e.ToTable("user_identities");
            e.HasIndex(i => new { i.ConnectionId, i.ProviderSub }).IsUnique();
            e.Property(i => i.IsActive).HasDefaultValue(true);
            e.HasOne(i => i.User).WithMany().HasForeignKey(i => i.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(i => i.Connection).WithMany().HasForeignKey(i => i.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SsoLoginState>(e =>
        {
            e.ToTable("sso_login_states");
            e.HasIndex(s => s.State).IsUnique();
            e.HasIndex(s => s.ExpiresAt); // cleanup sweeps
        });

        modelBuilder.Entity<Announcement>(e =>
        {
            e.ToTable("announcements");
            e.HasIndex(a => new { a.WorkspaceId, a.CreatedAt });
            e.HasIndex(a => a.ScheduledAt); // scheduled-send sweeps
            e.Property(a => a.Type).HasDefaultValue(AnnouncementType.General);
            e.HasOne(a => a.Workspace).WithMany().HasForeignKey(a => a.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.Problem).WithMany().HasForeignKey(a => a.ProblemId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(a => a.CreatedByUser).WithMany().HasForeignKey(a => a.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AnnouncementDelivery>(e =>
        {
            e.ToTable("announcement_deliveries");
            e.HasIndex(d => d.AnnouncementId);
            e.Property(d => d.Status).HasDefaultValue(DeliveryStatus.Pending);
            e.HasOne(d => d.Announcement).WithMany(a => a.Deliveries).HasForeignKey(d => d.AnnouncementId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(d => d.User).WithMany().HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<WidgetConfig>(e =>
        {
            e.ToTable("widget_configs");
            // Deliberately NOT unique on workspace any more: a workspace runs as
            // many widgets as it has surfaces to embed one on. The token is what
            // is unique now, and it is what every public request resolves by.
            e.HasIndex(w => w.WorkspaceId);
            e.HasIndex(w => w.PublicToken).IsUnique();
            e.Property(w => w.EmbedType).HasDefaultValue(WidgetEmbedType.Floating);
            e.Property(w => w.Theme).HasDefaultValue("light");
            e.HasOne(w => w.Workspace).WithMany().HasForeignKey(w => w.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(w => w.Team).WithMany().HasForeignKey(w => w.TeamId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<WidgetVisitor>(e =>
        {
            e.ToTable("widget_visitors");
            e.HasIndex(v => v.VisitorTokenHash).IsUnique();     // the lookup on every request
            e.HasIndex(v => new { v.WidgetId, v.ExternalId });  // re-identify a returning host-page user
            e.HasIndex(v => new { v.WorkspaceId, v.UserId });   // a contact's visitors, workspace-scoped
            // Same reason as User.CustomFields: without a comparer EF compares
            // the dictionary by reference and an in-place edit saves nothing.
            e.Property(v => v.Variables)
                .HasColumnName("variables")
                .HasColumnType("jsonb")
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, (JsonSerializerOptions?)null)
                         ?? new Dictionary<string, string>(),
                    new ValueComparer<Dictionary<string, string>>(
                        (a, b) => a != null && b != null && a.Count == b.Count && !a.Except(b).Any(),
                        v => v.Aggregate(0, (hash, kv) => HashCode.Combine(hash, kv.Key, kv.Value)),
                        v => new Dictionary<string, string>(v)));
            e.HasOne(v => v.Workspace).WithMany().HasForeignKey(v => v.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(v => v.Widget).WithMany().HasForeignKey(v => v.WidgetId)
                .OnDelete(DeleteBehavior.Cascade);
            // The visitor outlives the contact record: losing a browser's whole
            // conversation history because a customer row was merged away would
            // be worse than an orphaned visitor.
            e.HasOne(v => v.User).WithMany().HasForeignKey(v => v.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AutomationRule>(e =>
        {
            e.ToTable("automation_rules");
            e.HasIndex(r => new { r.WorkspaceId, r.Trigger, r.SortOrder });
            e.Property(r => r.Trigger).HasDefaultValue(AutomationTrigger.OnCreate);
            e.Property(r => r.Enabled).HasDefaultValue(true);
            e.HasOne(r => r.Workspace).WithMany().HasForeignKey(r => r.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CannedResponse>(e =>
        {
            e.ToTable("canned_responses");
            e.HasIndex(c => c.WorkspaceId);
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CsatSurvey>(e =>
        {
            e.ToTable("csat_surveys");
            e.HasIndex(c => c.TicketId).IsUnique();               // one survey per ticket
            e.HasIndex(c => new { c.WorkspaceId, c.AgentId });    // per-agent CSAT reporting
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Ticket).WithMany().HasForeignKey(c => c.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChannelConnector>(e =>
        {
            e.ToTable("channel_connectors");
            e.HasIndex(c => new { c.WorkspaceId, c.Provider }).IsUnique();  // one per provider
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChannelConversation>(e =>
        {
            e.ToTable("channel_conversations");
            e.HasIndex(c => new { c.WorkspaceId, c.Provider, c.ConversationKey }).IsUnique(); // threading key
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Ticket).WithMany().HasForeignKey(c => c.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<InboundChannelEvent>(e =>
        {
            e.ToTable("inbound_channel_events");
            e.HasIndex(c => new { c.WorkspaceId, c.Provider, c.ExternalMessageId }).IsUnique(); // dedup
        });

        modelBuilder.Entity<ChatSession>(e =>
        {
            e.ToTable("chat_sessions");
            e.HasIndex(c => new { c.WorkspaceId, c.Status });
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Agent).WithMany().HasForeignKey(c => c.AgentId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ChatMessage>(e =>
        {
            e.ToTable("chat_messages");
            e.HasIndex(c => new { c.SessionId, c.CreatedAt });
            e.HasOne(c => c.Session).WithMany(s => s.Messages).HasForeignKey(c => c.SessionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<KbArticle>(e =>
        {
            e.ToTable("kb_articles");
            e.HasIndex(a => new { a.WorkspaceId, a.Status });
            e.Property(a => a.Status).HasDefaultValue(KbArticleStatus.Draft);
            e.HasOne(a => a.Workspace).WithMany().HasForeignKey(a => a.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.Category).WithMany().HasForeignKey(a => a.CategoryId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(a => a.CreatedByUser).WithMany().HasForeignKey(a => a.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SlaPolicy>(e =>
        {
            e.ToTable("sla_policies");
            e.HasIndex(p => new { p.WorkspaceId, p.Priority }).IsUnique();
            e.HasOne(p => p.Workspace).WithMany().HasForeignKey(p => p.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Team>(e =>
        {
            e.ToTable("teams");
            // Same reasoning as categories: a sub-department may share a name
            // with one under a different department.
            e.HasIndex(t => new { t.WorkspaceId, t.ParentId, t.Name }).IsUnique();
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.Parent).WithMany(t => t.Children).HasForeignKey(t => t.ParentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TeamMember>(e =>
        {
            e.ToTable("team_members");
            e.HasKey(m => new { m.TeamId, m.UserId });
            e.HasOne(m => m.Team).WithMany(t => t.Members).HasForeignKey(m => m.TeamId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Tag>(e =>
        {
            e.ToTable("tags");
            e.HasIndex(t => new { t.WorkspaceId, t.Name }).IsUnique();
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TicketTag>(e =>
        {
            e.ToTable("ticket_tags");
            e.HasKey(tt => new { tt.TicketId, tt.TagId });
            e.HasOne(tt => tt.Ticket).WithMany(t => t.TicketTags).HasForeignKey(tt => tt.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(tt => tt.Tag).WithMany().HasForeignKey(tt => tt.TagId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Problem>(e =>
        {
            e.ToTable("problems");
            e.HasIndex(p => new { p.WorkspaceId, p.Status });
            e.Property(p => p.Status).HasDefaultValue(ProblemStatus.Investigating);
            e.HasOne(p => p.Workspace).WithMany().HasForeignKey(p => p.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(p => p.Assignee).WithMany().HasForeignKey(p => p.AssigneeId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(p => p.CreatedByUser).WithMany().HasForeignKey(p => p.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Attachment>(e =>
        {
            e.ToTable("attachments");
            e.HasIndex(a => a.TicketId);
            e.HasOne(a => a.Workspace).WithMany().HasForeignKey(a => a.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.Ticket).WithMany().HasForeignKey(a => a.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.Comment).WithMany().HasForeignKey(a => a.CommentId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.UploadedByUser).WithMany().HasForeignKey(a => a.UploadedBy)
                .OnDelete(DeleteBehavior.SetNull);
        });
    }
}
