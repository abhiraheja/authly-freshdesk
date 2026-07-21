using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;

namespace Trackly.Infrastructure.Data;

public class TracklyDbContext(DbContextOptions<TracklyDbContext> options) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<EmailToken> EmailTokens => Set<EmailToken>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<TicketAssignment> TicketAssignments => Set<TicketAssignment>();
    public DbSet<TicketWatcher> TicketWatchers => Set<TicketWatcher>();
    public DbSet<Attachment> Attachments => Set<Attachment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Workspace>(e =>
        {
            e.ToTable("workspaces");
            e.HasIndex(w => w.Slug).IsUnique();
            e.Property(w => w.EmailLoginEnabled).HasDefaultValue(true);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users", t =>
                t.HasCheckConstraint("email_or_phone", "email IS NOT NULL OR phone IS NOT NULL"));
            e.HasIndex(u => new { u.WorkspaceId, u.Email }).IsUnique();
            e.Property(u => u.Role).HasDefaultValue(TracklyRoles.Customer);
            e.Property(u => u.IsActive).HasDefaultValue(true);
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

        modelBuilder.Entity<Ticket>(e =>
        {
            e.ToTable("tickets", t =>
                t.HasCheckConstraint("requester_or_guest",
                    "requester_id IS NOT NULL OR guest_email IS NOT NULL"));
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
