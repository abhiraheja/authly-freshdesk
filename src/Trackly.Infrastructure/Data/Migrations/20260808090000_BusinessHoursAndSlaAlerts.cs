using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Business hours, holidays, and the two markers that stop the breach sweep
    /// repeating itself.
    ///
    /// **Off by default, and that is the whole migration for an existing
    /// workspace.** No row is created here: <c>BusinessCalendar.For(null)</c>
    /// returns the continuous calendar, so every deadline keeps being computed
    /// exactly as it was until somebody opens the screen and turns it on.
    /// Seeding "9 to 5, Monday to Friday" would silently move every SLA in every
    /// workspace on the day this deployed.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260808090000_BusinessHoursAndSlaAlerts")]
    public partial class BusinessHoursAndSlaAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // One row per workspace, so the workspace id IS the key: no second
            // identifier to keep unique, and nothing that can produce two
            // schedules for one desk.
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS business_hours (
                    workspace_id uuid NOT NULL,
                    is_enabled   boolean NOT NULL DEFAULT false,
                    -- IANA zone. "9am" means the CUSTOMER's 9am; the server may
                    -- be in another hemisphere. Deadlines stay UTC — this only
                    -- decides which UTC instants count as open.
                    time_zone    text NOT NULL DEFAULT 'UTC',
                    CONSTRAINT pk_business_hours PRIMARY KEY (workspace_id),
                    CONSTRAINT fk_business_hours_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );
                """);

            // A row per OPEN window. A closed day is the absence of a row, which
            // is one fewer state that can contradict itself than a flag plus
            // hours would be.
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS business_hour_days (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    day_of_week  integer NOT NULL,   -- 0 = Sunday
                    start_minute integer NOT NULL,   -- minutes from midnight, local
                    end_minute   integer NOT NULL,
                    CONSTRAINT pk_business_hour_days PRIMARY KEY (id),
                    CONSTRAINT fk_business_hour_days_business_hours_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES business_hours(workspace_id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_business_hour_days_workspace_id "
                + "ON business_hour_days (workspace_id);");

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS business_holidays (
                    id           uuid NOT NULL,
                    workspace_id uuid NOT NULL,
                    date         date NOT NULL,
                    name         text,
                    CONSTRAINT pk_business_holidays PRIMARY KEY (id),
                    CONSTRAINT fk_business_holidays_business_hours_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES business_hours(workspace_id) ON DELETE CASCADE
                );
                """);
            // Unique: the same date twice is a duplicate the calendar ignores and
            // the admin screen shows twice.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_business_holidays_workspace_id_date "
                + "ON business_holidays (workspace_id, date);");

            // The breach sweep's memory. Markers rather than a derived check,
            // because "is it late" stays true from the moment it goes late until
            // somebody acts — and a sweep that re-derived it would resend the
            // same warning every minute until the recipient filtered the lot
            // into a folder.
            migrationBuilder.Sql(
                "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_warning_sent_at timestamp with time zone;");
            migrationBuilder.Sql(
                "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breach_sent_at timestamp with time zone;");

            // The sweep's own query: open tickets with a deadline coming up.
            // Partial, because resolved and closed tickets are the majority of
            // the table and never appear in it.
            migrationBuilder.Sql(
                """
                CREATE INDEX IF NOT EXISTS ix_tickets_sla_sweep
                    ON tickets (resolve_due_at, first_response_due_at)
                    WHERE status_category NOT IN ('resolved', 'closed');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_tickets_sla_sweep;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS sla_breach_sent_at;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS sla_warning_sent_at;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS business_holidays;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS business_hour_days;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS business_hours;");
        }
    }
}
