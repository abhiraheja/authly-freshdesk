using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Email + password sign-in.
    ///
    /// Written by hand rather than scaffolded: the committed model snapshot was an
    /// empty stub, so `migrations add` had no baseline to diff against and emitted
    /// the entire schema as CreateTable. The four columns below are the real diff.
    /// The snapshot in this change is a correct, regenerated one.
    /// </summary>
    public partial class PasswordLogin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // defaultValue TRUE, and that is load-bearing: it is what existing
            // rows are backfilled with. Defaulting to false would switch password
            // sign-in off for an installation whose email is not proven to work,
            // which is a permanent lockout — exactly what LoginSettingsController
            // refuses to let an admin do by hand.
            migrationBuilder.AddColumn<bool>(
                name: "password_login_enabled",
                table: "workspaces",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "password_hash",
                table: "users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "must_change_password",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Proof that outbound email actually works. Null until a test message
            // is delivered; turning off password sign-in depends on it.
            migrationBuilder.AddColumn<DateTime>(
                name: "last_verified_at",
                table: "email_configs",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "password_login_enabled", table: "workspaces");
            migrationBuilder.DropColumn(name: "password_hash", table: "users");
            migrationBuilder.DropColumn(name: "must_change_password", table: "users");
            migrationBuilder.DropColumn(name: "last_verified_at", table: "email_configs");
        }
    }
}
