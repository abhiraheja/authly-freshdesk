using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class WidgetReshape : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_widget_configs_workspace_id",
                table: "widget_configs");

            migrationBuilder.AddColumn<string>(
                name: "allowed_origins",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "greeting",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "hide_launcher",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "identity_verification_enabled",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // The four below default to TRUE, unlike every other new boolean:
            // that is what the entity's own initialisers say, and it is what the
            // existing row has to end up with. A widget that came out of this
            // migration switched off, with no form and no close button, would be
            // a working embed silently going dark on upgrade.
            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "launch_widget",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "name",
                table: "widget_configs",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "primary_color",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "public_token",
                table: "widget_configs",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "require_email_verification",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "secret_key_encrypted",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "show_close_button",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "show_send_button",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "show_widget_form",
                table: "widget_configs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "tagline",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "team_id",
                table: "widget_configs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "widget_visitor_id",
                table: "tickets",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "widget_visitors",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    widget_id = table.Column<Guid>(type: "uuid", nullable: false),
                    visitor_token_hash = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    external_id = table.Column<string>(type: "text", nullable: true),
                    is_verified = table.Column<bool>(type: "boolean", nullable: false),
                    variables = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_widget_visitors", x => x.id);
                    table.ForeignKey(
                        name: "fk_widget_visitors_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_widget_visitors_widget_configs_widget_id",
                        column: x => x.widget_id,
                        principalTable: "widget_configs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_widget_visitors_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Backfill, and it must run BEFORE the unique index below: every
            // existing row was added with public_token = '' by the AddColumn
            // above, so a second workspace's row would collide on the empty
            // string and the migration would fail on a populated database.
            //
            // The token is public — it sits in the page source of every embed —
            // so md5 of the row id is fine as a source of digits. `translate`
            // only removes the two glyphs that are unreadable when someone
            // retypes a token from a screenshot, matching TokenUtils.
            migrationBuilder.Sql("""
                UPDATE widget_configs w
                SET public_token = translate(substr(md5(random()::text || w.id::text), 1, 12), '01', 'xy'),
                    name = COALESCE(NULLIF(ws.name, ''), 'Support')
                FROM workspaces ws
                WHERE ws.id = w.workspace_id AND w.public_token = '';
                """);

            migrationBuilder.CreateIndex(
                name: "ix_widget_configs_public_token",
                table: "widget_configs",
                column: "public_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_widget_configs_team_id",
                table: "widget_configs",
                column: "team_id");

            migrationBuilder.CreateIndex(
                name: "ix_widget_configs_workspace_id",
                table: "widget_configs",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_widget_visitor_id",
                table: "tickets",
                column: "widget_visitor_id",
                filter: "widget_visitor_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_widget_visitors_user_id",
                table: "widget_visitors",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_widget_visitors_visitor_token_hash",
                table: "widget_visitors",
                column: "visitor_token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_widget_visitors_widget_id_external_id",
                table: "widget_visitors",
                columns: new[] { "widget_id", "external_id" });

            migrationBuilder.CreateIndex(
                name: "ix_widget_visitors_workspace_id_user_id",
                table: "widget_visitors",
                columns: new[] { "workspace_id", "user_id" });

            migrationBuilder.AddForeignKey(
                name: "fk_tickets_widget_visitors_widget_visitor_id",
                table: "tickets",
                column: "widget_visitor_id",
                principalTable: "widget_visitors",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "fk_widget_configs_teams_team_id",
                table: "widget_configs",
                column: "team_id",
                principalTable: "teams",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_tickets_widget_visitors_widget_visitor_id",
                table: "tickets");

            migrationBuilder.DropForeignKey(
                name: "fk_widget_configs_teams_team_id",
                table: "widget_configs");

            migrationBuilder.DropTable(
                name: "widget_visitors");

            migrationBuilder.DropIndex(
                name: "ix_widget_configs_public_token",
                table: "widget_configs");

            migrationBuilder.DropIndex(
                name: "ix_widget_configs_team_id",
                table: "widget_configs");

            migrationBuilder.DropIndex(
                name: "ix_widget_configs_workspace_id",
                table: "widget_configs");

            migrationBuilder.DropIndex(
                name: "ix_tickets_widget_visitor_id",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "allowed_origins",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "greeting",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "hide_launcher",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "identity_verification_enabled",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "is_active",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "launch_widget",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "name",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "primary_color",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "public_token",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "require_email_verification",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "secret_key_encrypted",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "show_close_button",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "show_send_button",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "show_widget_form",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "tagline",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "team_id",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "widget_visitor_id",
                table: "tickets");

            migrationBuilder.CreateIndex(
                name: "ix_widget_configs_workspace_id",
                table: "widget_configs",
                column: "workspace_id",
                unique: true);
        }
    }
}
