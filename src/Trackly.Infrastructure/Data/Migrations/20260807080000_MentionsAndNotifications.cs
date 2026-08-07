using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Mentions, the in-app bell, and a third level of comment visibility.
    ///
    /// One migration because they are one feature: naming a colleague in a note
    /// is only useful if it reaches them, and a note that only its author can
    /// read must not pretend to reach anyone.
    ///
    /// <c>comments.visibility</c> backfills to match <c>is_internal</c>, which
    /// stays as the coarse customer-facing flag every existing filter tests.
    /// That is on purpose: invariant 5 is enforced by that boolean today, and
    /// the safe way to add a level is to leave the thing enforcing it alone.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807080000_MentionsAndNotifications")]
    public partial class MentionsAndNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE comments ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';");

            // Backfill: every existing internal note becomes a shared one. It is
            // the only honest reading — "private to me" did not exist when they
            // were written, and every agent could already see them.
            migrationBuilder.Sql(
                "UPDATE comments SET visibility = 'internal' "
                + "WHERE is_internal = true AND visibility = 'public';");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS comment_mentions (
                    comment_id uuid NOT NULL,
                    user_id    uuid NOT NULL,
                    -- Denormalised from the comment so ""tickets where I was
                    -- mentioned"" is one index rather than a join per row.
                    ticket_id  uuid NOT NULL,
                    created_at timestamp with time zone NOT NULL,
                    CONSTRAINT pk_comment_mentions PRIMARY KEY (comment_id, user_id),
                    CONSTRAINT fk_comment_mentions_comments_comment_id
                        FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
                    CONSTRAINT fk_comment_mentions_users_user_id
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    -- NO ACTION: the comment's cascade already clears these, and
                    -- a second cascade path from tickets is one PostgreSQL
                    -- refuses to create.
                    CONSTRAINT fk_comment_mentions_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id)
                );");

            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_comment_mentions_user_id_ticket_id "
                + "ON comment_mentions (user_id, ticket_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_comment_mentions_ticket_id "
                + "ON comment_mentions (ticket_id);");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS notifications (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    user_id      uuid NOT NULL,   -- the recipient
                    type         text NOT NULL,   -- mention | watching | assigned | reply
                    ticket_id    uuid,
                    comment_id   uuid,
                    actor_id     uuid,            -- who caused it; null for the system
                    -- Plain text only. The bell renders it as text, and storing
                    -- markup would need a second sanitised surface.
                    preview      text,
                    read_at      timestamp with time zone,
                    created_at   timestamp with time zone NOT NULL,
                    CONSTRAINT pk_notifications PRIMARY KEY (id),
                    CONSTRAINT fk_notifications_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_notifications_users_user_id
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    -- The ticket going away takes its bell rows with it: a row
                    -- that leads to a 404 is worse than no row.
                    CONSTRAINT fk_notifications_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_notifications_users_actor_id
                        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
                );");

            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_notifications_user_id_created_at "
                + "ON notifications (user_id, created_at);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_notifications_user_id_read_at "
                + "ON notifications (user_id, read_at);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_notifications_workspace_id "
                + "ON notifications (workspace_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_notifications_ticket_id "
                + "ON notifications (ticket_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_notifications_actor_id "
                + "ON notifications (actor_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS notifications;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS comment_mentions;");
            migrationBuilder.Sql("ALTER TABLE comments DROP COLUMN IF EXISTS visibility;");
        }
    }
}
