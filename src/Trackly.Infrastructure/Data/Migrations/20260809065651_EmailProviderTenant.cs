using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Which directory a tenant-scoped OAuth handshake goes through.
    ///
    /// Microsoft only, and not an optional nicety there: Entra refuses the
    /// `/common` endpoint with `AADSTS50194` for any app registered as "Accounts
    /// in this organizational directory only" after 15 Oct 2018 — which is the
    /// default an operator gets when registering an app for their own company.
    /// Without this column the Microsoft card can only ever connect a
    /// multi-tenant registration.
    ///
    /// Nullable and plaintext on purpose. Null means `common`, which is correct
    /// for a multi-tenant app and is the only value that also admits personal
    /// Outlook.com accounts; and a tenant ID is not a secret — it appears in every
    /// sign-in URL — so invariant 3 does not apply to it.
    /// </summary>
    public partial class EmailProviderTenant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "oauth_tenant_id",
                table: "email_providers",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "oauth_tenant_id",
                table: "email_providers");
        }
    }
}
