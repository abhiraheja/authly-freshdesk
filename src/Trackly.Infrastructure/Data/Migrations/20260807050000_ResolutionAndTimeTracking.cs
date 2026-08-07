using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Why a ticket was resolved, and how long it took.
    ///
    /// Two features, one migration, because they meet in the same place: the
    /// resolve dialog asks for the note and the time together, and the server
    /// writes both in one transaction so a ticket can never end up resolved with
    /// its time entry lost.
    ///
    /// <c>resolution_note</c> lives on the ticket rather than only in a comment
    /// so "what was the fix?" is a column, not a search through a thread. The
    /// comment is still written, as the history the field cannot keep once the
    /// ticket is reopened.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807050000_ResolutionAndTimeTracking")]
    public partial class ResolutionAndTimeTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_note text;");
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_link text;");
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_by_id uuid;");

            // Named explicitly so the guarded re-run below can find it: an
            // anonymous FK gets a generated name that differs between databases.
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_users_resolved_by_id')
                    THEN
                        ALTER TABLE tickets
                            ADD CONSTRAINT fk_tickets_users_resolved_by_id
                            FOREIGN KEY (resolved_by_id) REFERENCES users(id) ON DELETE SET NULL;
                    END IF;
                END $$;");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ticket_time_entries (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    ticket_id    uuid NOT NULL,
                    user_id      uuid NOT NULL,
                    minutes      integer NOT NULL,
                    note         text,
                    spent_at     timestamp with time zone NOT NULL,
                    created_at   timestamp with time zone NOT NULL,
                    updated_at   timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_time_entries PRIMARY KEY (id),
                    CONSTRAINT time_entry_minutes_positive CHECK (minutes > 0),
                    CONSTRAINT fk_ticket_time_entries_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_time_entries_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    -- RESTRICT: a user row cannot be removed while their logged
                    -- work still exists. Trackly deactivates people rather than
                    -- deleting them, and this is a record of time already spent.
                    CONSTRAINT fk_ticket_time_entries_users_user_id
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
                );");

            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_time_entries_ticket_id_spent_at "
                + "ON ticket_time_entries (ticket_id, spent_at);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_time_entries_workspace_id_user_id "
                + "ON ticket_time_entries (workspace_id, user_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_time_entries;");
            migrationBuilder.Sql(
                "ALTER TABLE tickets DROP CONSTRAINT IF EXISTS fk_tickets_users_resolved_by_id;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS resolved_by_id;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS resolution_link;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS resolution_note;");
        }
    }
}
