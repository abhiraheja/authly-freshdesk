using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Mail providers as rows rather than one set of SMTP columns.
    ///
    /// **The old `email_configs` columns are deliberately left in place.** They
    /// are dropped a release later, so an installation that rolls back in between
    /// still holds the credentials it was running on — nobody can re-type an SMTP
    /// password they were never able to read.
    ///
    /// **The id must stay after `20260808130000_PasswordLogin`.** The carry-forward
    /// SELECT below reads `email_configs.last_verified_at`, and that column is
    /// added by PasswordLogin. EF generated this migration with a wall-clock id
    /// that sorted *before* two hand-numbered migrations, so it applied cleanly on
    /// a database that already had them and failed on a fresh one with
    /// `42703: column c.last_verified_at does not exist`. Renumber, never renumber
    /// backwards.
    /// </summary>
    public partial class EmailProviders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "receiving_provider_id",
                table: "email_configs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "sending_provider_id",
                table: "email_configs",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "email_providers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "text", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    account_email = table.Column<string>(type: "text", nullable: true),
                    oauth_client_id = table.Column<string>(type: "text", nullable: true),
                    oauth_client_secret_encrypted = table.Column<string>(type: "text", nullable: true),
                    oauth_tokens_encrypted = table.Column<string>(type: "text", nullable: true),
                    oauth_scopes = table.Column<string>(type: "text", nullable: true),
                    smtp_host = table.Column<string>(type: "text", nullable: true),
                    smtp_port = table.Column<int>(type: "integer", nullable: true),
                    smtp_username = table.Column<string>(type: "text", nullable: true),
                    smtp_password_encrypted = table.Column<string>(type: "text", nullable: true),
                    smtp_use_start_tls = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    imap_host = table.Column<string>(type: "text", nullable: true),
                    imap_port = table.Column<int>(type: "integer", nullable: true),
                    imap_username = table.Column<string>(type: "text", nullable: true),
                    imap_password_encrypted = table.Column<string>(type: "text", nullable: true),
                    ses_region = table.Column<string>(type: "text", nullable: true),
                    ses_access_key_id = table.Column<string>(type: "text", nullable: true),
                    ses_secret_key_encrypted = table.Column<string>(type: "text", nullable: true),
                    last_verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "text", nullable: true),
                    last_polled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_email_providers", x => x.id);
                    table.ForeignKey(
                        name: "fk_email_providers_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_email_configs_receiving_provider_id",
                table: "email_configs",
                column: "receiving_provider_id");

            migrationBuilder.CreateIndex(
                name: "ix_email_configs_sending_provider_id",
                table: "email_configs",
                column: "sending_provider_id");

            migrationBuilder.CreateIndex(
                name: "ix_email_providers_workspace_id_provider",
                table: "email_providers",
                columns: new[] { "workspace_id", "provider" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_email_configs_email_providers_receiving_provider_id",
                table: "email_configs",
                column: "receiving_provider_id",
                principalTable: "email_providers",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "fk_email_configs_email_providers_sending_provider_id",
                table: "email_configs",
                column: "sending_provider_id",
                principalTable: "email_providers",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            // ---- Carry existing configuration forward -----------------------
            //
            // An installation whose email works today must not wake up
            // disconnected. Everything below is a straight move of columns that
            // are already populated; ciphertext is copied verbatim, so the stored
            // secrets keep working and are never decrypted here.
            //
            // A workspace on the shared relay with no inbound connector matches
            // neither statement and gets no row — correct, because a null
            // sending_provider_id already means "shared relay".

            // One row per workspace that had its own SMTP or a polled mailbox.
            // Both halves land on the same `smtp` provider: it is one card, and an
            // admin who filled in both was describing one mail account.
            migrationBuilder.Sql(
                """
                INSERT INTO email_providers (
                    id, workspace_id, provider, enabled, account_email,
                    smtp_host, smtp_port, smtp_username, smtp_password_encrypted, smtp_use_start_tls,
                    imap_host, imap_port, imap_username, imap_password_encrypted,
                    last_verified_at, created_at, updated_at)
                SELECT
                    gen_random_uuid(), c.workspace_id, 'smtp', TRUE, c.mailbox_address,
                    c.smtp_host, c.smtp_port, c.smtp_user, c.smtp_password_encrypted,
                    COALESCE(c.smtp_use_start_tls, TRUE),
                    c.mailbox_host, c.mailbox_port, c.mailbox_username, c.mailbox_password_encrypted,
                    c.last_verified_at, now(), now()
                FROM email_configs c
                WHERE (c.use_shared_smtp = FALSE AND c.smtp_host IS NOT NULL AND c.smtp_host <> '')
                   OR (c.inbound_connector = 'mailbox_poll' AND c.mailbox_host IS NOT NULL AND c.mailbox_host <> '');
                """);

            // Point the config at it — sending only where the workspace actually
            // had its own relay, receiving only where it was actually polling.
            migrationBuilder.Sql(
                """
                UPDATE email_configs c SET sending_provider_id = p.id
                FROM email_providers p
                WHERE p.workspace_id = c.workspace_id AND p.provider = 'smtp'
                  AND c.use_shared_smtp = FALSE AND c.smtp_host IS NOT NULL AND c.smtp_host <> '';
                """);

            migrationBuilder.Sql(
                """
                UPDATE email_configs c SET receiving_provider_id = p.id
                FROM email_providers p
                WHERE p.workspace_id = c.workspace_id AND p.provider = 'smtp'
                  AND c.inbound_connector = 'mailbox_poll'
                  AND c.mailbox_host IS NOT NULL AND c.mailbox_host <> '';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_email_configs_email_providers_receiving_provider_id",
                table: "email_configs");

            migrationBuilder.DropForeignKey(
                name: "fk_email_configs_email_providers_sending_provider_id",
                table: "email_configs");

            migrationBuilder.DropTable(
                name: "email_providers");

            migrationBuilder.DropIndex(
                name: "ix_email_configs_receiving_provider_id",
                table: "email_configs");

            migrationBuilder.DropIndex(
                name: "ix_email_configs_sending_provider_id",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "receiving_provider_id",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "sending_provider_id",
                table: "email_configs");
        }
    }
}
