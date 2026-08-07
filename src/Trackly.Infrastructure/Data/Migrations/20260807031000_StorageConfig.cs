using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Per-workspace attachment storage: local disk (the default), Azure Blob,
    /// or Google Cloud Storage.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Azure and GCS credentials get their own columns rather than sharing one
    /// "credentials" blob, so switching provider leaves the previous one's
    /// credentials in place. Storage keys carry a provider prefix, and reads
    /// route on that prefix rather than on the current setting — which means a
    /// workspace that moves to Azure can still serve every file it wrote to
    /// local disk beforehand. One shared column would make that impossible and
    /// would orphan the whole attachment history on the first switch.
    /// </para>
    /// <para>
    /// Hand-written and idempotent, for the same reason as the migrations before
    /// it: the debugger holds the build output, so `dotnet ef` can't run.
    /// </para>
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807031000_StorageConfig")]
    public partial class StorageConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS storage_configs (
                    id                                uuid        NOT NULL,
                    workspace_id                      uuid        NOT NULL,
                    provider                          text        NOT NULL DEFAULT 'local',
                    azure_connection_string_encrypted text        NULL,
                    azure_container                   text        NULL,
                    gcs_credentials_json_encrypted    text        NULL,
                    gcs_bucket                        text        NULL,
                    path_prefix                       text        NULL,
                    public_base_url                   text        NULL,
                    last_verified_at                  timestamptz NULL,
                    updated_at                        timestamptz NOT NULL DEFAULT now(),
                    CONSTRAINT pk_storage_configs PRIMARY KEY (id),
                    CONSTRAINT fk_storage_configs_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
                );
                """);

            // Added after the table shipped to a dev database, so they are
            // applied separately as well as being in the CREATE above.
            migrationBuilder.Sql("ALTER TABLE storage_configs ADD COLUMN IF NOT EXISTS public_base_url text;");
            migrationBuilder.Sql("ALTER TABLE storage_configs ADD COLUMN IF NOT EXISTS path_prefix text;");

            // A two-bucket design was tried and dropped: one bucket holds both,
            // and only a "-public" storage key is ever given a CDN URL.
            migrationBuilder.Sql("ALTER TABLE storage_configs DROP COLUMN IF EXISTS azure_public_container;");
            migrationBuilder.Sql("ALTER TABLE storage_configs DROP COLUMN IF EXISTS gcs_public_bucket;");

            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_storage_configs_workspace_id ON storage_configs (workspace_id);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS storage_configs;");
        }
    }
}
