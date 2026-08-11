using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddReleases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "work_item_url_template",
                table: "workspaces",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "pipeline_url",
                table: "business_services",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "releases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<string>(type: "text", nullable: false),
                    title = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "planning"),
                    scheduled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    release_manager_id = table.Column<Guid>(type: "uuid", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    rollback_plan = table.Column<string>(type: "text", nullable: true),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    released_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_releases", x => x.id);
                    table.ForeignKey(
                        name: "fk_releases_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_releases_users_release_manager_id",
                        column: x => x.release_manager_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_releases_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "release_activities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    release_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "text", nullable: false),
                    detail = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_release_activities", x => x.id);
                    table.ForeignKey(
                        name: "fk_release_activities_releases_release_id",
                        column: x => x.release_id,
                        principalTable: "releases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_release_activities_users_actor_id",
                        column: x => x.actor_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "release_components",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    release_id = table.Column<Guid>(type: "uuid", nullable: false),
                    service_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    build_version = table.Column<string>(type: "text", nullable: true),
                    pipeline_url = table.Column<string>(type: "text", nullable: true),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sequence = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "pending"),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_by = table.Column<Guid>(type: "uuid", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_release_components", x => x.id);
                    table.ForeignKey(
                        name: "fk_release_components_business_services_service_id",
                        column: x => x.service_id,
                        principalTable: "business_services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_release_components_releases_release_id",
                        column: x => x.release_id,
                        principalTable: "releases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_release_components_users_completed_by",
                        column: x => x.completed_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_release_components_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "release_steps",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "text", nullable: false, defaultValue: "manual"),
                    title = table.Column<string>(type: "text", nullable: false),
                    body = table.Column<string>(type: "text", nullable: true),
                    target_env = table.Column<string>(type: "text", nullable: true),
                    url = table.Column<string>(type: "text", nullable: true),
                    sequence = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "pending"),
                    done_by = table.Column<Guid>(type: "uuid", nullable: true),
                    done_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    result = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_release_steps", x => x.id);
                    table.ForeignKey(
                        name: "fk_release_steps_release_components_component_id",
                        column: x => x.component_id,
                        principalTable: "release_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_release_steps_users_done_by",
                        column: x => x.done_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "release_work_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    release_id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<Guid>(type: "uuid", nullable: true),
                    external_key = table.Column<string>(type: "text", nullable: true),
                    external_url = table.Column<string>(type: "text", nullable: true),
                    ticket_id = table.Column<Guid>(type: "uuid", nullable: true),
                    title = table.Column<string>(type: "text", nullable: false),
                    test_status = table.Column<string>(type: "text", nullable: false, defaultValue: "not_tested"),
                    tested_by = table.Column<Guid>(type: "uuid", nullable: true),
                    tested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    test_notes = table.Column<string>(type: "text", nullable: true),
                    verify_status = table.Column<string>(type: "text", nullable: false, defaultValue: "not_tested"),
                    verified_by = table.Column<Guid>(type: "uuid", nullable: true),
                    verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    sequence = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_release_work_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_release_work_items_release_components_component_id",
                        column: x => x.component_id,
                        principalTable: "release_components",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_release_work_items_releases_release_id",
                        column: x => x.release_id,
                        principalTable: "releases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_release_work_items_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_release_work_items_users_tested_by",
                        column: x => x.tested_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_release_work_items_users_verified_by",
                        column: x => x.verified_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_release_activities_actor_id",
                table: "release_activities",
                column: "actor_id");

            migrationBuilder.CreateIndex(
                name: "ix_release_activities_release_id_created_at",
                table: "release_activities",
                columns: new[] { "release_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_release_components_completed_by",
                table: "release_components",
                column: "completed_by");

            migrationBuilder.CreateIndex(
                name: "ix_release_components_owner_id",
                table: "release_components",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_release_components_release_id_sequence",
                table: "release_components",
                columns: new[] { "release_id", "sequence" });

            migrationBuilder.CreateIndex(
                name: "ix_release_components_service_id",
                table: "release_components",
                column: "service_id");

            migrationBuilder.CreateIndex(
                name: "ix_release_steps_component_id_sequence",
                table: "release_steps",
                columns: new[] { "component_id", "sequence" });

            migrationBuilder.CreateIndex(
                name: "ix_release_steps_done_by",
                table: "release_steps",
                column: "done_by");

            migrationBuilder.CreateIndex(
                name: "ix_release_work_items_component_id",
                table: "release_work_items",
                column: "component_id");

            migrationBuilder.CreateIndex(
                name: "ix_release_work_items_release_id_sequence",
                table: "release_work_items",
                columns: new[] { "release_id", "sequence" });

            migrationBuilder.CreateIndex(
                name: "ix_release_work_items_tested_by",
                table: "release_work_items",
                column: "tested_by");

            migrationBuilder.CreateIndex(
                name: "ix_release_work_items_ticket_id",
                table: "release_work_items",
                column: "ticket_id");

            migrationBuilder.CreateIndex(
                name: "ix_release_work_items_verified_by",
                table: "release_work_items",
                column: "verified_by");

            migrationBuilder.CreateIndex(
                name: "ix_releases_created_by",
                table: "releases",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_releases_release_manager_id",
                table: "releases",
                column: "release_manager_id");

            migrationBuilder.CreateIndex(
                name: "ix_releases_workspace_id_scheduled_at",
                table: "releases",
                columns: new[] { "workspace_id", "scheduled_at" });

            migrationBuilder.CreateIndex(
                name: "ix_releases_workspace_id_status",
                table: "releases",
                columns: new[] { "workspace_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "release_activities");

            migrationBuilder.DropTable(
                name: "release_steps");

            migrationBuilder.DropTable(
                name: "release_work_items");

            migrationBuilder.DropTable(
                name: "release_components");

            migrationBuilder.DropTable(
                name: "releases");

            migrationBuilder.DropColumn(
                name: "work_item_url_template",
                table: "workspaces");

            migrationBuilder.DropColumn(
                name: "pipeline_url",
                table: "business_services");
        }
    }
}
