using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class Phase3GuestBranding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "workspace_branding",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    logo_storage_key = table.Column<string>(type: "text", nullable: true),
                    logo_content_type = table.Column<string>(type: "text", nullable: true),
                    primary_color = table.Column<string>(type: "text", nullable: false, defaultValue: "#2563EB"),
                    page_title = table.Column<string>(type: "text", nullable: true),
                    welcome_text = table.Column<string>(type: "text", nullable: true),
                    footer_text = table.Column<string>(type: "text", nullable: true),
                    hide_powered_by = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspace_branding", x => x.id);
                    table.ForeignKey(
                        name: "fk_workspace_branding_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workspace_invitations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<string>(type: "text", nullable: false),
                    token_hash = table.Column<string>(type: "text", nullable: false),
                    invited_by = table.Column<Guid>(type: "uuid", nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    accepted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspace_invitations", x => x.id);
                    table.ForeignKey(
                        name: "fk_workspace_invitations_users_invited_by",
                        column: x => x.invited_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_workspace_invitations_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_workspace_branding_workspace_id",
                table: "workspace_branding",
                column: "workspace_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workspace_invitations_invited_by",
                table: "workspace_invitations",
                column: "invited_by");

            migrationBuilder.CreateIndex(
                name: "ix_workspace_invitations_token_hash",
                table: "workspace_invitations",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workspace_invitations_workspace_id_email",
                table: "workspace_invitations",
                columns: new[] { "workspace_id", "email" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "workspace_branding");

            migrationBuilder.DropTable(
                name: "workspace_invitations");
        }
    }
}
