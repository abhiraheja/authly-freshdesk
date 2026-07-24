using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class Phase4Email : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "email_configs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    use_shared_smtp = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    smtp_host = table.Column<string>(type: "text", nullable: true),
                    smtp_port = table.Column<int>(type: "integer", nullable: true),
                    smtp_user = table.Column<string>(type: "text", nullable: true),
                    smtp_password_encrypted = table.Column<string>(type: "text", nullable: true),
                    smtp_use_start_tls = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    from_name = table.Column<string>(type: "text", nullable: true),
                    from_email = table.Column<string>(type: "text", nullable: true),
                    email_mode = table.Column<string>(type: "text", nullable: false, defaultValue: "notifications_only"),
                    new_ticket_via_email = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    inbound_connector = table.Column<string>(type: "text", nullable: true),
                    inbound_provider = table.Column<string>(type: "text", nullable: true),
                    inbound_reply_domain = table.Column<string>(type: "text", nullable: true),
                    inbound_webhook_secret_encrypted = table.Column<string>(type: "text", nullable: true),
                    mailbox_protocol = table.Column<string>(type: "text", nullable: true),
                    mailbox_address = table.Column<string>(type: "text", nullable: true),
                    mailbox_host = table.Column<string>(type: "text", nullable: true),
                    mailbox_port = table.Column<int>(type: "integer", nullable: true),
                    mailbox_username = table.Column<string>(type: "text", nullable: true),
                    mailbox_password_encrypted = table.Column<string>(type: "text", nullable: true),
                    mailbox_oauth_tokens_encrypted = table.Column<string>(type: "text", nullable: true),
                    poll_interval_seconds = table.Column<int>(type: "integer", nullable: false, defaultValue: 60),
                    last_polled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_email_configs", x => x.id);
                    table.ForeignKey(
                        name: "fk_email_configs_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "inbound_email_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    message_id = table.Column<string>(type: "text", nullable: false),
                    ticket_id = table.Column<Guid>(type: "uuid", nullable: true),
                    comment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    outcome = table.Column<string>(type: "text", nullable: false),
                    processed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_inbound_email_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_inbound_email_events_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notification_settings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    notify_customer_on_create = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_customer_on_reply = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_customer_on_status = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_agent_on_assign = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_agent_on_reply = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_agent_on_reassign = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_settings", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_settings_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_email_configs_workspace_id",
                table: "email_configs",
                column: "workspace_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_inbound_email_events_workspace_id_message_id",
                table: "inbound_email_events",
                columns: new[] { "workspace_id", "message_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_settings_workspace_id",
                table: "notification_settings",
                column: "workspace_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "email_configs");

            migrationBuilder.DropTable(
                name: "inbound_email_events");

            migrationBuilder.DropTable(
                name: "notification_settings");
        }
    }
}
