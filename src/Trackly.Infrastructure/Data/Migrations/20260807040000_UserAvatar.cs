using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Profile photos for users and customers.
    ///
    /// <c>avatar_url</c> has existed since InitialCreate and was never read or
    /// written by anything — it was a placeholder for an IdP-supplied picture
    /// URL that never got built. It is renamed rather than left in place, because
    /// what actually goes here is a storage key, and a column called "url"
    /// holding a key is the sort of thing that gets pasted into an &lt;img src&gt;
    /// a year from now. The photo is private: it is served only by
    /// <c>GET /api/users/{id}/avatar</c>, which checks the workspace first.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why), so it is safe
    /// against a dev database where the columns were already added by hand.
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807040000_UserAvatar")]
    public partial class UserAvatar : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // RENAME COLUMN has no IF EXISTS, so it is guarded by hand. The
            // second guard matters as much as the first: without it, re-running
            // after the rename would fail on the column already being gone.
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_name = 'users' AND column_name = 'avatar_url')
                       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                                       WHERE table_name = 'users' AND column_name = 'avatar_storage_key')
                    THEN
                        ALTER TABLE users RENAME COLUMN avatar_url TO avatar_storage_key;
                    END IF;
                END $$;");

            migrationBuilder.Sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_storage_key text;");
            migrationBuilder.Sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_content_type text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE users DROP COLUMN IF EXISTS avatar_content_type;");
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_name = 'users' AND column_name = 'avatar_storage_key')
                       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                                       WHERE table_name = 'users' AND column_name = 'avatar_url')
                    THEN
                        ALTER TABLE users RENAME COLUMN avatar_storage_key TO avatar_url;
                    END IF;
                END $$;");
        }
    }
}
