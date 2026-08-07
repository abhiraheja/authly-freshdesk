using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops the `requester_or_guest` CHECK so a ticket can exist with neither a
    /// requester nor guest details.
    ///
    /// The constraint encoded "every ticket has someone to reply to", which held
    /// while tickets only arrived from customers. It stopped being true once an
    /// agent could raise one from inside Trackly: a logged phone call, an
    /// internal request, anything where the person is identified afterwards. The
    /// alternative was defaulting the requester to the agent, which made those
    /// tickets read as the agent's own support requests and left no empty slot
    /// for the real customer to be linked into.
    ///
    /// Nothing depended on the guarantee — every customer-facing send in
    /// NotificationService already returns early on a null email.
    /// </summary>
    /// <remarks>
    /// Hand-written, so the attributes that a scaffolded migration gets from its
    /// Designer file are declared here instead. There is no BuildTargetModel:
    /// `database update` reads the ModelSnapshot (updated alongside this), and
    /// only per-migration model diffing would need one.
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260806150500_AllowTicketWithoutRequester")]
    public partial class AllowTicketWithoutRequester : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // IF EXISTS rather than DropCheckConstraint: the constraint may
            // already have been dropped by hand to unblock a running dev
            // database, and a migration that only works on one of the two
            // possible starting states is a migration that will fail somewhere.
            migrationBuilder.Sql("ALTER TABLE tickets DROP CONSTRAINT IF EXISTS requester_or_guest;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rolling back cannot succeed while any ticket has neither, which is
            // the point: the data written under this migration is not expressible
            // in the old schema.
            migrationBuilder.AddCheckConstraint(
                name: "requester_or_guest",
                table: "tickets",
                sql: "requester_id IS NOT NULL OR guest_email IS NOT NULL");
        }
    }
}
