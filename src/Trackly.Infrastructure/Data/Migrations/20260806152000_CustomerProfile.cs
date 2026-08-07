using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Gives a customer a profile: company, location, and a free-form
    /// <c>custom_fields</c> bag.
    ///
    /// The bag is jsonb rather than a table or a fixed set of columns because
    /// every support desk keeps different things about a customer — account
    /// number, plan, region, warehouse. A fixed schema means a migration per
    /// customer request; a child table buys joins nothing here needs, since the
    /// fields are only ever read and written together with their user.
    /// </summary>
    /// <remarks>
    /// Hand-written (see AllowTicketWithoutRequester for why) and written
    /// idempotently, so it is safe whether or not the columns were already added
    /// by hand to a running dev database.
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260806152000_CustomerProfile")]
    public partial class CustomerProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS company text;");
            migrationBuilder.Sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS location text;");
            migrationBuilder.Sql(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE users DROP COLUMN IF EXISTS custom_fields;");
            migrationBuilder.Sql("ALTER TABLE users DROP COLUMN IF EXISTS location;");
            migrationBuilder.Sql("ALTER TABLE users DROP COLUMN IF EXISTS company;");
        }
    }
}
