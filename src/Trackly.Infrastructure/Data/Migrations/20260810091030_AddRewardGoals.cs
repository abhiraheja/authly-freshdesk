using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRewardGoals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "reward_goals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    metric = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    target = table.Column<int>(type: "integer", nullable: false),
                    period = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    points = table.Column<int>(type: "integer", nullable: false),
                    tier = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    minimum_sample = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_reward_goals", x => x.id);
                    table.ForeignKey(
                        name: "fk_reward_goals_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "agent_reward_awards",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    goal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    agent_id = table.Column<Guid>(type: "uuid", nullable: false),
                    period_key = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    value = table.Column<int>(type: "integer", nullable: false),
                    points = table.Column<int>(type: "integer", nullable: false),
                    awarded_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_agent_reward_awards", x => x.id);
                    table.ForeignKey(
                        name: "fk_agent_reward_awards_reward_goals_goal_id",
                        column: x => x.goal_id,
                        principalTable: "reward_goals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_agent_reward_awards_users_agent_id",
                        column: x => x.agent_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_agent_reward_awards_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_agent_reward_awards_agent_id_awarded_at",
                table: "agent_reward_awards",
                columns: new[] { "agent_id", "awarded_at" });

            migrationBuilder.CreateIndex(
                name: "ix_agent_reward_awards_goal_id_agent_id_period_key",
                table: "agent_reward_awards",
                columns: new[] { "goal_id", "agent_id", "period_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_agent_reward_awards_workspace_id",
                table: "agent_reward_awards",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_reward_goals_workspace_id_sort_order",
                table: "reward_goals",
                columns: new[] { "workspace_id", "sort_order" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_reward_awards");

            migrationBuilder.DropTable(
                name: "reward_goals");
        }
    }
}
