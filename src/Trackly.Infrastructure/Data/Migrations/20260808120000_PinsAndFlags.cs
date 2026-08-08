using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Two ways to say a ticket matters, and they are not the same thing.
    ///
    /// A <b>pin</b> is one agent's private bookmark: a row per agent per ticket,
    /// sorting to the top of THEIR list, invisible to everybody else. A
    /// <b>flag</b> is a column on the ticket: shared, visible to the team, and
    /// clearable by anyone.
    ///
    /// Collapsing them would break both — a shared pin means one agent tidying
    /// their queue reorders everybody's, and a private flag means nobody can be
    /// told a ticket is important.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260808120000_PinsAndFlags")]
    public partial class PinsAndFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_pins (
                    ticket_id uuid NOT NULL,
                    agent_id  uuid NOT NULL,
                    pinned_at timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_pins PRIMARY KEY (ticket_id, agent_id),
                    CONSTRAINT fk_ticket_pins_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    -- Cascade: a pin is one person's bookmark and means nothing
                    -- without them. Unlike a time entry it is not a record of work.
                    CONSTRAINT fk_ticket_pins_users_agent_id
                        FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """);
            // "My pins, newest first" — the only query that does not start from a
            // ticket, and what the list sorts by.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_pins_agent_id_pinned_at "
                + "ON ticket_pins (agent_id, pinned_at);");

            // NULL = not flagged. One column carrying both the state and when it
            // happened, so the two cannot contradict each other.
            migrationBuilder.Sql(
                "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS flagged_at timestamp with time zone;");
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS flagged_by_id uuid;");
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS flag_reason text;");
            migrationBuilder.Sql(
                """
                DO $$ BEGIN
                    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_users_flagged_by_id
                        FOREIGN KEY (flagged_by_id) REFERENCES users(id) ON DELETE SET NULL;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_tickets_flagged_by_id ON tickets (flagged_by_id);");

            // Partial: flagged tickets are a handful out of the whole table, and
            // the list filter reads exactly this.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_tickets_workspace_id_flagged_at "
                + "ON tickets (workspace_id, flagged_at) WHERE flagged_at IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_pins;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_tickets_workspace_id_flagged_at;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS flag_reason;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS flagged_by_id;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS flagged_at;");
        }
    }
}
