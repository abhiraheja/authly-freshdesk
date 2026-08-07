using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Comments can now hold formatted text.
    ///
    /// A column rather than sniffing the body: "&lt;3 that fix" is valid plain
    /// text and valid-looking markup, and guessing wrong renders a customer's
    /// words as a broken tag. Defaulting to 'text' also means every row written
    /// before this migration keeps rendering exactly as it always has.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807070000_RichCommentBodies")]
    public partial class RichCommentBodies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE comments ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'text';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE comments DROP COLUMN IF EXISTS body_format;");
        }
    }
}
