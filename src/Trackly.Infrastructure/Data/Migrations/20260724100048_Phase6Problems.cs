using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class Phase6Problems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "problem_id",
                table: "tickets",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "problems",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "text", nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "investigating"),
                    assignee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_problems", x => x.id);
                    table.ForeignKey(
                        name: "fk_problems_users_assignee_id",
                        column: x => x.assignee_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_problems_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_problems_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tickets_problem_id",
                table: "tickets",
                column: "problem_id");

            migrationBuilder.CreateIndex(
                name: "ix_problems_assignee_id",
                table: "problems",
                column: "assignee_id");

            migrationBuilder.CreateIndex(
                name: "ix_problems_created_by",
                table: "problems",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_problems_workspace_id_status",
                table: "problems",
                columns: new[] { "workspace_id", "status" });

            migrationBuilder.AddForeignKey(
                name: "fk_tickets_problems_problem_id",
                table: "tickets",
                column: "problem_id",
                principalTable: "problems",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_tickets_problems_problem_id",
                table: "tickets");

            migrationBuilder.DropTable(
                name: "problems");

            migrationBuilder.DropIndex(
                name: "ix_tickets_problem_id",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "problem_id",
                table: "tickets");
        }
    }
}
