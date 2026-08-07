using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Related work: the stories, PRs and docs a ticket is about.
    ///
    /// The single <c>resolution_link</c> column stays — it is the link for the
    /// resolution the ticket currently has, and is cleared on reopen. These rows
    /// are the ticket's references, which outlive any one resolution, so the two
    /// are not the same thing and neither replaces the other. The resolve dialog
    /// copies its link into this table so it shows up alongside the rest.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807060000_TicketLinks")]
    public partial class TicketLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ticket_links (
                    id            uuid NOT NULL,
                    workspace_id  uuid NOT NULL,
                    ticket_id     uuid NOT NULL,
                    url           text NOT NULL,
                    title         text,
                    kind          text NOT NULL DEFAULT 'related',
                    created_by_id uuid,
                    created_at    timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_links PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_links_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_links_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    -- SetNull: the link is about the work, not about who filed
                    -- it, so it outlives the agent's account.
                    CONSTRAINT fk_ticket_links_users_created_by_id
                        FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
                );");

            // Unique, so the same URL cannot be added to one ticket twice. Its
            // leading column also serves the card's "links for this ticket" read,
            // which is why there is no separate ticket_id index.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_ticket_links_ticket_id_url "
                + "ON ticket_links (ticket_id, url);");

            // The two remaining foreign keys. EF's model expects an index behind
            // each, and a cascade delete of a workspace or a user scans them.
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_links_workspace_id "
                + "ON ticket_links (workspace_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_links_created_by_id "
                + "ON ticket_links (created_by_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_links;");
        }
    }
}
