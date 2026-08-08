using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Trackly.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Everything the ticket view was still missing, in one migration because it
    /// is one change: a ticket can now say what it is related to, what has to be
    /// done, who is on it, what it is about, what it broke, and whatever else
    /// this particular workspace tracks.
    ///
    /// Split across six migrations it would be six deploys with a half-built
    /// ticket screen in between, and no single one of them is meaningful alone.
    /// </summary>
    /// <remarks>
    /// Hand-written and idempotent (see CustomerProfile for why).
    /// </remarks>
    [DbContext(typeof(TracklyDbContext))]
    [Migration("20260807110000_TicketDepth")]
    public partial class TicketDepth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- Resolution: the half the customer is allowed to read --------
            migrationBuilder.Sql(
                "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_summary text;");

            // ---- Two-level taxonomies ----------------------------------------
            //
            // Departments and categories gain a parent. Existing rows get NULL,
            // which is exactly right: everything that exists today is top level.
            migrationBuilder.Sql("ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id uuid;");
            migrationBuilder.Sql("ALTER TABLE teams      ADD COLUMN IF NOT EXISTS parent_id uuid;");
            migrationBuilder.Sql(
                """
                DO $$ BEGIN
                    ALTER TABLE categories ADD CONSTRAINT fk_categories_categories_parent_id
                        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
                """);
            migrationBuilder.Sql(
                """
                DO $$ BEGIN
                    ALTER TABLE teams ADD CONSTRAINT fk_teams_teams_parent_id
                        FOREIGN KEY (parent_id) REFERENCES teams(id) ON DELETE CASCADE;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
                """);

            // The name is unique WITHIN a parent, not across the workspace:
            // "Access" is a legitimate sub-category of both Hardware and
            // Software. Postgres treats NULLs as distinct in a unique index, so
            // the old workspace-wide index has to go or two top-level rows could
            // never share a name check with the new one.
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_categories_workspace_id_name;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_teams_workspace_id_name;");
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_categories_workspace_id_parent_id_name "
                + "ON categories (workspace_id, parent_id, name);");
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_teams_workspace_id_parent_id_name "
                + "ON teams (workspace_id, parent_id, name);");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS ix_categories_parent_id ON categories (parent_id);");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS ix_teams_parent_id ON teams (parent_id);");

            // The narrower answer on the ticket. NO ACTION rather than SET NULL:
            // a second cascade path from categories/teams into tickets is a
            // schema PostgreSQL refuses outright, so the services clear these
            // when the parent goes.
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sub_category_id uuid;");
            migrationBuilder.Sql("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sub_team_id uuid;");
            migrationBuilder.Sql(
                """
                DO $$ BEGIN
                    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_categories_sub_category_id
                        FOREIGN KEY (sub_category_id) REFERENCES categories(id) ON DELETE NO ACTION;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
                """);
            migrationBuilder.Sql(
                """
                DO $$ BEGIN
                    ALTER TABLE tickets ADD CONSTRAINT fk_tickets_teams_sub_team_id
                        FOREIGN KEY (sub_team_id) REFERENCES teams(id) ON DELETE NO ACTION;
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
                """);
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS ix_tickets_sub_category_id ON tickets (sub_category_id);");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS ix_tickets_sub_team_id ON tickets (sub_team_id);");

            // ---- Related tickets ---------------------------------------------
            //
            // Stored once per direction and read from both ends: the inverse of a
            // kind is a pure function, so a single row can never disagree with
            // its own mirror image.
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_relations (
                    id                uuid NOT NULL,
                    workspace_id      uuid NOT NULL,
                    ticket_id         uuid NOT NULL,
                    related_ticket_id uuid NOT NULL,
                    kind              text NOT NULL,
                    created_by_id     uuid,
                    created_at        timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_relations PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_relations_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_relations_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    -- NO ACTION: two cascade paths from tickets into one table is
                    -- a schema PostgreSQL will not create.
                    CONSTRAINT fk_ticket_relations_tickets_related_ticket_id
                        FOREIGN KEY (related_ticket_id) REFERENCES tickets(id) ON DELETE NO ACTION,
                    CONSTRAINT fk_ticket_relations_users_created_by_id
                        FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
                );
                """);
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_ticket_relations_ticket_id_related_ticket_id_kind "
                + "ON ticket_relations (ticket_id, related_ticket_id, kind);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_relations_related_ticket_id "
                + "ON ticket_relations (related_ticket_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_relations_workspace_id ON ticket_relations (workspace_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_relations_created_by_id ON ticket_relations (created_by_id);");

            // ---- Tasks --------------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_tasks (
                    id              uuid NOT NULL,
                    workspace_id    uuid NOT NULL,
                    ticket_id       uuid NOT NULL,
                    title           text NOT NULL,
                    assignee_id     uuid,
                    due_at          timestamp with time zone,
                    -- NULL = still open. One column carrying both the flag and
                    -- the timestamp, so they cannot contradict each other.
                    completed_at    timestamp with time zone,
                    completed_by_id uuid,
                    sort_order      integer NOT NULL DEFAULT 0,
                    created_by_id   uuid,
                    created_at      timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_tasks PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_tasks_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_tasks_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_tasks_users_assignee_id
                        FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
                    CONSTRAINT fk_ticket_tasks_users_completed_by_id
                        FOREIGN KEY (completed_by_id) REFERENCES users(id) ON DELETE SET NULL,
                    CONSTRAINT fk_ticket_tasks_users_created_by_id
                        FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_tasks_ticket_id_sort_order "
                + "ON ticket_tasks (ticket_id, sort_order);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_tasks_assignee_id_completed_at "
                + "ON ticket_tasks (assignee_id, completed_at);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_tasks_workspace_id ON ticket_tasks (workspace_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_tasks_completed_by_id ON ticket_tasks (completed_by_id);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_tasks_created_by_id ON ticket_tasks (created_by_id);");

            // ---- Responders ---------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_responders (
                    ticket_id uuid NOT NULL,
                    agent_id  uuid NOT NULL,
                    role      text,
                    added_by  uuid,
                    added_at  timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_responders PRIMARY KEY (ticket_id, agent_id),
                    CONSTRAINT fk_ticket_responders_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_responders_users_agent_id
                        FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_responders_agent_id ON ticket_responders (agent_id);");

            // ---- Assets -------------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    id             uuid NOT NULL,
                    workspace_id   uuid NOT NULL,
                    name           text NOT NULL,
                    kind           text,
                    tag            text,
                    location       text,
                    assigned_to_id uuid,
                    notes          text,
                    is_active      boolean NOT NULL DEFAULT true,
                    created_at     timestamp with time zone NOT NULL,
                    updated_at     timestamp with time zone NOT NULL,
                    CONSTRAINT pk_assets PRIMARY KEY (id),
                    CONSTRAINT fk_assets_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_assets_users_assigned_to_id
                        FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_assets_workspace_id_name ON assets (workspace_id, name);");
            // Sparse: many assets have no tag, but a tag that IS set has to
            // identify exactly one thing or it is not an asset tag.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_assets_workspace_id_tag "
                + "ON assets (workspace_id, tag) WHERE tag IS NOT NULL;");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_assets_assigned_to_id ON assets (assigned_to_id);");

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_assets (
                    ticket_id uuid NOT NULL,
                    asset_id  uuid NOT NULL,
                    added_by  uuid,
                    added_at  timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_assets PRIMARY KEY (ticket_id, asset_id),
                    CONSTRAINT fk_ticket_assets_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_assets_assets_asset_id
                        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_assets_asset_id ON ticket_assets (asset_id);");

            // ---- Services -----------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS business_services (
                    id            uuid NOT NULL,
                    workspace_id  uuid NOT NULL,
                    name          text NOT NULL,
                    description   text,
                    owner_team_id uuid,
                    is_active     boolean NOT NULL DEFAULT true,
                    sort_order    integer NOT NULL DEFAULT 0,
                    created_at    timestamp with time zone NOT NULL,
                    updated_at    timestamp with time zone NOT NULL,
                    CONSTRAINT pk_business_services PRIMARY KEY (id),
                    CONSTRAINT fk_business_services_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    CONSTRAINT fk_business_services_teams_owner_team_id
                        FOREIGN KEY (owner_team_id) REFERENCES teams(id) ON DELETE SET NULL
                );
                """);
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_business_services_workspace_id_name "
                + "ON business_services (workspace_id, name);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_business_services_owner_team_id "
                + "ON business_services (owner_team_id);");

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_impacted_services (
                    ticket_id  uuid NOT NULL,
                    service_id uuid NOT NULL,
                    impact     text,
                    level      text NOT NULL DEFAULT 'degraded',
                    added_by   uuid,
                    added_at   timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_impacted_services PRIMARY KEY (ticket_id, service_id),
                    CONSTRAINT fk_ticket_impacted_services_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_impacted_services_business_services_service_id
                        FOREIGN KEY (service_id) REFERENCES business_services(id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_impacted_services_service_id "
                + "ON ticket_impacted_services (service_id);");

            // ---- Custom properties ---------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_fields (
                    id                uuid NOT NULL,
                    workspace_id      uuid NOT NULL,
                    -- Derived from the label once and never edited: it is what
                    -- every stored answer points at.
                    key               text NOT NULL,
                    label             text NOT NULL,
                    type              text NOT NULL DEFAULT 'text',
                    help_text         text,
                    -- Newline-separated, not JSON: an admin edits this in a
                    -- textarea and a malformed array is a field nobody can fill.
                    options           text,
                    allow_new_options boolean NOT NULL DEFAULT true,
                    is_required       boolean NOT NULL DEFAULT false,
                    sort_order        integer NOT NULL DEFAULT 0,
                    is_active         boolean NOT NULL DEFAULT true,
                    created_at        timestamp with time zone NOT NULL,
                    updated_at        timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_fields PRIMARY KEY (id),
                    CONSTRAINT fk_ticket_fields_workspaces_workspace_id
                        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_ticket_fields_workspace_id_key "
                + "ON ticket_fields (workspace_id, key);");

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS ticket_field_values (
                    ticket_id  uuid NOT NULL,
                    field_id   uuid NOT NULL,
                    value      text NOT NULL,
                    updated_at timestamp with time zone NOT NULL,
                    CONSTRAINT pk_ticket_field_values PRIMARY KEY (ticket_id, field_id),
                    CONSTRAINT fk_ticket_field_values_tickets_ticket_id
                        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
                    CONSTRAINT fk_ticket_field_values_ticket_fields_field_id
                        FOREIGN KEY (field_id) REFERENCES ticket_fields(id) ON DELETE CASCADE
                );
                """);
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_ticket_field_values_field_id_value "
                + "ON ticket_field_values (field_id, value);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_field_values;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_fields;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_impacted_services;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS business_services;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_assets;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS assets;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_responders;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_tasks;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS ticket_relations;");

            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS sub_team_id;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS sub_category_id;");
            migrationBuilder.Sql("ALTER TABLE tickets DROP COLUMN IF EXISTS resolution_summary;");

            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_categories_workspace_id_parent_id_name;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_teams_workspace_id_parent_id_name;");
            migrationBuilder.Sql("ALTER TABLE categories DROP COLUMN IF EXISTS parent_id;");
            migrationBuilder.Sql("ALTER TABLE teams DROP COLUMN IF EXISTS parent_id;");
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_categories_workspace_id_name ON categories (workspace_id, name);");
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_teams_workspace_id_name ON teams (workspace_id, name);");
        }
    }
}
