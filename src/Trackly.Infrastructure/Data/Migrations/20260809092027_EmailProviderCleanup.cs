using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Drops the SMTP and mailbox columns `20260808170000_EmailProviders`
    /// deliberately left behind. This is the second half of that migration, one
    /// release later, exactly as it was written to be.
    ///
    /// **`Down` restores the columns but not their contents.** Nothing else can:
    /// the passwords were encrypted and never shown to anyone, so there is no
    /// copy to put back. Rolling this migration back leaves an installation with
    /// the shape of its old configuration and none of the credentials — which is
    /// the whole reason the drop waited a release. Take a database backup before
    /// applying it, and do not apply it in the same deployment as the release
    /// that introduced providers.
    ///
    /// The carry-forward below runs first and is not a re-run of Phase 1's. It
    /// covers one gap Phase 1 could not: `PUT /api/admin/settings/email` stayed
    /// live until this release for the retiring React screen, and it wrote these
    /// columns. Anyone who edited email there after Phase 1 has legacy config and
    /// no provider row, and `ResolveSenderAsync` has been quietly falling back to
    /// it — so dropping the columns without this would stop their mail with no
    /// error anywhere.
    /// </summary>
    public partial class EmailProviderCleanup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Only where no `smtp` row exists — Phase 1 already moved everyone it
            // could see, and a second row would violate (workspace_id, provider).
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
                WHERE NOT EXISTS (
                        SELECT 1 FROM email_providers p
                        WHERE p.workspace_id = c.workspace_id AND p.provider = 'smtp')
                  AND ((c.use_shared_smtp = FALSE AND c.smtp_host IS NOT NULL AND c.smtp_host <> '')
                    OR (c.inbound_connector = 'mailbox_poll'
                        AND c.mailbox_host IS NOT NULL AND c.mailbox_host <> ''));
                """);

            // `IS NULL` is doing real work in both statements below. A workspace
            // that has already designated a sender is using it — the legacy
            // columns were dead weight there — and overwriting the designation
            // would silently move its mail onto credentials it stopped using.
            migrationBuilder.Sql(
                """
                UPDATE email_configs c SET sending_provider_id = p.id
                FROM email_providers p
                WHERE p.workspace_id = c.workspace_id AND p.provider = 'smtp'
                  AND c.sending_provider_id IS NULL
                  AND c.use_shared_smtp = FALSE AND c.smtp_host IS NOT NULL AND c.smtp_host <> '';
                """);

            migrationBuilder.Sql(
                """
                UPDATE email_configs c SET receiving_provider_id = p.id
                FROM email_providers p
                WHERE p.workspace_id = c.workspace_id AND p.provider = 'smtp'
                  AND c.receiving_provider_id IS NULL
                  AND c.inbound_connector = 'mailbox_poll'
                  AND c.mailbox_host IS NOT NULL AND c.mailbox_host <> '';
                """);

            migrationBuilder.DropColumn(
                name: "mailbox_address",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_host",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_oauth_tokens_encrypted",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_password_encrypted",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_port",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_protocol",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "mailbox_username",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "smtp_host",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "smtp_password_encrypted",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "smtp_port",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "smtp_use_start_tls",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "smtp_user",
                table: "email_configs");

            migrationBuilder.DropColumn(
                name: "use_shared_smtp",
                table: "email_configs");
        }

        /// <summary>
        /// Restores the columns, empty. See the note on the class: the
        /// credentials are gone and cannot be reconstructed from anything
        /// remaining in the database. A rollback needs a restore.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "mailbox_address",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mailbox_host",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mailbox_oauth_tokens_encrypted",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mailbox_password_encrypted",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "mailbox_port",
                table: "email_configs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mailbox_protocol",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "mailbox_username",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "smtp_host",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "smtp_password_encrypted",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "smtp_port",
                table: "email_configs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "smtp_use_start_tls",
                table: "email_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "smtp_user",
                table: "email_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "use_shared_smtp",
                table: "email_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }
    }
}
