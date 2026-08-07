using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Workspace-defined statuses, and a workflow that says which moves are legal.
    ///
    /// The design in one line: **a workspace invents statuses; Trackly only ever
    /// reasons about their category.** Five categories, fixed — open, pending,
    /// active, resolved, closed — and every rule in the system (does the SLA
    /// clock run, is a resolution note required, does a CSAT survey go out, does
    /// this count as work in the queue) is written against those, never against a
    /// status name. That is what lets a team add "Estimation required" or
    /// "Awaiting CAB" without Trackly needing to know they exist.
    ///
    /// <c>tickets.status</c> keeps holding a VALUE rather than a foreign key: it
    /// is what automation rules match, what the email and chat connectors write,
    /// and what every row already contains. <c>tickets.status_category</c> is the
    /// denormalised half — the one every query filters on — and the backfill
    /// below fills it from the four values that existed before this migration.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why). Status rows
    /// themselves are seeded lazily by TicketStatusService on first read, so
    /// there is nothing here to keep in step with the defaults in that file.
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807090000_CustomStatusesAndWorkflow")]
    public partial class CustomStatusesAndWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_category text NOT NULL DEFAULT 'open';");

            // Backfill from the four hard-coded statuses. They were named after
            // the categories they now belong to, so this is a straight copy —
            // anything else (there should be nothing) lands in open, which is
            // the safe direction: it stays in the queue rather than vanishing
            // from it.
            migrationBuilder.Sql(@"
                UPDATE tickets
                SET status_category = CASE status
                    WHEN 'pending'  THEN 'pending'
                    WHEN 'resolved' THEN 'resolved'
                    WHEN 'closed'   THEN 'closed'
                    ELSE 'open'
                END;");

            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_tickets_workspace_id_status_category "
                + "ON tickets (workspace_id, status_category);");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ticket_statuses (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    -- open | pending | active | resolved | closed. Fixed set:
                    -- every rule in Trackly is written against it.
                    category     text NOT NULL,
                    -- What lands on the ticket. Stable; never edited.
                    value        text NOT NULL,
                    -- What people read. Safe to change at any time.
                    name         text NOT NULL,
                    color        text,
                    sort_order   integer NOT NULL DEFAULT 0,
                    is_active    boolean NOT NULL DEFAULT true,
                    -- Where a new ticket starts. Exactly one per workspace.
                    is_default   boolean NOT NULL DEFAULT false,
                    -- Shipped with Trackly: renameable, never deletable.
                    is_system    boolean NOT NULL DEFAULT false,
                    CONSTRAINT pk_ticket_statuses PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_statuses_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );");

            // Unique: the value is what sits on every ticket, so two statuses
            // sharing one would be indistinguishable once stored.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_ticket_statuses_workspace_id_value "
                + "ON ticket_statuses (workspace_id, value);");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ticket_status_transitions (
                    id             uuid NOT NULL,
                    workspace_id   uuid NOT NULL,
                    -- NULL means ""from any status"" — Jira's ANY STATUS. A
                    -- workspace that has never touched the workflow is seeded
                    -- entirely with these, which reproduces the old behaviour
                    -- where every status reached every other.
                    from_status_id uuid,
                    to_status_id   uuid NOT NULL,
                    CONSTRAINT pk_ticket_status_transitions PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_status_transitions_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    -- NO ACTION on both: the service removes a status's
                    -- transitions explicitly, and two cascade paths from
                    -- ticket_statuses into this table is a schema PostgreSQL
                    -- will not create.
                    CONSTRAINT fk_ticket_status_transitions_ticket_statuses_from_status_id
                        FOREIGN KEY (from_status_id) REFERENCES ticket_statuses(id),
                    CONSTRAINT fk_ticket_status_transitions_ticket_statuses_to_status_id
                        FOREIGN KEY (to_status_id) REFERENCES ticket_statuses(id)
                );");

            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_status_transitions_workspace_id_from_status_id "
                + "ON ticket_status_transitions (workspace_id, from_status_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_status_transitions_to_status_id "
                + "ON ticket_status_transitions (to_status_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_status_transitions;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_statuses;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_tickets_workspace_id_status_category;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS status_category;");
        }
    }
}
