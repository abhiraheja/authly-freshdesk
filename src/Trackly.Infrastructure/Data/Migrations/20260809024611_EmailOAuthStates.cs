using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Correlation rows for an in-flight mail OAuth handshake — the same table
    /// `sso_login_states` is, for a mailbox rather than a person.
    ///
    /// Deliberately held back until Phase 2 rather than shipped empty with the
    /// provider table: schema with no code path is schema nobody can review
    /// against a caller.
    /// </summary>
    public partial class EmailOAuthStates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "email_oauth_states",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    code_verifier = table.Column<string>(type: "text", nullable: false),
                    return_url = table.Column<string>(type: "text", nullable: true),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_email_oauth_states", x => x.id);
                    table.ForeignKey(
                        name: "fk_email_oauth_states_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_email_oauth_states_expires_at",
                table: "email_oauth_states",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_email_oauth_states_state",
                table: "email_oauth_states",
                column: "state",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_email_oauth_states_workspace_id",
                table: "email_oauth_states",
                column: "workspace_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "email_oauth_states");
        }
    }
}
