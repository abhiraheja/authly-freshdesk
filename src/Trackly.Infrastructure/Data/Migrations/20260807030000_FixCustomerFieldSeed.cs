using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Removes customer_field rows that were seeded with the CHANNEL defaults.
    /// </summary>
    /// <remarks>
    /// <para>
    /// TicketOptionService picked its seed list with a two-way ternary —
    /// "priority ? priorities : channels" — so when customer_field was added as
    /// a third kind it fell through to the channel list. Affected workspaces
    /// show "Web, Email, Widget, Live chat, WhatsApp, Slack, Microsoft Teams"
    /// as customer fields, and because the seeder marks its rows IsSystem they
    /// cannot be deleted from the admin screen either.
    /// </para>
    /// <para>
    /// Deleting on <c>is_system</c> is what makes this safe: customer_field has
    /// no built-ins at all, so every legitimate row is admin-created and carries
    /// <c>is_system = false</c>. A field an admin happened to name "Email"
    /// survives.
    /// </para>
    /// <para>
    /// Data-only, so there is no model change and the snapshot is untouched.
    /// Idempotent — safe to re-run against a database already cleaned by hand.
    /// </para>
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807030000_FixCustomerFieldSeed")]
    public partial class FixCustomerFieldSeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DELETE FROM ticket_options WHERE kind = 'customer_field' AND is_system = true;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately empty: these rows were a bug. Re-creating them on a
            // rollback would put the broken state back.
        }
    }
}
