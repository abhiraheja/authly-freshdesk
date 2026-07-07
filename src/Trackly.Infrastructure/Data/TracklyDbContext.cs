using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;

namespace Trackly.Infrastructure.Data;

public class TracklyDbContext(DbContextOptions<TracklyDbContext> options) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<EmailToken> EmailTokens => Set<EmailToken>();

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
    }
}
