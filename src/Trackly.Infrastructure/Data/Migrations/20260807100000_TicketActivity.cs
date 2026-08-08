using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// The ticket audit trail behind the Activity tab.
    ///
    /// Labels are plain text, not foreign keys, and are captured as they read at
    /// the time of the change. An audit trail records what happened: renaming a
    /// status must not rewrite last month's entries into changes nobody made,
    /// and deleting a category must not blank out the rows that mention it.
    ///
    /// No backfill. Tickets that already exist start their history from this
    /// migration, because everything before it was never recorded and inventing
    /// entries from the columns as they stand now would put timestamps and
    /// actors on the trail that are simply wrong.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807100000_TicketActivity")]
    public partial class TicketActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ticket_activities (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    ticket_id    uuid NOT NULL,
                    -- NULL means Trackly did it: automation, an inbound email,
                    -- the SLA clock.
                    actor_id     uuid,
                    type         text NOT NULL,
                    from_label   text,
                    to_label     text,
                    created_at   timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_activities PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_activities_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    -- SetNull, not Cascade: this is the record of what happened
                    -- to the ticket. Removing an agent must not erase the
                    -- changes they made — the row survives and reads as system.
                    CONSTRAINT fk_ticket_activities_users_actor_id
                        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
                );");

            // The feed's only query: one ticket, in order. Nothing filters or
            // searches it, so this one composite index is the whole story.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_activities_ticket_id_created_at "
                + "ON ticket_activities (ticket_id, created_at);");

            // Behind the actor foreign key, so deactivating a user does not scan
            // the table.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_activities_actor_id "
                + "ON ticket_activities (actor_id);");

            // ---- Carried fix, not part of the activity feature ----
            //
            // CustomStatusesAndWorkflow created (workspace_id, from_status_id)
            // and assumed it also served the from_status_id foreign key. It does
            // not: from_status_id is the SECOND column, so the index cannot be
            // used for a lookup on it alone, and EF's model expects one that can.
            //
            // The mismatch was invisible until something called Migrate(), which
            // compares the model against the snapshot and refuses to run at all
            // when they disagree. That is a startup crash, not a slow query, so
            // it is fixed here rather than left for a later migration.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_status_transitions_from_status_id "
                + "ON ticket_status_transitions (from_status_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_activities;");
        }
    }
}
