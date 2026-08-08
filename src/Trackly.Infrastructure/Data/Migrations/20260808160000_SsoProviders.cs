using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Several identity providers per workspace instead of one.
    ///
    /// "Continue with Google" and "Continue with Microsoft" are two connections,
    /// not two settings on one — so the unique index on workspace_id has to go.
    /// What replaces it is narrower: one row per *well-known* provider, with the
    /// two custom kinds exempt, because two corporate IdPs is a real setup and
    /// two Googles never is.
    ///
    /// Written by hand: the API project is the EF startup project and could not
    /// be built while it was running under a debugger. The columns below are the
    /// diff, and the snapshot in this change is updated to match.
    /// </summary>
    public partial class SsoProviders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_sso_connections_workspace_id",
                table: "sso_connections");

            // The provider *kind* — which endpoints and claim shapes to use.
            // provider_name stays what it always was: the label on the button.
            migrationBuilder.AddColumn<string>(
                name: "provider",
                table: "sso_connections",
                type: "text",
                nullable: false,
                defaultValue: "oidc");

            // Existing rows predate the catalogue, so the only honest thing to
            // call them is by their protocol: a generic OIDC or SAML connection.
            // Runs before the unique index is created, or a workspace holding one
            // of each would collide — it does not, since both land on exempt kinds.
            migrationBuilder.Sql("UPDATE sso_connections SET provider = protocol;");

            migrationBuilder.AddColumn<string>(
                name: "tenant",
                table: "sso_connections",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "scopes",
                table: "sso_connections",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "allowed_email_domains",
                table: "sso_connections",
                type: "text",
                nullable: true);

            // defaultValue true, and load-bearing: an installation whose only way
            // in is SSO must not have its button disappear on migrate.
            migrationBuilder.AddColumn<bool>(
                name: "is_enabled",
                table: "sso_connections",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "show_on_staff_login",
                table: "sso_connections",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // False: before this change SSO was never offered on a branded,
            // customer-facing sign-in, and a migration must not start.
            migrationBuilder.AddColumn<bool>(
                name: "show_on_customer_login",
                table: "sso_connections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "sort_order",
                table: "sso_connections",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "ix_sso_connections_workspace_id_sort_order",
                table: "sso_connections",
                columns: ["workspace_id", "sort_order"]);

            migrationBuilder.CreateIndex(
                name: "ix_sso_connections_workspace_id_provider",
                table: "sso_connections",
                columns: ["workspace_id", "provider"],
                unique: true,
                filter: "provider NOT IN ('oidc', 'saml')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_sso_connections_workspace_id_provider",
                table: "sso_connections");

            migrationBuilder.DropIndex(
                name: "ix_sso_connections_workspace_id_sort_order",
                table: "sso_connections");

            migrationBuilder.DropColumn(name: "sort_order", table: "sso_connections");
            migrationBuilder.DropColumn(name: "show_on_customer_login", table: "sso_connections");
            migrationBuilder.DropColumn(name: "show_on_staff_login", table: "sso_connections");
            migrationBuilder.DropColumn(name: "is_enabled", table: "sso_connections");
            migrationBuilder.DropColumn(name: "allowed_email_domains", table: "sso_connections");
            migrationBuilder.DropColumn(name: "scopes", table: "sso_connections");
            migrationBuilder.DropColumn(name: "tenant", table: "sso_connections");
            migrationBuilder.DropColumn(name: "provider", table: "sso_connections");

            // Going back means one connection per workspace again. Keep the
            // oldest and drop the rest, or the unique index cannot be recreated.
            migrationBuilder.Sql(
                """
                DELETE FROM sso_connections a
                USING sso_connections b
                WHERE a.workspace_id = b.workspace_id
                  AND (a.created_at, a.id) > (b.created_at, b.id);
                """);

            migrationBuilder.CreateIndex(
                name: "ix_sso_connections_workspace_id",
                table: "sso_connections",
                column: "workspace_id",
                unique: true);
        }
    }
}
