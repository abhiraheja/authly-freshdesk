using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class BrandingSurfaces : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "sign_in_image_content_type",
                table: "workspace_branding",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "sign_in_image_storage_key",
                table: "workspace_branding",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "logo_content_type",
                table: "widget_configs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "logo_storage_key",
                table: "widget_configs",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "sign_in_image_content_type",
                table: "workspace_branding");

            migrationBuilder.DropColumn(
                name: "sign_in_image_storage_key",
                table: "workspace_branding");

            migrationBuilder.DropColumn(
                name: "logo_content_type",
                table: "widget_configs");

            migrationBuilder.DropColumn(
                name: "logo_storage_key",
                table: "widget_configs");
        }
    }
}
