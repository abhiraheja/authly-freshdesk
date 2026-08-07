using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
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
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<WorkspaceBranding> WorkspaceBrandings => Set<WorkspaceBranding>();
    public DbSet<WorkspaceInvitation> WorkspaceInvitations => Set<WorkspaceInvitation>();
    public DbSet<EmailConfig> EmailConfigs => Set<EmailConfig>();
    public DbSet<StorageConfig> StorageConfigs => Set<StorageConfig>();
    public DbSet<NotificationSettings> NotificationSettings => Set<NotificationSettings>();
    public DbSet<InboundEmailEvent> InboundEmailEvents => Set<InboundEmailEvent>();
    public DbSet<SsoConnection> SsoConnections => Set<SsoConnection>();
    public DbSet<SsoGroupRoleMapping> SsoGroupRoleMappings => Set<SsoGroupRoleMapping>();
    public DbSet<UserIdentity> UserIdentities => Set<UserIdentity>();
    public DbSet<WorkspaceDomain> WorkspaceDomains => Set<WorkspaceDomain>();
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
            e.HasIndex(c => new { c.WorkspaceId, c.Name }).IsUnique();
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
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
            e.Property(t => t.Status).HasDefaultValue(TicketStatus.Open);
            e.Property(t => t.Priority).HasDefaultValue(TicketPriority.Medium);
            e.Property(t => t.Channel).HasDefaultValue(TicketChannel.Web);
            e.HasIndex(t => new { t.WorkspaceId, t.Status });
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
            // SetNull, not Cascade: deactivating and removing an agent must not
            // take the resolution of every ticket they ever closed with them.
            e.HasOne(t => t.ResolvedBy).WithMany().HasForeignKey(t => t.ResolvedById)
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

        modelBuilder.Entity<Comment>(e =>
        {
            e.ToTable("comments");
            e.Property(c => c.IsInternal).HasDefaultValue(false);
            e.Property(c => c.Source).HasDefaultValue(CommentSource.Web);
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
            e.Property(c => c.UseSharedSmtp).HasDefaultValue(true);
            e.Property(c => c.SmtpUseStartTls).HasDefaultValue(true);
            e.Property(c => c.EmailMode).HasDefaultValue(EmailMode.NotificationsOnly);
            e.Property(c => c.NewTicketViaEmail).HasDefaultValue(false);
            e.Property(c => c.PollIntervalSeconds).HasDefaultValue(60);
            e.HasOne(c => c.Workspace).WithMany().HasForeignKey(c => c.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
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
            // One active SSO connection per workspace (switchable).
            e.HasIndex(c => c.WorkspaceId).IsUnique();
            e.Property(c => c.Status).HasDefaultValue(SsoStatus.Pending);
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

        modelBuilder.Entity<WorkspaceDomain>(e =>
        {
            e.ToTable("workspace_domains");
            e.HasIndex(d => d.Domain).IsUnique();  // globally unique
            e.Property(d => d.Discoverable).HasDefaultValue(true);
            e.Property(d => d.Verified).HasDefaultValue(false);
            e.HasOne(d => d.Workspace).WithMany().HasForeignKey(d => d.WorkspaceId)
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
            e.HasIndex(w => w.WorkspaceId).IsUnique();
            e.Property(w => w.EmbedType).HasDefaultValue(WidgetEmbedType.Floating);
            e.Property(w => w.Theme).HasDefaultValue("light");
            e.HasOne(w => w.Workspace).WithMany().HasForeignKey(w => w.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
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
            e.HasIndex(t => new { t.WorkspaceId, t.Name }).IsUnique();
            e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
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
