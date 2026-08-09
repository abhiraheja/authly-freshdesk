# Trackly — Ticket Management App

## Context

Trackly is a standalone, multi-tenant ticket management SaaS that can be sold to **any organisation** regardless of their existing identity infrastructure. Authly is supported as one of many identity providers — not a hard dependency.

This design mirrors how products like Claude for Teams, Notion, and GitHub handle enterprise SSO: each workspace configures the identity provider they already use (Okta, Google Workspace, Microsoft Entra ID, Authly — or no IdP at all, using email + password or an emailed code), and Trackly works with all of them identically.

**Trackly owns its own identity layer.** Users, roles, and sessions are all managed in Trackly's own database. External IdPs are used only for authentication — they never dictate what a user can do inside Trackly.

---

## System Overview

```
End User (browser)
    │
    ▼
React SPA                              ← customer portal + agent dashboard
    │  OIDC (Authorization Code + PKCE) or SAML
    ▼
Configured IdP for this workspace      ← Authly / Okta / Entra ID / Google / Custom / Email magic link
    │  user identity (sub, email, name, groups)
    ▼
Trackly ASP.NET Core Web API           ← JIT provisions user, issues Trackly session
    │  Trackly session cookie (HttpOnly)
    ▼
PostgreSQL "trackly" database          ← workspaces, users, roles, tickets, etc.
```

---

## Authentication Architecture

### Workspaces (one per deployment)

Trackly has its own `workspaces` table — this replaces any dependency on an external IdP's tenant concept. All data (tickets, users, roles, settings) is scoped to a `workspace_id` in Trackly's own DB.

**Trackly is self-hosted, so a deployment holds exactly one workspace.** There is no public sign-up, no workspace picker and no subdomain: whoever runs the container owns it. The `workspace_id` column stays regardless — it is what makes invariant 1 checkable, and dropping it would rewrite every query in the app to no visible benefit.

The slug is fixed to `default` (`SetupService.WorkspaceSlug`). It survives because the unauthenticated surfaces — guest ticket views, live chat, public branding, the widget, CSAT, SSO start — already carry `?workspace=` in links that are out in the wild. New links may omit it; `db.ResolveWorkspaceAsync(slug, ct)` falls back to the one workspace.

### First-run setup

An empty database is claimed once:

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /api/setup/status` | none | `{ "needsSetup": true }` while no workspace row exists |
| `POST /api/setup` | none, rate-limited | `{ organisationName, email, password, name? }` → creates the workspace and its first `admin`, issues a session cookie, then answers `409` forever |

**Setup signs the operator in inline — it does not email a magic link.** On a fresh install SMTP has not been configured, and SMTP is configured from inside the admin UI, so mailing the first admin their own way in would brick every new install. The person at the setup screen on an empty database *is* the operator; there is nobody else to authenticate them against, and no data to protect yet.

Concurrency is settled by the database, not by the `needsSetup` check: the workspace always takes the slug `default`, `ix_workspaces_slug` is unique, and a losing insert surfaces as `DbUpdateException` and is answered `409`.

The SPA guards this at `/setup` (`setupGuard`); `guestGuard` redirects there when an unclaimed installation is reached at `/login`.

### Sign-in methods

Three, and the order matters:

| Method | Stored as | Works on a fresh install? |
|---|---|---|
| **Email + password** | `users.password_hash` (PBKDF2), `workspaces.password_login_enabled` | **Yes** — the only one that does |
| **Emailed link + 6-digit code** | `email_tokens`, `workspaces.email_login_enabled` | No — needs SMTP |
| **SSO (OIDC / SAML)** | `sso_connections` | No — needs an IdP configured |

**Why passwords exist.** Trackly is self-hosted. On an empty database there is no SMTP and no IdP, and *both are configured from inside Trackly*. A 6-digit code that cannot be delivered is not a way in; reading it out of the server log is a developer's workaround that does not survive contact with production. Passwords are what make a fresh install usable, and what makes it recoverable when SMTP later breaks.

This reverses the original "no passwords, ever" decision. What that decision was really protecting against — password reuse, weak secrets, credential stuffing — is addressed by the policy below rather than by having no passwords at all.

**Password handling**
- PBKDF2-HMAC-SHA256, 210,000 iterations, 16-byte per-password salt, 32-byte output (`IPasswordHasher` → `Pbkdf2PasswordHasher`). No package: `Rfc2898DeriveBytes.Pbkdf2` is in the framework, so there is nothing extra to keep patched inside a container someone else operates.
- Stored as one self-describing base64 value: `version ‖ iterations ‖ salt ‖ hash`. Raising the cost re-hashes each password on its owner's next sign-in — no migration, no lockout.
- Verification is `CryptographicOperations.FixedTimeEquals`.
- **Length only, minimum 12** (`PasswordPolicy`). Composition rules push people to `Password1!`; NIST SP 800-63B and OWASP both dropped them.
- Unknown email, no password set, and wrong password all return the **same** result, so the endpoint cannot be used to ask whether an address has an account.

### One workspace, three switches

`password_login_enabled` and `email_login_enabled` live on the workspace; SSO is on/off per connection (`is_enabled`, `show_on_staff_login`). `PUT /api/admin/login-settings` **refuses to disable the last working method** — and "working" means proven, not configured:

- email counts only once a test message has actually been delivered (`email_configs.last_verified_at`, set by `POST /api/admin/settings/email/test`)
- SSO counts only once a real login has completed (`sso_connections.status = active`) through a connection that is still enabled and still shown on the staff page — proof of a button nobody can see is not proof of a way in

The same rule is enforced from the other side: `SsoSettingsController` refuses to
delete, disable, or hide the connection holding the door open.

On a self-hosted box there is no support desk and no recovery link, so this is the difference between a bad afternoon and a database restore.

### Getting people in without email

Invitations are emails, so before SMTP works they have nowhere to go. `POST /api/users/members` creates an agent or admin and returns a **temporary password once** for the admin to pass on by hand; `POST /api/users/{id}/password` resets one the same way and revokes that user's other sessions.

A temporary password has travelled over a call or a chat, so `users.must_change_password` is set. While it is, `MustChangePasswordFilter` refuses every endpoint except reading your own profile and changing the password — a UI redirect alone would leave the API open to anyone holding the temporary credential and an HTTP client.

**There is no CLI recovery.** If the only admin loses their password while email is down, the installation cannot be recovered through the app. Keeping a second admin is the mitigation, and the Members screen says so.

A workspace configures **as many providers as it likes** — Google for customers
and Entra for staff is an ordinary setup. Each is a row in `sso_connections`
with its own secret, audience and status, and each becomes one button on the
sign-in page.

| Provider | Protocol | What the admin supplies | Notes |
|----------|---------|---|---|
| **Google** | OIDC | Client ID + secret | Discovery URL is fixed and built in |
| **Microsoft** | OIDC | Directory (tenant) ID, client ID + secret | Discovery is built from the tenant; default `organizations` admits work accounts, not personal Outlook ones |
| **Facebook** | **OAuth 2.0** | App ID + secret | Not OIDC — see below |
| **Authly** | OIDC | Base URL, workspace slug, client ID (secret optional) | Self-hosted and multi-tenant — see below |
| **Custom OIDC** | OIDC | Discovery URL, client ID, secret | Any OIDC IdP — Okta, Auth0, Keycloak. Configurable more than once |
| **Custom SAML** | SAML 2.0 | IdP metadata (URL or XML) | Any SAML 2.0 IdP. Configurable more than once |
| **Email + password** | Native | — | PBKDF2 hash in `users.password_hash`; the only method that works on a fresh install |
| **Email magic link** | Native | — | Trackly emails a sign-in link + 6-digit code |

**Facebook is the one that is not OIDC.** It publishes a discovery document, but
the `id_token` that document describes is only issued to the mobile "Limited
Login" SDKs — a web authorization-code exchange returns an access token and
nothing else. So Facebook runs as plain OAuth 2.0 + PKCE (`IOAuth2Client` /
`OAuth2Client`) and reads the profile from the Graph API. There is no signed
assertion to validate; what makes the result trustworthy is that the token is
exchanged over TLS with Facebook and spent immediately against Facebook's own
userinfo endpoint.

**The catalogue is the source of truth.** `SsoProviderCatalog` (in
`Trackly.Core/Sso`) holds each provider's protocol, endpoints, default scopes and
which fields an admin must supply. The API sends it to the settings screen, so
adding a provider is one entry there rather than a server change plus a matching
`if` in TypeScript. Protocol comes from the catalogue and is never accepted from
the request — whether Facebook is OAuth 2.0 is not an admin's opinion.

**Audience per connection.** `show_on_staff_login` and `show_on_customer_login`
decide where a button appears. Customer-facing is off by default: an enterprise
IdP knows staff, and a customer bounced off it has no way to tell why.
`GET /api/public/login-methods` filters by audience, keyed on whether the caller
passed a workspace slug — a slug is only ever in the URL on a branded,
customer-facing surface.

**Authly** (`Authly`, OpenIddict-based, self-hosted, multi-tenant) needs three
things a single-tenant IdP does not, and each has a catalogue field behind it:

- **A base URL, not a discovery URL** (`DiscoverySuffix`). Authly runs on the
  customer's own domain, so nothing can be baked in — but asking for
  `https://login.acme.com` is a question an admin can answer, while asking for
  `…/.well-known/openid-configuration` is a path they must be told. Trackly
  appends it, tolerates them pasting the full URL anyway, and shows the resolved
  URL live under the field.
- **A workspace slug on the authorize request** (`TenantAsAuthorizeParam` →
  `?tenant=acme`). Authly resolves a tenant from a per-tenant custom domain, or
  from a `tenant` hint. It cannot ride on the discovery URL: one shared host
  publishes *one* discovery document for every tenant, so the tenant belongs to
  the request. Without it, authorize fails with "different workspace" as soon as
  it reaches a client owned by another tenant. Leave it blank only when Authly is
  reached on its own domain.
- **The `roles` scope.** Authly puts RBAC roles in a `roles` claim, gated on that
  scope. Trackly's OIDC client already reads `roles` — but without the scope the
  claim never arrives and every group→role mapping silently matches nothing,
  which looks exactly like a mapping typo.

PKCE is mandatory at Authly for confidential clients too; Trackly always sends
it, so either a Web (confidential, with secret) or a SPA (public, PKCE-only)
Authly client works. **Not yet done:** RP-initiated logout. Signing out of
Trackly leaves Authly's own SSO cookie, so the next "Continue with Authly"
re-authenticates silently. Closing that means keeping the `id_token` and
redirecting to `/connect/logout?id_token_hint=…&post_logout_redirect_uri=…`.

**`allowed_email_domains`** narrows a connection to named domains. It matters
most for Google and Facebook: those buttons admit every account those companies
have ever issued, and JIT provisioning would create a Trackly customer for each.
Empty means any; sub-domains are not implied.

---

### SSO settings screen (`/admin/settings/sso`)

Not a wizard. A wizard suited one connection per workspace; a list of providers
is a list, and the screen is shaped like one:

```
Providers        one row per configured connection
                 brand mark · label · status · audience · enable switch ·
                 "Try it" (opens the real flow) · Edit

Add a provider   tile grid from the catalogue — Google, Microsoft, Facebook,
                 Authly, Custom OIDC, Custom SAML. A tile is disabled once its
                 provider is configured, unless the kind is repeatable.

Editor (drawer)  fields the catalogue says this provider needs, the redirect
                 URI to register, the two audience switches, allowed email
                 domains, and group→role mapping where the provider can send
                 groups.
```

**The redirect URI comes from the server**, built from `App:ApiBaseUrl` — not
from `window.location.origin`, which is simply wrong whenever the API is on
another host and produces a registration that fails at the last step of a login,
where it is hardest to diagnose. There is one URI for every OIDC and OAuth 2.0
provider (`/api/auth/sso/callback`) and one ACS URL for every SAML one, so an
admin registers the same string everywhere.

**There is no Test button, deliberately.** An SSO flow signs you in — there is no
way to exercise it without doing it, and a green tick that only proves a
discovery document parsed is worse than none. A connection stays "not used yet"
until a real login lands, and that is exactly the fact invariant 8 counts before
it will let another sign-in method be switched off. The row's "Try it" link opens
the real flow in a new tab.

**Removing or disabling a provider** is guarded the same way as the login-method
toggles: `SsoSettingsController` refuses when it is the last *proven* way in
(`IsLastWayInAsync`). Existing user records and tickets are preserved — only the
connection goes. `user_identities` rows for it are removed with it (cascade);
users are re-matched by email and get a new identity on their next sign-in
through whatever provider they use.

**Provider is immutable after creation.** Changing it under a live connection
would silently repoint every linked identity at a different IdP. Delete and add.

---

### Domain verification — removed

There used to be a `workspace_domains` table, a `/admin/settings/domains` screen and a DNS TXT verification flow. Their **only** purpose was routing an `@acme.com` login to the right workspace's IdP *among many workspaces*. A self-hosted deployment has one workspace and one connection, so there is nothing to route — and it made an admin prove, by DNS record, that they owned a domain on a server they already ran.

Removed in full: the entity, `DomainsController`, `IDnsTxtLookup` / `DnsClientTxtLookup`, the `DnsClient` package, and the table (migration `RemoveWorkspaceDomains`).

`GET /api/public/sso/discover` survives with the same response shape but a different question: instead of matching the caller's email domain, it reports whether *this installation* has an SSO connection and where to start it. The `email` parameter is still accepted and ignored, so existing clients keep working.

---

### Login Flow

```
User visits /login
    │
    ├── no workspace exists yet ──────▶ redirected to /setup (first-run)
    │
    ▼
GET /api/public/login-methods[?workspace=slug]
    → which native methods are on, and which providers belong on THIS surface
    │
    ├─── "Continue with <provider>" ─────────────────────────────────────────┐
    │                                                                        ▼
    │                                    SSO flow (OIDC, OAuth 2.0 or SAML)
    │                                    Redirect to IdP → user authenticates
    │                                    IdP redirects back with code/assertion
    │                                    Trackly validates, extracts claims
    │                                    Check allowed_email_domains
    │                                    JIT provision or update user record
    │                                    Apply group→role mapping (if configured)
    │                                    Issue Trackly session → redirect to app
    │
    ├─── email + password ──▶ POST /api/auth/password/login → session
    │
    └─── email me a code ───▶ Trackly emails a sign-in link + 6-digit code
                              → user clicks the link (or types the code)
                              → verify token → issue session → redirect to app
```

**The providers are buttons, not a fork inside submit.** With one connection per
workspace, "has SSO" was a yes/no and typing an email simply bounced you to the
IdP. Several providers make that impossible: the choice has to be visible — and
the password field stops disappearing on installations that configured SSO for
only some of their people.

A **workspace-branded** login (`?workspace=slug`, reached from a submit form or
portal link) gets the providers an admin marked customer-facing, which is usually
none. The slug is what selects the audience, because a slug is only ever in the
URL on a customer-facing surface.

Verification has two outcomes, signed in or not. It used to have two more — `signup_required` (go create a workspace) and `choose_workspace` (this email is in several) — both unreachable with one workspace, and both removed. An email with no account still signs in and is created as a `customer`, which is how customers self-serve the portal.

---

### Passwordless Email Login (magic link + code)

The second native method, alongside email + password. It reuses the same email-token machinery as guest OTP verification, and is the way customers self-serve the portal without ever being given a password.

```
1. User enters their email on /login
2. Trackly creates a login token:
     - a random 256-bit link token  → magic link URL
     - a 6-digit code              → typed fallback
   (single row, both hashes stored, 10-minute expiry, single-use)
3. Email sent: "Sign in to Acme Support"
     [ Sign in → {App:FrontendBaseUrl}/auth/verify?token=…&workspace=default ]
     "or enter this code: 482 913"
4a. User clicks the link → lands on a "Confirm sign-in" page →
    clicks the button (POST consumes the token)
4b. Or types the 6-digit code on the device where they started
5. Trackly issues a session (30 days) → redirect to portal/dashboard
```

Design decisions:

- **Link scanners:** corporate security tools (Outlook SafeLinks etc.) prefetch
  URLs with GET requests. The verify page therefore never consumes the token on
  GET — only the explicit button click (POST) does. The 6-digit code is the
  second escape hatch (e.g. reading email on a phone while logging in on a laptop).
- **Long sessions (30 days):** compensates for email round-trip friction for
  users without SSO who sign in regularly.
- **Signup = login:** entering an unknown email simply creates the account after
  verification — no "account already exists" errors, no separate signup form.
- **Rate limiting:** same as guest OTP — max 3 sends per email per 15 minutes,
  per-IP limits, 5 failed code attempts locks the token.
- **The workspace is resolved at send time, not at verify time.** `SendMagicLinkAsync`
  calls `ResolveWorkspaceAsync` even when no slug was supplied and stores the id on
  the token, so an installation that has not been set up yet refuses at send rather
  than emailing a link that could never resolve to anything. Verify therefore has
  one success outcome, `ok`; the multi-workspace `signup_required` and
  `choose_workspace` branches are gone along with their deferred-consumption rule.

---

### Just-in-Time (JIT) User Provisioning

When a user authenticates via SSO for the first time, Trackly automatically creates their account:

```
IdP returns: { sub: "okta|uid123", email: "alice@acme.com",
               given_name: "Alice", family_name: "Smith",
               groups: ["support-agents"] }
    │
    ▼
Trackly looks up user_identities WHERE connection_id=X AND provider_sub="okta|uid123"
    │
Not found                              Found
    ▼                                    ▼
Create users record                   Load existing user
{ workspace_id, email, name,          Update name/email if changed
  role from group mapping }
Create user_identities record
    │
    ▼ (both paths merge here)
Apply group → role mapping (if configured, always re-evaluates on login)
Issue Trackly session cookie (HttpOnly, SameSite=Strict)
Redirect to portal (customer) or dashboard (agent/admin)
```

**No admin action required for new SSO users** — they are provisioned automatically with the role their IdP group maps to, or `customer` by default if no mapping matches.

---

### Trackly Session (after SSO)

After SSO completes, Trackly issues its **own** session — completely independent of the IdP:

```
Trackly backend:
  → Creates a session record (sessionId, userId, workspaceId, expiresAt)
  → Sets HttpOnly cookie: trackly.session=<sessionId> (SameSite=Strict, Secure)
  → SPA reads user profile from GET /api/users/me (returns Trackly user record)
```

The SPA never holds an IdP token. All API requests are authenticated via the Trackly session cookie. This means:
- Token format doesn't matter per-provider — Trackly normalises everything into its own session
- Revoking a user in Trackly immediately blocks them regardless of their IdP session state
- No JWKS or issuer config needed on the API — only Trackly's own session store is consulted

---

## User Management (Trackly-Owned)

Trackly owns its own user table. This is the **primary source of truth** for user identity — not a cache of an external system.

| Field | Source |
|-------|-------|
| `id` | Trackly-generated UUID |
| `email` | From IdP JWT/SAML assertion, or verified via magic link, or set at first-run setup |
| `name` | From IdP JWT/SAML assertion (or asked on first magic-link login) |
| `role` | Set in Trackly's DB (via group mapping or manual assignment by admin) |
| `workspace_id` | The deployment's single workspace (`ResolveWorkspaceAsync`), or the slug on a branded link |

`password_hash` is nullable: SSO users and customers who only ever use emailed codes never get one, and null means "cannot sign in with a password" — never "any password works".

**Users panel in Trackly admin** (`/admin/users`):
- View all workspace members
- Change role (customer / agent / admin)
- Deactivate / reactivate
- See last login, linked SSO identity
- **No bulk role assignment gap** — roles are in Trackly's own DB, admin can update them freely without touching the IdP

---

## Roles & Policies

Roles are managed entirely within Trackly — no dependency on any IdP.

**RBAC — Role-Based Access Control:**

| Trackly Role | What they can do |
|-------------|-----------------|
| `customer` | Submit tickets, view own tickets, reply to agents |
| `agent` | View all tickets, respond, change status, assign, add watchers |
| `admin` | Everything + manage categories, team, SSO config, email settings, widget |

Roles are stored on the `users` table (`role` column) — not as JWT claims from an external system.

**How roles are assigned:**
1. **Auto via group mapping** (recommended for SSO workspaces): Admin configures `IdP group → Trackly role` mapping in the SSO wizard. On every login, Trackly re-evaluates the user's groups and updates their role if the mapping changed.
2. **Manual assignment**: Admin goes to `/admin/users` → selects user → changes role. Works for all auth methods including magic-link users.

**ABAC — Attribute-Based Access Control** (fine-grained, context-sensitive):

These rules are evaluated within Trackly's own API:

| Rule | Condition |
|------|-----------|
| Agent can only see tickets assigned to them | `ticket.assignee_id == currentUser.id` |
| Senior agents can override ticket priority | `currentUser.metadata.seniority == "senior"` |
| Customers from specific org can view reports | `currentUser.metadata.org_id in ["acme"]` |

---

## How Customers Submit Tickets

### Submission Page UX

When a customer lands on `/submit`, they see two clear paths:

```
┌─────────────────────────────────────────────┐
│           Submit a Support Ticket           │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │   Sign in with [Workspace SSO]  →     │  │
│  │   (Use your existing account)         │  │
│  └───────────────────────────────────────┘  │
│                                             │
│                 ── or ──                    │
│                                             │
│  Continue as Guest                          │
│  Name  _________________________________    │
│  Email _________________________________    │
│                                             │
│  [ Fill ticket form below once verified ]   │
└─────────────────────────────────────────────┘
```

The SSO button label reflects the workspace's configured provider (e.g. "Sign in with Google", "Sign in with Okta", "Sign in with Authly").

**Path A — Sign in via SSO:**
1. Customer clicks SSO button → workspace's configured IdP login
2. On return, ticket form is pre-filled with their name and email
3. They fill subject, description, category → submit
4. Ticket is tied to their Trackly user record and visible in their portal

**Path B — Continue as Guest:**
1. Customer enters name + email, fills ticket form → clicks Submit
2. Trackly sends a **6-digit OTP** to their email to verify it's real
3. Customer enters OTP → ticket created
4. Reference number shown on screen + confirmation email with magic link to track ticket

### Linking Anonymous Tickets to an Account

If a guest later signs in (SSO or magic link) with the **same email**, their anonymous tickets are automatically linked to their Trackly user record and appear in the portal.

### What This Requires

| Addition | Purpose |
|----------|---------|
| Public `/submit` route | Anonymous ticket form — no auth required |
| Trackly-side OTP | Verifies guest email independently |
| `guest_email`, `guest_name` columns on tickets | Stores anonymous submitter |
| Magic link | Lets anonymous users view/track ticket without login |
| Email-to-account linking on login | Merges anonymous tickets on first login |

---

## Agent Dashboard & Ticket Assignment

**One app, role-based UI.** The UI adapts based on the Trackly session role:
- `customer` → lands on `/portal`
- `agent` / `admin` → lands on `/dashboard`

### Ticket Assignment

New tickets are **auto-assigned via round-robin** across all active agents, with **manual reassign** available at any time.

```
New ticket arrives
  → Query users WHERE workspace_id=X AND role='agent' AND is_active=true
  → Pick agent with fewest open tickets
  → Assign → send assignment email
```

Manual reassign: any `agent` or `admin` can change `assignee_id` from the ticket detail page.

```sql
CREATE TABLE ticket_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL REFERENCES users(id),
    assigned_by UUID REFERENCES users(id),  -- null if auto-assigned
    assigned_at TIMESTAMPTZ DEFAULT now()
);
```

### Ticket Watchers

Any agent or admin can be added as a **watcher** — receives all notifications for that ticket without being responsible for resolving it.

```sql
CREATE TABLE ticket_watchers (
    ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    agent_id   UUID NOT NULL REFERENCES users(id),
    added_by   UUID NOT NULL REFERENCES users(id),
    added_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticket_id, agent_id)
);
```

**Notification flow:**
```
Any ticket update → notify assigned agent + all watchers + customer (each configurable on/off)
```

---

## Private Notes (Internal Comments)

Agents and admins can add **private notes** — visible only to agents, admins, and watchers. Customers never see them.

- Toggle in the reply box: **Reply** (public) vs **Private Note** (internal)
- Visually distinct: amber background + lock icon
- Visibility is locked on creation — cannot be changed after posting
- Private notes do **not** notify the customer but **do** notify assigned agent and watchers

**API enforcement:**
```
GET /api/tickets/{id}/comments
  → customer role or guest magic link: WHERE is_internal = false
  → agent or admin: all comments

POST /api/tickets/{id}/comments { body, is_internal }
  → customer or guest: is_internal forced to false
  → agent or admin: can set is_internal = true
```

### Free-text taxonomy on create

`POST /api/tickets` also accepts `category_name`, `channel` and `tags[]` — names
rather than ids. The server reuses a matching row (case-insensitive) or creates
one, inside the same request that writes the ticket. Nothing is written for a
form the user abandons, and a rejected ticket cannot leave an orphan category
behind.

**These three are honoured for agents and admins only.** The endpoint is open to
customers via the portal, and a customer payload that could mint workspace
categories and tags would hand tenant taxonomy to anyone who can open a ticket.
A customer's values are ignored, not rejected — the ticket still files.

`category_id` remains for callers that already hold one, and wins if both are
sent. Channel is lower-cased and whitespace-collapsed before storage, because
automation rules match it verbatim.

---

## Problems — Grouping Related Tickets

When multiple customers report the same underlying issue, agents group tickets under a **Problem**.

```
Problem: "Payment gateway down"          ← root cause
  ├── Ticket #1042 — Alice: "Can't pay"
  ├── Ticket #1043 — Bob: "Checkout failing"
  └── Ticket #1044 — Carol: "Payment error"
```

- Problems have their own status: `investigating → identified → monitoring → resolved`
- Resolving a Problem can bulk-resolve all linked tickets in one action
- Customers are never shown the Problem grouping — they only see their own ticket

```sql
CREATE TABLE problems (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'investigating',
    assignee_id UUID REFERENCES users(id),
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

ALTER TABLE tickets ADD COLUMN problem_id UUID REFERENCES problems(id) ON DELETE SET NULL;
```

---

## Broadcast Announcements — Outage Emails

Admins can send a mass email to **all customers with a Trackly account** in the workspace.

| Type | Use case |
|------|---------|
| `planned_outage` | Scheduled maintenance communicated in advance |
| `unplanned_outage` | Unexpected downtime |
| `resolved` | Follow-up confirming issue is fixed |
| `general` | Release notes, policy changes, etc. |

- Announcement can be linked to a Problem
- Send now or schedule for a future date/time
- Delivery tracked per recipient (sent / failed / bounced)
- Anonymous/guest users excluded — Trackly has no verified opt-in for them

```sql
CREATE TABLE announcements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type             TEXT NOT NULL,
    subject          TEXT NOT NULL,
    body             TEXT NOT NULL,
    problem_id       UUID REFERENCES problems(id) ON DELETE SET NULL,
    created_by       UUID NOT NULL REFERENCES users(id),
    scheduled_at     TIMESTAMPTZ,
    sent_at          TIMESTAMPTZ,
    recipient_count  INT DEFAULT 0,
    success_count    INT DEFAULT 0,
    failure_count    INT DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE announcement_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    email           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    sent_at         TIMESTAMPTZ,
    error           TEXT
);
```

---

## Email Architecture

**Key point: Trackly never runs its own SMTP server.** Sending and receiving are separate problems, both solved with hosted services plus a couple of DNS records or mailbox credentials.

### Outbound (Trackly → customer)

Any SMTP relay works: SendGrid, Mailgun, Postmark, AWS SES, or the enterprise's own relay. Trackly connects as a client and sends.

**Which relay is a row, not a column.** `email_providers` holds one row per configured provider — Google, Microsoft 365, Yahoo, generic SMTP, Amazon SES — and `email_configs.sending_provider_id` names the one that actually sends (null ⇒ the shared deployment relay). Several can be connected at once; exactly one sends and at most one receives. See `docs/email-providers-plan.md` for the full design.

**OAuth is an authentication mechanism, not a second transport.** Google and Microsoft (and Yahoo when its card lands) authenticate IMAP and SMTP with **SASL XOAUTH2** — MailKit's `SaslMechanismOAuth2` — so `ImapMailboxReader` and `WorkspaceEmailSender` each gained one branch and the inbound pipeline, threading, dedup and attachment handling are untouched. `SmtpSettings.AccessToken` / `MailboxConnection.AccessToken` carry it; exactly one of token or password is ever set. `EmailProviderService.GetAccessTokenAsync` renews inside a five-minute margin, serialised per provider row because Google rotates refresh tokens and two concurrent refreshes invalidate each other.

**One resolver, and every sender uses it.** `EmailProviderService.ResolveSenderAsync` turns the designation into `SmtpSettings?`. `NotificationService`, `AnnouncementService`, `TransactionalMailer` and the email test all call it, so the test proves the transport real mail goes through — anything else would be a false proof, and a false proof is what unlocks turning off the last working way in (invariant 8).

`IEmailSender` — the deployment-level relay from `appsettings` — is injected **only inside Infrastructure**, as the fallback behind `WorkspaceEmailSender`. Nothing in `Modules` can reach it directly. That is a deliberate structural guard: sign-in, guest and invitation mail each bypassed the workspace's own relay for several phases precisely because they *could*, and the failure was invisible — on a self-hosted install with nothing in `Email:Smtp:*`, those messages were written to the log while the admin looked at a green test.

What matters on the wire is the headers stamped on every notification email — they enable reply threading:

```
From:        Acme Support <support@tickets.acme.com>
Reply-To:    reply+<ticket-uuid>@tickets.acme.com
Message-ID:  <ticket-uuid>.<comment-uuid>@trackly
```

The `reply+<ticket-uuid>@` address encodes which ticket a reply belongs to. DNS setup for deliverability: SPF + DKIM records on the sending domain (the SMTP provider gives these).

### Templates — what the mail actually says

Every message Trackly sends is a template an admin can edit, rendered into a
shared branded layout. Admin surface: `/admin/settings/email/templates`
(`admin-guide.md` § 9.1). Code: `Trackly.Core/Email` (renderer, catalogue,
samples), `Trackly.Modules/Email` (brand resolver, render service, transactional
mailer), `Trackly.Api/Controllers/EmailTemplatesController`.

**A missing row *is* the built-in.** `email_templates` stores only what an admin
customised; the catalogue lives in code (`EmailTemplateCatalog`). So `source` is
a null check, **Reset** is `DELETE the row`, and a fresh database needs no seed.
Seeding would look tidier and be worse: a default improved in a later release
would never reach an existing install, because the row already exists and nothing
can tell "seeded, untouched" from "deliberately written that way".

**One layout, many content fragments.** A template body is the *content* of an
email, not a whole document; it renders into `_layout`, which carries the logo
header, the accent colour, the footer and the `Powered by Trackly` line. Branding
is therefore set in one place. `_layout` is itself an editable, resettable
template, and a per-template `standalone` flag skips it for the case that needs
it — a finished HTML email from a designer.

**A deliberately small engine, not Scriban.** `{{var}}` (HTML-escaped),
`{{{var}}}` (raw), and `{{#if x}}…{{else}}…{{/if}}`, resolved against a fixed
`Dictionary<string, string?>`. Roughly 100 lines in `TemplateRenderer`.
Conditionals are not optional: the resolved email carries a CSAT link only
sometimes, a mention an excerpt only sometimes, a reply "you can reply to this
email" only when inbound mail is configured.

A real template language is rejected on purpose. Those evaluate expressions
against an object graph, and the template is admin-editable data in a database —
that is server-side template injection with a friendly name. It also quietly
breaks **invariant 5**: against a fixed dictionary there is *no expression* an
admin can write that reaches an internal comment, because internal comments were
never put in the dictionary. Against an object graph, one `{{ ticket.comments }}`
would.

**Escaping, and where the danger is.** `{{name}}` escapes; `{{{name}}}` does not
and is used only for values the server produced as already-sanitised HTML.
Ticket subjects and customer names are attacker-supplied — anyone can open a
ticket titled `<img onerror=…>`. Mail clients mostly neuter that; the admin's own
preview pane does not, which is why it renders in a sandboxed `<iframe srcdoc>`
with neither `allow-scripts` nor `allow-same-origin`. Bodies are sanitised on
save by `EmailHtml` — a wider allowlist than `RichText`, because tables and
inline styles are what an HTML email is made of.

**The text part is derived, not authored.** `EmailText.FromHtml` (AngleSharp)
produces the `text/plain` alternative from the rendered HTML, keeping link URLs
and dropping the logo. A second editable body would double the editing surface
for something nobody maintains, and a stale text part is worse than a generated
one.

**Failure degrades rather than stops.** A stored template that cannot parse falls
back to the built-in with a warning logged, and `is_active = false` selects the
built-in rather than suppressing the send — a toggle that silently stopped
sign-in codes would be an invariant 8 lockout wearing a friendly label. Save
refuses a template that has lost a required variable, for the same reason: an
admin who deletes `{{action_url}}` while rewording the sign-in email has locked
everyone out of a product with no support desk and no recovery link.

**Branding is read through one seam.** Nothing in the email path touches
`WorkspaceBranding` directly; `EmailBrandResolver` maps it to an `EmailBrand`
record, so a later restructuring of branding changes one file and no stored
template. `logo_url` is withheld unless a logo has actually been uploaded *and*
`App:ApiBaseUrl` is set — the public logo endpoint 404s otherwise, and the layout
falls back to the brand name in text.

**Open question — admin-defined variables.** The variable list is fixed in code:
a developer declares a name, supplies it at the send site, and it appears in the
editor. Admins use what is offered and nothing else. That boundary is what makes
invariant 5 structural, so any "define your own variable" feature has to avoid
becoming expression evaluation. The version that keeps the invariant is
workspace-level custom key/value pairs folded into the dictionary under a
reserved `custom_*` prefix — still a fixed dictionary at render time. Open
sub-questions: whether ticket custom fields feed in (the one that actually
touches invariant 5, since ticket data is customer-visible in some templates and
not others), who may define them, and whether the editor distinguishes them from
built-ins. Not scheduled.

### Interaction Modes (per workspace)

Configurable in `/admin/settings/email`:

| Mode | What it means |
|------|--------------|
| **Notifications only** | Emails sent, replies go nowhere. Login required to reply. |
| **One-way** | Customer can reply via email; appears in ticket. Agent replies in Trackly. |
| **Two-way** | Both sides reply via email. Requires an inbound connector (below). |

### Inbound Connectors — Admin Chooses One of Two

To receive replies (and optionally new tickets) by email, the workspace admin picks **one** of two connector types in `/admin/settings/email`. Both feed the same internal pipeline — only the transport differs.

#### Option A — Inbound Parse Webhook (MX + provider)

The enterprise creates a subdomain (e.g. `tickets.acme.com`) whose **MX record** points at an inbound parse service — SendGrid Inbound Parse, Mailgun Routes, Postmark Inbound, or AWS SES Receiving. This is how Zendesk/FreshDesk work.

```
1. Agent replies in Trackly → email sent via SMTP relay
   Reply-To: reply+<ticket-uuid>@tickets.acme.com

2. Customer hits "Reply" in Gmail/Outlook
   → their mail server looks up the MX record for tickets.acme.com
   → MX points at the provider (e.g. mxa.mailgun.org)

3. Provider receives the raw email, parses the MIME
   (body, HTML, attachments, headers)
   → POSTs it to Trackly's webhook: POST /api/email/inbound

4. Trackly webhook handler → shared inbound pipeline (below)
```

Infrastructure needed: **one MX record + one webhook endpoint**. No mail daemon, spam filtering, or port-25 TLS on our side — the provider absorbs all of it. Inbound parsing is free on SendGrid and included in Mailgun's base tier.

#### Option B — Mailbox Polling (IMAP / Microsoft Graph / Gmail API)

> **Status:** only **IMAP** is implemented today (`ImapMailboxReader`). Microsoft
> Graph and Gmail API are the designed OAuth-mailbox transports but are not yet
> built — `ms_graph` / `gmail_api` exist as reserved enum values only.

The enterprise already has `support@acme.com` in Microsoft 365 or Google Workspace and wants to keep using it. Trackly connects to that mailbox and polls for new messages on an interval (default 60s):

```
1. Customer replies (or emails support@acme.com cold)
2. Message lands in the enterprise's existing mailbox
3. Trackly's background worker (EmailPollingWorker, an ASP.NET Core
   hosted service) polls via IMAP, Microsoft Graph, or Gmail API
4. New messages → shared inbound pipeline (below)
5. Processed messages are marked (moved to a "Processed" folder
   or flagged) so they are never ingested twice
```

Auth: OAuth2 (Graph / Gmail API — recommended, no password stored) or IMAP username + app password (encrypted at rest). Outbound for this mode can also go through the same mailbox (SMTP submission / Graph sendMail) so replies come from the address customers already know.

#### Comparison (shown to the admin in the setup UI)

| | A — Parse webhook | B — Mailbox polling |
|---|---|---|
| Enterprise setup | Add one MX record on a subdomain | Grant OAuth access (or app password) to existing mailbox |
| Latency | Instant (push) | Polling interval (~60s) |
| New tickets from cold emails | Any address on the subdomain | Natural — anything sent to support@ becomes a ticket |
| Trackly infra | Webhook endpoint | Background polling worker |
| Best for | Cloud/SaaS deployments | Enterprises attached to their existing support mailbox |

### Shared Inbound Pipeline (both connectors)

Regardless of transport, every inbound email goes through the same steps:

```
a. Authenticate the source
   Webhook: verify provider HMAC signature
   Polling: message came from the authenticated mailbox itself
b. Resolve the ticket
   1st: ticket UUID from the reply+ address
   2nd (fallback): In-Reply-To / References headers matched against
        stored comment email_message_id (handles clients that mangle Reply-To)
   3rd: no match at all → treat as a NEW ticket (if enabled, see below)
c. Resolve the sender: From: must match the ticket's requester, a
   participant, or a known user/guest — otherwise reject (prevents
   comment injection by anyone who learns a reply address)
d. Strip quoted history ("On Jul 4, Viola wrote: …") so only the new
   text is kept; extract attachments → IFileStorage
e. Insert comment (source='email'), notify assignee + watchers
```

### Email as a Ticket-Creation Channel (optional toggle)

With either connector, an email that matches no existing ticket can **create a new ticket** (`new_ticket_via_email` toggle, off by default):

- Sender email matched to an existing user → ticket linked to them
- Unknown sender → guest ticket (guest_email = sender); no OTP needed since
  the email itself proves address ownership
- Subject → ticket subject; body → description; attachments carried over
- Tickets created this way get `channel = 'email'`

---

## Email Configuration

Per workspace in `/admin/settings/email`. The admin connects one or more providers and says which one sends and which receives; with none designated, mail goes through the shared deployment-level relay configured at install time.

```sql
-- One row per configured provider. Trackly ships the servers, ports and scopes
-- for each in EmailProviderCatalog, so the admin supplies only the account.
CREATE TABLE email_providers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,                 -- google | microsoft | yahoo | smtp | ses
    enabled       BOOLEAN NOT NULL DEFAULT false,
    account_email TEXT,
    -- OAuth (the operator's own app registration — Trackly ships no client id)
    oauth_client_id                TEXT,
    oauth_client_secret_encrypted  TEXT,          -- AES-256-GCM
    -- Microsoft only, and plaintext: a directory ID is in every sign-in URL, so
    -- invariant 3 does not reach it. NULL means `common` — which Entra refuses
    -- for a single-tenant app registration, hence the column.
    oauth_tenant_id                TEXT,
    oauth_tokens_encrypted         TEXT,          -- AES-256-GCM JSON (refresh token)
    oauth_scopes                   TEXT,
    -- SMTP / IMAP. A connected provider authenticates with XOAUTH2 and ignores
    -- these; Yahoo uses an app password here until its OAuth card ships, and the
    -- columns are the same either way.
    smtp_host TEXT, smtp_port INT, smtp_username TEXT,
    smtp_password_encrypted TEXT,                 -- AES-256-GCM
    smtp_use_start_tls BOOLEAN NOT NULL DEFAULT true,
    imap_host TEXT, imap_port INT, imap_username TEXT,
    imap_password_encrypted TEXT,                 -- AES-256-GCM
    -- SES
    ses_region TEXT, ses_access_key_id TEXT,
    ses_secret_key_encrypted TEXT,                -- AES-256-GCM
    -- Per-provider health. NOT the delivery proof — see email_configs below.
    last_verified_at TIMESTAMPTZ,
    last_error       TEXT,
    last_polled_at   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, provider)
);

-- Correlation for an in-flight Connect. Exactly sso_login_states' job for a
-- mailbox rather than a person: the code_verifier must survive the redirect and
-- must never reach the browser, and the single-use state is what makes the
-- cookie-less callback safe.
CREATE TABLE email_oauth_states (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    state         TEXT NOT NULL UNIQUE,
    code_verifier TEXT NOT NULL,
    return_url    TEXT,
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_configs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID NOT NULL UNIQUE REFERENCES workspaces(id),
    -- Which provider does which job. Kept here rather than as a flag on
    -- email_providers because it is workspace policy, not a property of a
    -- credential. sending_provider_id NULL ⇒ the shared deployment relay.
    sending_provider_id    UUID REFERENCES email_providers(id) ON DELETE SET NULL,
    receiving_provider_id  UUID REFERENCES email_providers(id) ON DELETE SET NULL,
    -- The INSTALLATION-WIDE proof that a test message was actually delivered —
    -- the only thing invariant 8 counts before password sign-in may be turned
    -- off. Distinct from email_providers.last_verified_at, which only says one
    -- provider's credentials authenticate. Every provider mutation clears this.
    last_verified_at       TIMESTAMPTZ,
    -- The outbound SMTP columns that used to sit here were superseded by
    -- email_providers and DROPPED by the EmailProviderCleanup migration. This
    -- row is policy now, not credentials — nothing here is a secret except the
    -- inbound webhook signing key.
    -- Who mail appears to come from. Survives changing which relay carries it.
    from_name              TEXT,
    from_email             TEXT,
    -- Interaction mode
    email_mode             TEXT NOT NULL DEFAULT 'notifications_only',
                                                 -- notifications_only | one_way | two_way
    new_ticket_via_email   BOOLEAN DEFAULT false,
    -- Inbound connector: admin picks ONE
    inbound_connector      TEXT,                 -- null | 'parse_webhook' | 'mailbox_poll'
    -- Option A: parse webhook
    inbound_provider       TEXT,                 -- sendgrid | mailgun | postmark | ses
    inbound_reply_domain   TEXT,                 -- e.g. tickets.acme.com
    inbound_webhook_secret_encrypted TEXT,       -- AES-256-GCM; verifies the HMAC
    -- Option B: mailbox polling. Which mailbox and its credentials are the
    -- provider row receiving_provider_id points at — the mailbox_* columns that
    -- used to be here went with the SMTP ones. The reply-to address on a polled
    -- workspace is that provider's account_email.
    poll_interval_seconds  INT DEFAULT 60,
    last_polled_at         TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ DEFAULT now()
);

-- What each message SAYS. Only what an admin has customised: no row for a key
-- means render the built-in from EmailTemplateCatalog, which is why `source` is
-- a null check, Reset is a DELETE, and a fresh database needs no seed. See
-- Email Architecture → Templates.
CREATE TABLE email_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- Catalogue key: '_layout', 'magic_link', 'ticket_resolved', … Not a foreign
    -- key — the catalogue is code, and a row for a key a later release retires
    -- is inert rather than an integrity error.
    key           TEXT NOT NULL,
    locale        TEXT NOT NULL DEFAULT 'en',
    -- NULL for '_layout', which is a frame rather than a message.
    subject       TEXT,
    body_html     TEXT NOT NULL,
    -- Skip the shared layout; this body is the whole email.
    standalone    BOOLEAN NOT NULL DEFAULT false,
    -- false selects the BUILT-IN, it does not suppress the send (invariant 8).
    is_active     BOOLEAN NOT NULL DEFAULT true,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- SET NULL, not CASCADE: deleting the admin who last edited a template must
    -- not delete the template.
    updated_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (workspace_id, key, locale)
);

-- Exactly-once inbound ingestion. A duplicate provider Message-ID collides on
-- the unique index and rolls back the comment/ticket insert in the same
-- transaction, so a webhook retry or polling-worker restart never doubles up.
CREATE TABLE inbound_email_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    message_id   TEXT NOT NULL,
    ticket_id    UUID,
    comment_id   UUID,
    outcome      TEXT NOT NULL,      -- comment | new_ticket | rejected | ignored
    processed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (workspace_id, message_id)
);
```

> **Implementation notes (Phase 4):** encrypted columns are suffixed `*_encrypted`
> and are never returned by the admin API — `GET /api/admin/email/providers`
> exposes `hasSmtpPassword` / `hasImapPassword` / `hasOauthClientSecret` booleans
> and `GET /api/admin/email/config` exposes `hasInboundWebhookSecret`. The parse-webhook endpoint is `POST /api/email/inbound/{slug}`;
> the caller signs the **raw request body** with the workspace's webhook secret and
> sends it as `X-Trackly-Signature: <hex HMAC-SHA256>` (constant-time compared).
> A provider-specific adapter (SendGrid multipart, Mailgun signature) can normalise
> onto this JSON contract later. Notification Message-IDs are stored canonical
> (bracket-free `<tid>.<cid>@trackly`) so IMAP and webhook references match.

### Notification Settings (per workspace)

```sql
CREATE TABLE notification_settings (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                UUID NOT NULL UNIQUE REFERENCES workspaces(id),
    notify_customer_on_create   BOOLEAN DEFAULT true,
    notify_customer_on_reply    BOOLEAN DEFAULT true,
    notify_customer_on_status   BOOLEAN DEFAULT true,
    notify_agent_on_assign      BOOLEAN DEFAULT true,
    notify_agent_on_reply       BOOLEAN DEFAULT true,
    notify_agent_on_reassign    BOOLEAN DEFAULT true,
    updated_at                  TIMESTAMPTZ DEFAULT now()
);
```

---

## Embeddable Widget & Integration Options

Admin configures at `/admin/widget`. Three embed types:

| Type | How it works |
|------|-------------|
| Floating button | `<script>` tag — renders button + overlay on any page |
| Inline iframe | `<iframe>` snippet — renders form inline |
| Direct link | Standalone URL — no code needed |

Admin configures which fields to show/hide/require/pre-fill. Trackly generates the embed snippet automatically:

```html
<script
  src="https://trackly.yourdomain.com/widget.js"
  data-workspace="acme"
  data-fields="name,email,subject,description"
  data-theme="light"
  data-user-name="Alice Smith"
  data-user-email="alice@acme.com"
></script>
```

Pre-filled fields can be hidden. The SSO button inside the widget initiates the workspace's configured provider. OTP is still triggered for pre-filled email unless the parent app passes a verified Trackly session token.

```sql
CREATE TABLE widget_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id),
    embed_type   TEXT NOT NULL DEFAULT 'floating',
    fields       JSONB NOT NULL,
    theme        TEXT NOT NULL DEFAULT 'light',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
```

---

## Website Structure & Wireframes

Trackly has **three surfaces**, each with its own audience:

| Surface | URL | Audience | Branding |
|---------|-----|----------|----------|
| Marketing site | `trackly.com` | Enterprises evaluating Trackly | Trackly's own brand |
| Internal portal | `{your-host}/dashboard` | Admins + agents | Trackly brand + workspace name |
| Customer-facing support | `{your-host}/submit`, `/portal` (+ widget) | The organisation's end customers | **The organisation's brand** (logo, colors) |

Layout inspiration: three-pane agent workspace (ticket list left, conversation centre, details right) — styled with Material UI and Trackly's own branding, not a pixel copy of any reference design.

---

### 1. Operator journey — Install → Set up → Live

```
docker compose up            /setup                         Live
─────────────────            ──────                         ────
Empty database          →    Organisation name          →   /dashboard
                             Your email                     (getting-started
                             [ Create and sign in ]          checklist card)
```

There is no marketing funnel and no trial: you already have the software. The
first user becomes the workspace `admin` and is signed in immediately, because
no email can be sent before SMTP is configured.

---

### 2. Marketing Site — Landing Page

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Trackly      Features   Pricing   Docs          [Sign in] [Start free →] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│        Customer support that works with YOUR identity                │
│   Ticketing, email threading, and a branded customer portal.         │
│   Bring your own SSO — Okta, Google, Entra ID, Authly — or none.     │
│                                                                      │
│              [ Start free trial ]   [ Book a demo ]                  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│          ┌──────────────────────────────────────────────┐            │
│          │  (screenshot: agent three-pane workspace)    │            │
│          └──────────────────────────────────────────────┘            │
├────────────────────┬────────────────────┬────────────────────────────┤
│ 🎫 Smart Ticketing │ 🔐 Bring your own  │ ✉️ Two-way email           │
│ Round-robin        │    SSO             │    threading               │
│ assignment,        │ Works with the IdP │ Customers reply from        │
│ watchers, private  │ you already have   │ their inbox — it lands      │
│ notes, problems    │                    │ in the ticket               │
├────────────────────┴────────────────────┴────────────────────────────┤
│  Pricing:   Free (3 agents)  ·  Team  ·  Enterprise (SSO, SLA)       │
├──────────────────────────────────────────────────────────────────────┤
│  Footer: docs · security · status · contact                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 3. First run

```
Empty database  ──►  /setup  ──────────────────────────────►  /dashboard
                     ┌────────────────────────────┐           (getting-started
                     │  Set up Trackly            │            checklist card)
                     │                            │
                     │  Organisation name _______ │
                     │  Your email        _______ │
                     │  Your name (opt.)  _______ │
                     │                            │
                     │ [ Create workspace and     │
                     │   sign in ]                │
                     └────────────────────────────┘
```

One screen, then you are in — no email round trip, because SMTP is configured
from inside the admin UI and does not exist yet.

**There is no multi-step wizard.** The old design had five steps; steps 3-5
(branding, invite team, SSO) were never built as wizard steps and already exist
as admin pages, and step 2 (create workspace) is gone with the SaaS funnel.
Building a wizard to reach three pages that already exist adds a screen and no
product. The dashboard checklist points at them instead:

```
  ☐ Add your branding   ☐ Invite agents   ☐ Configure SSO   ☐ Embed the widget
```

---

### 4. Internal Portal — Agent Workspace (three-pane)

The layout the design review converged on — open tickets on the left, conversation in the middle, details on the right:

```
┌────┬───────────────────┬─────────────────────────────────┬──────────────────┐
│ ◆  │ Open Tickets   ⚙  │ #1126 · Cannot verify my code   │ Ticket details ✕ │
│    │ [search…    ] [▾] │           status: [ Open ▾ ]    │                  │
│ 🏠 │───────────────────│─────────────────────────────────│ Assignee         │
│ 🎫 │ ▸ Javier O.   45s │ ┌─────────────────────────────┐ │  Viola D         │
│ 👥 │   Verifying code… │ │ Javier: Email came through  │ │ Watchers         │
│ 📊 │───────────────────│ │ but there is no code in it. │ │  Taylor B        │
│ ⚙  │   S. Walker    2m │ └─────────────────────────────┘ │  Gavin B   [+Add]│
│    │   Where is my…    │ ┌─────────────────────────────┐ │──────────────────│
│    │───────────────────│ │ Viola (agent): Thanks — our │ │ ID       #1126   │
│    │   Carmen S.    5m │ │ team is looking into it.    │ │ Priority High    │
│    │   Overseas ship…  │ └─────────────────────────────┘ │ Category Technical│
│    │───────────────────│ ┌─ 🔒 internal ──────────────┐ │ Problem  PG down │
│    │   Brian H.    11m │ │ Viola: @Gavin can you check │ │──────────────────│
│    │   Wholesale ord…  │ │ the OTP service logs?       │ │ Requester        │
│    │                   │ └─────────────────────────────┘ │  Javier Ortiz    │
│    │                   │─────────────────────────────────│  javier@ortiz.com│
│    │                   │ [ Public reply | Private note ] │                  │
│    │                   │ ┌─────────────────────────────┐ │                  │
│    │                   │ │ Type your reply…            │ │                  │
│    │                   │ └────────────────── 📎  [Send]│ │                  │
└────┴───────────────────┴─────────────────────────────────┴──────────────────┘
```

Key behaviours:
- Left list: searchable, filterable (status/priority/assignee), unread indicators
- Centre: public replies and 🔒 private notes visually distinct; status dropdown at top
- Right panel: assignee, watchers, priority, category, linked problem, requester info

**Admin view** = same shell + extra nav items (Users, Settings, Announcements, Widget).

---

### 5. Customer-Facing Support Form (workspace-branded)

Rendered entirely with the **enterprise's branding** — logo, brand colour, portal title. Trackly's brand appears only as a small "Powered by Trackly" footer (removable on paid tiers).

```
┌──────────────────────────────────────────────┐
│  [ACME LOGO]   Acme Support        ← brand   │  ← header uses workspace
│  ────────────────────────────────   colour   │    logo + primary_color
│                                              │
│        How can we help you?                  │  ← welcome_text
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Sign in with Okta →                   │  │  ← label reflects the
│  └────────────────────────────────────────┘  │    workspace's SSO provider
│                 ── or ──                     │
│  Continue as guest                           │
│  Name    ______________________________     │
│  Email   ______________________________     │
│  Subject ______________________________     │
│  Category [ Billing ▾ ]                      │
│  Message ______________________________     │
│          ______________________________     │
│  📎 Attach files                             │
│                                              │
│              [  Submit ticket  ]             │  ← button in brand colour
│                                              │
│  ──────────────────────────────────────────  │
│           Powered by Trackly                 │
└──────────────────────────────────────────────┘
```

The same branding is applied to: the customer portal (`/portal`), the embeddable widget, outbound notification emails (logo in header), and the guest magic-link ticket view.

---

### 6. Workspace Branding

Configured at `/admin/settings/branding` (and during onboarding Step 3):

```sql
CREATE TABLE workspace_branding (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    logo_url      TEXT,                     -- stored via IFileStorage, same as attachments
    primary_color TEXT DEFAULT '#2563EB',   -- hex; drives header, buttons, links
    page_title    TEXT,                     -- e.g. "Acme Support"
    welcome_text  TEXT,                     -- shown on the submit form
    footer_text   TEXT,                     -- optional custom footer line
    hide_powered_by BOOLEAN DEFAULT false,  -- paid-tier flag
    updated_at    TIMESTAMPTZ DEFAULT now()
);
```

Served to the public form/widget via an unauthenticated, cacheable endpoint:
`GET /api/public/workspaces/{slug}/branding` → `{ logoUrl, primaryColor, pageTitle, welcomeText, ssoProviderName }`

---

## Design Direction (decided)

The visual language was refreshed after reviewing an alternative service-desk UI.
**Material UI stays** — the design was adopted, the framework was not. No Tailwind,
no shadcn, no component-library migration. Everything below is expressed as MUI
theme tokens in `frontend/src/theme.ts` and reused via `sx`.

**Design tokens**

| Token | Value | Used for |
|---|---|---|
| `primary.main` | `#4F46E5` (indigo) | Trackly actions, active nav, focus rings |
| `secondary.main` | `#A78BFA` (violet) | avatars, gradient partner to primary |
| `success.main` | `#10B981` | resolved/closed states |
| `warning.main` | `#F59E0B` | pending, SLA at risk |
| `error.main` | `#EF4444` | urgent priority, destructive actions |
| `info.main` | `#3B82F6` | informational chips and banners |
| Font | Inter (system fallback stack) | everything |
| Radii | 14px cards, 18px hero panels, 12px buttons, 99px chips | — |
| `shadows.soft` | resting card elevation | cards, panels |
| `shadows.lift` | hover/primary-button elevation | contained buttons, hover |
| `glass.light` / `glass.dark` | `blur(16px) saturate(160%)` | sticky app bar |

**The two-palette rule (follows from invariant 6)**

1. **Trackly surfaces** — agent workspace, admin pages, dashboards, Trackly's own
   marketing and auth screens. These wear the Trackly palette and support **dark
   mode** (MUI `colorSchemes` + `cssVariables.colorSchemeSelector: 'class'`).
2. **Customer-facing surfaces** — submit form, guest ticket view, customer portal,
   workspace-scoped login (`/login?workspace=slug`), notification emails, widget.
   These wear the **workspace's** `primary_color` and logo, are **always light**
   (a customer never toggles the tenant's brand into dark mode), and never
   advertise Trackly beyond the optional "Powered by" line.

`BrandedFrame` implements rule 2; `AppShell` switches between the two based on
`user.role === 'customer'`.

**Notes for implementers** are kept in the `trackly-ui` skill
(`.claude/skills/trackly-ui/SKILL.md`) — including MUI v9 gotchas: system props
were removed from `Stack`/`Box` (use `sx`), the `containedPrimary` style-override
key was removed (use the `variants` array), and `border: '1px solid'` must always
be paired with `borderColor: 'divider'` or it falls back to `currentColor`.

---

## Components to Build

### 1. React Frontend (Vite + TypeScript)

**Stack:** React 18, TypeScript, Vite, Material UI, TanStack Query, React Router v6, React Hook Form + Zod, Zustand

| Area | Routes | Auth required | Who sees it |
|------|--------|--------------|-------------|
| Marketing site | `/`, `/features`, `/pricing` | No | Prospective enterprises |
| First-run setup | `/setup` (one screen, first run only) | No | The operator standing up the install |
| Accept invite | `/invite/:token` | No | Invited agents/admins |
| Public ticket form | `/submit` (workspace-branded) | No | Anyone |
| Anonymous ticket view | `/tickets/:id?token=` | No | Guest (magic link) |
| Login | `/login` | No | All |
| First-run setup | `/setup` | No | Only while no workspace exists |
| SSO callback | `/auth/callback` | No | All |
| Customer portal | `/portal/tickets`, `/portal/tickets/new`, `/portal/tickets/:id` | Yes | `customer` |
| Agent dashboard | `/dashboard/tickets`, `/dashboard/tickets/:id`, `/dashboard/problems` | Yes | `agent`, `admin` |
| Admin settings | `/admin/users`, `/admin/settings/sso`, `/admin/settings/email`, `/admin/settings/branding`, `/admin/widget`, `/admin/announcements` | Yes | `admin` |

---

### 2. ASP.NET Core Web API

**Solution structure:**
```
src/
  Trackly.Core/           # Entities, interfaces, enums
  Trackly.Modules/        # Business logic: auth, tickets, guest, email, sso, problems,
                          #   announcements, kb, sla, automation, ai, channels, chat, csat, dashboard
  Trackly.Infrastructure/ # EF Core, OIDC/SAML handlers, email adapters, storage, crypto, Anthropic client
  Trackly.Api/            # Controllers, SignalR chat hub, background workers, middleware, session auth
```

**Email components (as built):**
- `InboundEmailService` (Trackly.Modules.Email) — the shared resolve-ticket →
  resolve-sender → strip-quotes → insert-comment pipeline; both connectors feed it.
- `EmailInboundController` — `POST /api/email/inbound/{slug}` for Option A
  (HMAC-verified against the workspace's stored webhook secret).
- `EmailPollingWorker` (Trackly.Api.Workers) — `BackgroundService` for Option B;
  iterates workspaces with `inbound_connector = 'mailbox_poll'` and polls each
  mailbox via `ImapMailboxReader` (**IMAP over MailKit**).
- `SmtpEmailSender` / `WorkspaceEmailSender` — SMTP send via MailKit (shared relay
  or the workspace's own); `LoggingEmailSender` writes mail to the log when no
  relay is configured (dev).

> **Not implemented:** `ms_graph` and `gmail_api` exist only as reserved
> `mailbox_protocol` enum values (`EmailConfig`); the sole inbound transport today
> is IMAP. Treat any earlier "Graph / Gmail API" wording as forward-looking.

**API surface added after the original design (Phase 6–7C).** Controllers are the
source of truth; the admin-facing behaviour is documented in `docs/admin-guide.md`:
- **Phase 6:** problems, announcements, `GET /widget.js` + public widget config,
  `GET /api/dashboard/stats`.
- **Phase 7A:** `/api/tags`, `/api/teams`, `/api/admin/sla`, `/api/kb/*` (+ public
  `/api/public/workspaces/{slug}/kb`), `/api/canned-responses`,
  `/api/automation-rules`.
- **Phase 7B (AI):** `/api/admin/ai`, `/api/ai/available`,
  `/api/tickets/{id}/ai/{draft-reply,summary,triage,kb-draft}`.
- **Phase 7C:** `/api/public/csat/{ticketId}` + `/api/tickets/{id}/csat`;
  `/api/dashboard/analytics`; `/api/admin/channels` + public
  `/api/channels/inbound/{provider}/{slug}`; live chat `/api/chat/*`,
  `/api/public/chat/*`, and the SignalR hub at `/hubs/chat`.

**Authentication middleware:**
```csharp
// Session-based — no external JWKS needed
// Trackly issues its own session after SSO completes
builder.Services.AddAuthentication("TracklySession")
    .AddScheme<TracklySessionOptions, TracklySessionHandler>("TracklySession", _ => { });
```

**OIDC handling (generic, per-workspace config):**

> **Implementation caveat:** ASP.NET Core registers authentication schemes at
> startup — you cannot call `AddOpenIdConnect` per workspace at runtime.
> Instead, register **one** generic OIDC scheme and resolve the workspace's
> `sso_connections` record inside the handler events (or via a custom
> `IOptionsMonitor<OpenIdConnectOptions>` keyed by workspace). The workspace
> is carried through the flow in the OIDC `state` parameter.

```csharp
// ONE generic scheme; per-workspace config resolved at request time
services.AddOpenIdConnect("WorkspaceOidc", options => {
    options.CallbackPath = "/auth/callback";
    options.Events.OnRedirectToIdentityProvider = ctx => {
        var conn = ctx.HttpContext.ResolveSsoConnection(); // by workspace slug
        ctx.ProtocolMessage.IssuerAddress = conn.AuthorizeEndpoint;
        ctx.ProtocolMessage.ClientId      = conn.ClientId;
        // secret (if any) decrypted at token exchange, same pattern
        return Task.CompletedTask;
    };
});
```

> **Implementation note (Phase 5):** rather than register `AddOpenIdConnect` and
> fight the static-scheme model, Trackly implements the OIDC **authorization-code +
> PKCE flow manually** (`IOidcClient` / `OidcClient`): one generic client, the
> workspace's config passed per call. Discovery + JWKS are cached per issuer; the
> id_token is validated for issuer, audience=client_id, signature, lifetime, and
> nonce. State/nonce/PKCE verifier are correlated **server-side** in
> `sso_login_states` (single-use, 10-min TTL) instead of a cross-site cookie — a
> `SameSite=Strict` cookie would not survive the IdP round-trip. Endpoints:
> `GET /api/auth/sso?workspace=slug&connection=<id>` → IdP;
> `GET /api/auth/sso/callback` → session.
>
> **Multi-provider (this change):** the flow is keyed on a connection id, not on
> "the workspace's SSO". The id travels in the link, and back through the `state`
> row — so one callback serves OIDC and OAuth 2.0 alike, and an admin registers a
> single redirect URI no matter how many providers they add. `connection` is
> optional: a link written before this falls through to the workspace's first
> enabled provider. The login page reads `GET /api/public/login-methods`, which
> returns every provider for that surface; `/api/public/sso/discover` keeps its
> single-provider shape for older clients and reports the first.
>
> **Two claim-reading traps, both fixed, both silent:**
> `JwtSecurityTokenHandler` is constructed with `MapInboundClaims = false`. Left
> at its default it rewrites OIDC claim names into legacy WS-* URIs — `sub`
> becomes `…/claims/nameidentifier` — so the `sub` lookup returned null and every
> OIDC sign-in died on "id_token has no sub claim". And group claims are read
> from `groups`, `roles`, **`role`** and `group`: `role` singular is OpenIddict's
> spelling and therefore Authly's, and without it an Authly group→role mapping
> matches nothing while looking exactly like a mapping typo.

**SAML handling:** `ITfoxtec.Identity.Saml2` (`.MvcCore`), handled in the API layer
(`SamlController`): `GET /api/auth/saml?workspace=slug`, `POST /api/auth/saml/acs`,
`GET /api/auth/saml/metadata?workspace=slug`. AuthnRequests are unsigned; the IdP
**response signature is validated** against the cert in the IdP metadata before any
claim is trusted. JIT/session/role-mapping is shared with OIDC via
`SsoLoginService.FinishLoginAsync`.

**Key API endpoints:**

| Method | Path | Auth | Role |
|--------|------|------|------|
| GET    | `/api/setup/status` | None | Whether this installation still needs first-run setup |
| POST   | `/api/setup` | None | First run only — create the workspace + first admin, sign in inline (409 thereafter) |
| POST   | `/api/auth/password/login` | None | Email + password → session (rate-limited) |
| POST   | `/api/auth/password/change` | Session | Change your own password |
| GET    | `/api/public/login-methods` | None | Which sign-in methods this installation offers |
| GET    | `/api/users/members` | Session | admin — everyone, including deactivated |
| POST   | `/api/users/members` | Session | admin — create staff, returns a temporary password once |
| POST   | `/api/users/{id}/password` | Session | admin — reset a password, revoke their sessions |
| GET/PUT| `/api/admin/login-settings` | Session | admin — sign-in method toggles (refuses the last one) |
| POST   | `/api/admin/settings/email/test` | Session | admin — send a test email through the designated sender; records the delivery proof |
| GET    | `/api/admin/email/providers` | Session | admin — every supported provider, configured or not, plus which sends/receives |
| PUT/DELETE | `/api/admin/email/providers/{provider}` | Session | admin — save or forget one provider's credentials |
| POST   | `/api/admin/email/providers/{provider}/test` | Session | admin — authenticate one provider; **does not** record the delivery proof |
| POST   | `/api/admin/email/providers/{provider}/connect` | Session | admin — start the mail OAuth handshake, returns `{ authorizeUrl }` |
| POST   | `/api/admin/email/oauth/complete` | Session | admin — redeems the `code`+`state` the provider handed to the SPA's `/oauth/callback` route; single-use `state`, workspace-scoped |
| PUT    | `/api/admin/email/roles` | Session | admin — designate the sending and receiving providers |
| GET/PUT| `/api/admin/email/config` | Session | admin — From identity, mode, inbound connector, poll interval. Replaced `/api/admin/settings/email`, which was deleted with the columns it wrote |
| GET    | `/api/admin/email/templates` | Session | admin — the whole catalogue merged with stored rows; `source: built-in\|custom` |
| GET    | `/api/admin/email/templates/{key}` | Session | admin — subject, body, variable contract, and the built-in alongside it for diff/reset |
| PUT    | `/api/admin/email/templates/{key}` | Session | admin — upsert; sanitises the body and refuses one that has lost a required variable |
| DELETE | `/api/admin/email/templates/{key}` | Session | admin — reset to built-in, i.e. delete the row |
| POST   | `/api/admin/email/templates/{key}/preview` | Session | admin — render the posted draft with sample data; a bodyless request renders what is stored |
| POST   | `/api/admin/email/templates/{key}/test` | Session | admin — send one template with sample data. **Does not** record the delivery proof (invariant 8) |
| POST   | `/api/invitations` | Session | admin — invite agents by email |
| POST   | `/api/invitations/accept` | None | Accept invite via token, create account |
| GET    | `/api/public/workspaces/{slug}/branding` | None | Public, cacheable — branding for form/widget |
| PUT    | `/api/admin/branding` | Session | admin — update logo, colour, portal title |
| GET    | `/api/public/login-methods?workspace=` | None | Which native methods are on + the providers for this surface |
| GET    | `/api/auth/sso?workspace=&connection=` | None | Start OIDC or OAuth 2.0 for one connection |
| GET    | `/api/auth/sso/callback` | None | One callback for both — `state` says which connection |
| GET    | `/api/auth/saml?workspace=&connection=` | None | Start SAML for one connection |
| POST   | `/api/auth/saml/acs` | None | SAML assertion consumer service |
| POST   | `/api/auth/magic-link/send` | None | Email a sign-in link + 6-digit code (rate-limited) |
| POST   | `/api/auth/magic-link/verify` | None | Consume link token or code → issue session |
| POST   | `/api/auth/logout` | Session | Clear session |
| GET    | `/api/users/me` | Session | Get current user profile |
| GET    | `/api/tickets/{id}/time` | AgentOrAdmin | Work logged on a ticket |
| POST   | `/api/tickets/{id}/time` | AgentOrAdmin | Log minutes + what was done |
| PUT    | `/api/tickets/{id}/time/{entryId}` | AgentOrAdmin | Own entry; admin may edit anyone's |
| DELETE | `/api/tickets/{id}/time/{entryId}` | AgentOrAdmin | Same rule as PUT |
| GET    | `/api/tickets/{id}/links` | AgentOrAdmin | Related work — stories, PRs, docs |
| POST   | `/api/tickets/{id}/links` | AgentOrAdmin | Add one; url must be absolute http(s) |
| DELETE | `/api/tickets/{id}/links/{linkId}` | AgentOrAdmin | Any agent may remove any link |
| GET    | `/api/ticket-statuses` | AgentOrAdmin | The vocabulary. `?includeInactive` for admin |
| GET    | `/api/ticket-statuses/reachable` | AgentOrAdmin | `?from=` — what the picker offers |
| GET    | `/api/ticket-statuses/categories` | AgentOrAdmin | The fixed five |
| POST   | `/api/ticket-statuses` | Admin | Add one to a category |
| PUT    | `/api/ticket-statuses/{id}` | Admin | Rename, recolour, recategorise, retire, set default |
| DELETE | `/api/ticket-statuses/{id}` | Admin | Only when unused and not built-in |
| GET    | `/api/ticket-statuses/workflow` | AgentOrAdmin | Every transition |
| PUT    | `/api/ticket-statuses/workflow` | Admin | Replaces the lot — see below |
| GET    | `/api/notifications` | Any | The caller's bell. `?unreadOnly` |
| GET    | `/api/notifications/unread-count` | Any | Just the badge number |
| POST   | `/api/notifications/{id}/read` | Any | Own rows only — no id in the filter |
| POST   | `/api/notifications/read-all` | Any | Same |

`GET /api/tickets` also takes `?mentioned=true` and `?watching=true`. Both are
**flags, not ids**: they resolve to the caller server-side, so there is no shape
of request that could ask for somebody else's mentions.

### Business hours, breach alerts and the scorecard

```sql
-- One row per workspace, so the workspace id IS the key.
CREATE TABLE business_hours (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    is_enabled   BOOLEAN NOT NULL DEFAULT false,   -- off = round-the-clock
    time_zone    TEXT NOT NULL DEFAULT 'UTC'       -- IANA; decides what "9am" means
);
-- A row per OPEN window. A closed day is the ABSENCE of a row — one fewer state
-- that can contradict itself than a flag plus hours would be.
CREATE TABLE business_hour_days (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES business_hours(workspace_id) ON DELETE CASCADE,
    day_of_week  INTEGER NOT NULL,   -- 0 = Sunday
    start_minute INTEGER NOT NULL,   -- minutes from local midnight; 540 = 09:00
    end_minute   INTEGER NOT NULL
);
CREATE TABLE business_holidays (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES business_hours(workspace_id) ON DELETE CASCADE,
    date         DATE NOT NULL,
    name         TEXT
);
CREATE UNIQUE INDEX ON business_holidays (workspace_id, date);

-- The breach sweep's memory. See below for why these are markers.
ALTER TABLE tickets ADD COLUMN sla_warning_sent_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_breach_sent_at  TIMESTAMPTZ;
CREATE INDEX ON tickets (resolve_due_at, first_response_due_at)
    WHERE status_category NOT IN ('resolved', 'closed');
```

**`BusinessCalendar` is pure and immutable** — built once from the schedule, then
asked questions, touching nothing. That is what makes arithmetic every SLA number
in the product depends on testable without a database.

Three ways it degrades to continuous, all deliberate: **off**, **an unresolvable
time zone** (falls back to UTC rather than silently using the server's), and
**enabled with no open days**. That last one matters most — treating it as "never
open" would push every deadline out forever, which looks exactly like the clock
being broken.

`SlaService` caches the calendar per workspace for the life of the scoped
service: one request can recompute deadlines twice and the schedule cannot change
mid-request.

**Deadlines are stored as UTC instants, never as remaining minutes.** Everything
downstream — the list's SLA column, the sort, the breach sweep — is then one
indexed comparison rather than a calculation per row. Existing deadlines are not
recomputed when the schedule changes: they were promised under the old one.

**The breach sweep marks rather than re-derives.** "Is it late" stays true from
the moment it goes late until somebody acts, so a sweep that re-derived it would
resend every minute until the recipient filtered the lot into a folder. Two
columns, because a warning and a breach are different messages and sending the
second must not depend on the first having gone. A ticket that goes straight past
the window gets its warning column stamped too, so it never warns about a
deadline already gone. Reopening clears both.

Warnings use a **fixed thirty-minute window**, not a proportion: 10% of a
four-hour target is 24 minutes and 10% of a five-day one is most of a day, while
a fixed window is the same promise on every ticket.

**The scorecard counts; it does not score.** Trackly deliberately has no agent
points number — an invented formula gets gamed within a month (cherry-picking
easy tickets, closing and reopening to reset a clock) and then measures nothing.
A leg with no policy is excluded from both halves, and attainment is null rather
than zero when nothing was measurable.

### Two-level taxonomies, and the resolution split

**Departments and categories each gained a `parent_id`, and the ticket gained a
second column for the narrower answer.** Not one column pointing at the leaf:
every rule, report and filter already reading `category_id` keeps meaning "the
top-level answer", and none of them had to learn about a tree.

Two levels, never three. A third means an agent navigating a hierarchy to file a
ticket, and it is reliably where a taxonomy starts disagreeing with itself.

The pair is validated on write — a sub-category whose parent is not the ticket's
category is refused — and clearing the parent clears the child, because a
sub-category with nothing above it is a label. Routing still reads `team_id`
only: narrowing to a sub-department labels the ticket and never changes who it
lands on.

Names are unique **within a parent**, not across the workspace: "Access" is a
legitimate sub-category of both Hardware and Software. The old workspace-wide
unique indexes were dropped for this.

**`tickets.resolution_summary` is the customer's half of the resolution.** The
internal note is engineering detail — "stale connection pool, patched in #4821" —
which is the right record for the team and the wrong thing to send a customer.
The summary is the one part of the resolution that reaches every surface;
everything beside it stays agent-only (invariant 5). It is **optional** while the
note is required: demanding two paragraphs to close a ticket is how you get "."
in both.

### The activity log

`GET /api/tickets/{id}/activity` — agent/admin only, newest first. Rows are
written by `ActivityLog`, which **queues and never saves**: the caller commits
them in the same `SaveChanges` as the change they describe. An entry that landed
while its change rolled back is worse than no entry — it is a log that lies, and
a log nobody trusts is one nobody reads. Same rule as `NotificationFeed`, so one
mutation queues both and saves once.

Two rules that keep the feed readable:

- **A no-op is not recorded.** Saving a form re-sends every field, so without
  this one "Save" would stamp a row for priority, category, team and assignee
  whether or not any of them moved.
- **The assignee is logged once, against the value the ticket ended up with.**
  Choosing a department round-robins an assignee and an explicit assignee in the
  same request overrides it; two rows would describe a state that never existed.

A status change into or out of a terminal category writes **two** rows — the
status move and a `resolved`/`reopened` event. Deliberate: those are what a
manager scans for, and finding them otherwise would mean knowing which of the
workspace's status names happen to be terminal.

Written by every path that mutates a ticket:

| Service | Entries |
|---|---|
| `TicketService` | create, property changes, replies and notes, watchers, related work, time |
| `AutomationService` | priority, status, department + the assignee it routes to, notes — **null actor** |
| `InboundEmailService` | ticket created from a cold email, and each emailed reply |
| `ChannelInboundService` | ticket created from Slack/WhatsApp/Teams, and each inbound message |
| `ChatService` | ticket created when a chat ends |
| `GuestService` | guest-submitted ticket, and each guest reply |
| `ProblemService` | problem link/unlink, and both entries per ticket on bulk-resolve |
| `AttachmentService` | files on the ticket (not on a reply — that reply has its own entry) |

**The SLA clock writes nothing, on purpose.** Everything it does is a
consequence of something already in the feed: `ApplyOnCreate` is part of
creation, `OnPriorityChanged` follows a logged priority change, `OnStatusChanged`
pauses or resumes because of a logged status change, and `OnAgentReply` follows a
logged reply. Entries for those would double every line. `AdoptUncoveredAsync` is
the one independent case — an admin saving a policy backfills deadlines onto
existing tickets — and it is left out because writing a row onto hundreds of
tickets at once would bury each feed under something that is not about that
ticket.

**Ticket creation queues `created` BEFORE automation runs.** Entries are ordered
by `created_at` and everything in one request lands inside the same millisecond,
so insertion order is the only thing keeping the story straight — queued after,
"raised this ticket" would appear underneath the rules that fired on it.

`actor_id` is null for automation, guests and chat visitors, and the feed renders
those as **Trackly**. Not a fallback: nobody with an account did it.

### Statuses and the workflow

`PUT /workflow` **replaces** every transition in one call. A matrix screen edits
every cell at once, so sending diffs would put the "what changed" calculation in
the client — which is how a half-applied workflow happens, with a ticket that
can no longer move anywhere.

Where the workflow is and is not enforced, and why:

| Path | Enforced? | Why |
|---|---|---|
| `PATCH /api/tickets/{id}` | **Yes** | A picker is not a rule. The whole point is that it holds for anything that can post JSON. |
| Automation `set_status` | No | A rule is the workspace's own approved instruction; a restriction meant to guide agents through a picker should not silently disarm it. |
| Problem bulk-resolve | No | Closing a problem is one decision about all its tickets; a rule blocking one would leave the problem resolved with a ticket open under it. |

Retiring a status keeps it on tickets that already carry it and removes it from
pickers. Deleting is refused while any ticket holds the value — a ticket showing
a value with no name reads as corrupt data, not as history.

**Both writes that clear transitions load them and `RemoveRange`, rather than
`ExecuteDelete`.** Two reasons, and each on its own is enough:

- `ExecuteDelete` commits its own transaction. In `SetTransitionsAsync` a
  failure while inserting the replacements would leave the workspace with **zero**
  rules — and an empty table means *allow everything*, so a workflow save that
  died halfway would silently unlock every transition it was meant to restrict.
  In `DeleteAsync` it would leave the status alive with its rules gone:
  unreachable, for no reason visible on any screen.
- It deletes behind the change tracker. Any transition already materialised in
  the same scope stays in memory pointing at a row that is gone, and removing
  the status then fails as a severed required relationship. Request-scoped
  contexts hide this today; a background job or a second call in one request
  would not.

The table holds at most one row per status pair, so reading it back costs
nothing next to being wrong. The `ExecuteUpdate` calls in `UpdateAsync` stay —
one is a genuine bulk write across every affected ticket, and the other clears
`is_default` on a scalar nothing reads back in the same scope.

**Admin screens.** `/admin/settings/statuses` — two tabs, one component each.
The catalogue groups by category with the behaviour of each spelled out on the
section header, because "which one pauses the SLA?" is the question an admin has
before they file anything. The workflow tab is a matrix: rows are the current
status (plus an *Any status* row for `from_status_id IS NULL`), columns are the
destination. A cell the *Any* row already covers renders ticked and disabled —
it is allowed either way, and letting it be cleared there would do nothing.
Transitions involving a **retired** status are not drawn but are carried through
the save untouched; dropping them would quietly empty the workflow of any status
brought back later.

### List filtering, sorting and facets

`GET /api/tickets` and `GET /api/tickets/facets` take **the same query object**.
One filter state, two endpoints — two shapes would drift, and the symptom is
facet counts that do not add up to the rows beneath them.

Multi-value filters are lists (`?status=open&status=pending`). A single value
still binds to a one-element list, so callers written before this keep working.
`unassigned=true` is its own flag because "nobody" has no id; given alongside
`assigneeId` it reads as an OR ("mine or nobody's").

`sort` ∈ `updated | created | priority | status | subject | due`, `desc` boolean.
Two rules that are not decoration:

- **Every sort tie-breaks on `id`.** Without it, two tickets updated in the same
  millisecond — which happens constantly, because automation touches several at
  once — can swap places between page 1 and page 2, showing one twice and
  another never.
- **`priority` sorts by the configured `ticket_options.sort_order`**, via a
  correlated subquery, not alphabetically. A value whose option row was deleted
  sorts last: an orphan is not urgent.

The summary DTO carries **both** `teamId`/`teamName` (the department the ticket
is routed to) and `category`. They are different dimensions — who owns it versus
what it is about — and the list shows a column for each. One column labelled
"Dept" rendering the *category* is what made a ticket routed to IT Support read
as "Test". Like tags and the SLA beside them, the team fields are agent-facing
and come back null on customer and guest surfaces.
- **`due` puts nulls last in both directions.** No SLA is neither the most nor
  the least urgent.

Facet groups are each counted with every filter applied **except their own** —
that is what makes the rail navigable rather than a dead end.

The bar above the table carries the four filters people reach for constantly —
status, priority, assignee, channel — and everything else lives behind **More**,
which is the facet panel. Both write to the **same URL params**, so they are one
filter state rather than two that can disagree: a pick on the bar shows as a tick
in the panel and is counted in its badge. The bar's selects are single-value; a
group holding two or more shows its "All" row rather than picking one of them to
display, because there is no honest single answer and the panel is where a
multi-select is both made and read.

The channel select reads the workspace's configured `ticket_options`, **not** the
channel facet. The facet only returns values tickets currently carry, so a
workspace that has just switched WhatsApp on would have no way to filter for it
until the first WhatsApp ticket arrived — and the facets are only fetched once
the panel has been opened, while this select is always on screen.

### Bulk actions

`POST /api/tickets/bulk` — one action across a selection, agent/admin, capped at
**100 tickets** (the list pages at 20; five pages' worth still finishes inside a
request). Actions: `assign`, `priority`, `status`, `tag`, `pin`, `flag`, `delete`.

Three decisions worth keeping:

- **Every action routes through the single-ticket path.** Assign, priority and
  status build an `UpdateTicketRequest` and call `TicketService.UpdateAsync` once
  per ticket. A single `ExecuteUpdate` would obviously be faster and would also
  skip the workflow rules, the activity log, the SLA clock, the watcher
  notifications and the resolution email — and skip them *silently*. Nothing
  about a bulk assign that sent no notifications looks wrong until somebody asks
  why they were never told about forty tickets.
- **The result is partial by design.** `{ succeeded, failed[], requested }`, where
  each failure names the ticket and the rule that refused it. All-or-nothing
  sounds safer and is worse: one forbidden transition out of forty would undo
  thirty-nine legitimate changes, and the agent's only recourse would be
  deselecting rows by guesswork. Each ticket is already its own transaction, so
  partial is also what the database actually does. **The client must read the
  result** — the request resolves successfully when some of the batch failed.
- **`tag` adds, never replaces.** Replacing would strip every label forty tickets
  already carried because somebody wanted to add "escalated" to all of them.

`delete` is **admin-only** and is the only hard delete of a ticket in Trackly.
Most children go by database cascade, but two things cannot and must be cleared
by hand first, both because their incoming foreign key is `NO ACTION` (PostgreSQL
refuses a schema with two cascade paths into one table):

- `ticket_relations.related_ticket_id` — links pointing *at* the ticket.
- `comment_mentions.ticket_id` — **not** cleared by the comment cascade, despite
  what the model comment used to claim. PostgreSQL checks the ticket's
  referencing keys against the row being deleted, while the cascade that would
  empty `comment_mentions` hangs off `comments`, one level further down. The
  constraint fires first and the delete is refused.

Both are **loaded and `RemoveRange`d, not `ExecuteDelete`d**. `ExecuteDelete`
writes past the change tracker, so a relation the request already loaded is still
there when the ticket is removed and EF refuses the save with "the association
has been severed" for a row the database no longer has; it also commits its own
transaction, so a failure in between would leave the links gone and the ticket
intact. Attachment blobs are deleted **after** the row commits — the other order
leaves a live ticket whose attachments 404.

**Selection is scoped to what is on screen.** The client holds ids, not tickets,
and intersects them with the current page before acting. The header tick selects
that page only: a tick that silently picked up 248 unseen tickets and then
offered Delete is not a convenience.

> **EF note.** Every facet groups in SQL and shapes in memory
> (`GroupBy(...).Select(g => new { ... primitives ... }).ToListAsync()`, then map).
> Projecting straight into a record and ordering by one of its properties does
> not translate and throws at query-compile time — it has bitten this file once
> already.
| POST   | `/api/users/{id}/avatar` | Session | Own photo always; anyone else's needs agent/admin. 1 MB, PNG/JPEG/WebP |
| DELETE | `/api/users/{id}/avatar` | Session | Same rule as POST |
| GET    | `/api/users/{id}/avatar` | Session | Any member of the same workspace. Streamed, never redirected to a CDN |
| GET    | `/api/tickets` | Session | agent/admin: all; customer: own |
| POST   | `/api/tickets` | Session | customer, agent, admin |
| GET    | `/api/tickets/channels` | Session | agent/admin — channel suggestions (used + built-in) |
| GET    | `/api/tickets/{id}` | Session | owner or agent/admin |
| PATCH  | `/api/tickets/{id}` | Session | agent/admin |
| POST   | `/api/tickets/bulk` | Session | agent/admin; `delete` admin-only. Returns a partial result, never 204 |
| POST   | `/api/tickets/{id}/comments` | Session | owner or agent/admin |
| POST   | `/api/guest/otp/send` | None | Public — send 6-digit OTP to guest email (rate-limited) |
| POST   | `/api/guest/otp/verify` | None | Public — verify OTP, returns short-lived submission token |
| POST   | `/api/tickets/guest` | None | Public — anonymous submission (requires verified submission token) |
| GET    | `/api/tickets/guest/{id}?token=` | None | Guest magic link |
| POST   | `/api/tickets/{id}/attachments` | Session or guest token | Upload attachment |
| GET    | `/api/attachments/{id}` | Session or guest token | Download via signed URL (visibility-checked) |
| GET    | `/api/admin/sso` | Session | admin — provider catalogue + configured connections + the redirect URI to register |
| POST   | `/api/admin/sso` | Session | admin — add a connection |
| PUT    | `/api/admin/sso/{id}` | Session | admin — full save of one connection |
| PATCH  | `/api/admin/sso/{id}` | Session | admin — just the switches (enabled, audiences, order); refuses to hide the last proven way in |
| DELETE | `/api/admin/sso/{id}` | Session | admin — remove one; same refusal |
| GET    | `/api/problems` | Session | agent, admin |
| POST   | `/api/announcements` | Session | admin |

---

### 3. Database Schema (PostgreSQL — `trackly` database)

> **Source-of-truth note (kept current).** The SQL below captures the **Phase 1–5
> core**. From Phase 6 on, tables are defined by the **EF Core entities in
> `src/Trackly.Core/Entities` + the migrations in
> `src/Trackly.Infrastructure/Data/Migrations`** — those are authoritative for
> columns, types, and indexes. The DDL here is illustrative and is **not**
> regenerated per migration. Tables added after this block (apply migrations to
> get them all — see go-live.md §0.1):
>
> | Phase | Tables / columns added |
> |------|------------------------|
> | 5 | `sso_login_states` (OIDC/SAML in-flight state) |
> | 6 | `problems`, `announcements`, `announcement_deliveries`, `widget_configs` (some shown inline in feature sections above) |
> | 7A | `tags`, `ticket_tags`, `teams`, `team_members`, `sla_policies`, `kb_articles`, `canned_responses`, `automation_rules`; `tickets` gains `first_response_due_at`, `resolve_due_at`, `first_response_at`, `sla_paused_at` |
> | 7B | `workspaces.ai_enabled` |
> | 7C | `csat_surveys`; `channel_connectors`, `channel_conversations`, `inbound_channel_events`; `chat_sessions`, `chat_messages`; `tickets.resolved_at`; `notification_settings.csat_enabled` |

```sql
-- Workspaces (Trackly's own multi-tenancy — no dependency on external IdP)
CREATE TABLE workspaces (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT NOT NULL,
    slug                   TEXT NOT NULL UNIQUE,   -- fixed to "default"; kept for ?workspace= links
    email_login_enabled    BOOLEAN DEFAULT true,   -- magic-link fallback; off = SSO-only login
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now()
);

-- SSO connections (several per workspace — one button each)
CREATE TABLE sso_connections (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL DEFAULT 'oidc',  -- kind: google, microsoft, facebook, authly, oidc, saml
    provider_name      TEXT NOT NULL,       -- the BUTTON LABEL, e.g. "Acme SSO". Editable.
    protocol           TEXT NOT NULL,       -- 'oidc', 'saml' or 'oauth2' — set from the catalogue
    -- OIDC / OAuth2 fields
    discovery_endpoint TEXT,                -- only when the admin supplies it (Authly, custom)
    client_id          TEXT,
    client_secret      TEXT,               -- AES-256-GCM encrypted
    tenant             TEXT,                -- Entra directory id; the discovery URL is built from it
    scopes             TEXT,                -- override; null uses the catalogue default
    -- SAML fields
    idp_metadata_url   TEXT,
    idp_metadata_xml   TEXT,
    sp_entity_id       TEXT,
    -- Reach
    allowed_email_domains  TEXT,            -- comma separated; empty = any
    is_enabled             BOOLEAN NOT NULL DEFAULT true,
    show_on_staff_login    BOOLEAN NOT NULL DEFAULT true,
    show_on_customer_login BOOLEAN NOT NULL DEFAULT false,
    sort_order             INT NOT NULL DEFAULT 0,
    -- Status
    status             TEXT DEFAULT 'pending',  -- pending, active, error
    tested_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- One of each well-known provider. The custom kinds are exempt, because two
-- corporate IdPs is a real setup and two Googles never is.
CREATE UNIQUE INDEX ix_sso_connections_workspace_id_provider
    ON sso_connections (workspace_id, provider)
    WHERE provider NOT IN ('oidc', 'saml');
CREATE INDEX ix_sso_connections_workspace_id_sort_order
    ON sso_connections (workspace_id, sort_order);

-- IdP group → Trackly role mappings
CREATE TABLE sso_group_role_mappings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
    group_name    TEXT NOT NULL,    -- IdP group name e.g. "support-agents"
    trackly_role  TEXT NOT NULL     -- 'customer', 'agent', 'admin'
);

-- Trackly users (primary source of truth — not a cache)
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email         TEXT,
    phone         TEXT,
    name          TEXT,
    -- Profile photo. A STORAGE KEY, not a URL: the photo is private and is only
    -- served by GET /api/users/{id}/avatar, which checks the workspace first.
    -- The response path carries a ?v= token derived from this key, so it can be
    -- cached immutably and a replacement busts it. Never given a CDN URL —
    -- SaveAsync uses the default Private visibility, so PublicUrlAsync refuses.
    avatar_storage_key  TEXT,
    avatar_content_type TEXT,
    role          TEXT NOT NULL DEFAULT 'customer',  -- customer, agent, admin
    password_hash          TEXT,                   -- PBKDF2; null for SSO/code-only users
    must_change_password   BOOLEAN DEFAULT false,  -- temporary password issued by an admin
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    CONSTRAINT email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL),
    UNIQUE (workspace_id, email)
);

-- Agent/admin invitations (onboarding Step 4 and /admin/users)
CREATE TABLE workspace_invitations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'agent',   -- agent or admin
    token_hash   TEXT NOT NULL UNIQUE,            -- SHA-256 of the invite link token
    invited_by   UUID NOT NULL REFERENCES users(id),
    expires_at   TIMESTAMPTZ NOT NULL,            -- 7 days
    accepted_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Links Trackly users to external IdP identities (for JIT provisioning)
CREATE TABLE user_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
    provider_sub  TEXT NOT NULL,   -- 'sub' claim from IdP
    is_active     BOOLEAN DEFAULT true,  -- false when the workspace switches providers
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (connection_id, provider_sub)
);

-- Trackly sessions (issued after SSO or password login)
-- The cookie holds a random 256-bit token; only its SHA-256 hash is stored,
-- so a DB leak does not yield usable sessions.
CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash   TEXT NOT NULL UNIQUE,   -- SHA-256 of the session token in the cookie
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ip_address   TEXT,
    user_agent   TEXT,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Email verification tokens — shared by guest OTP AND passwordless login.
-- Each row carries both a magic-link token and a 6-digit code for the
-- same attempt; either one consumes the row.
CREATE TABLE email_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
                                            -- NULL for global sends from trackly.com
                                            -- (login/signup before a workspace is known);
                                            -- the workspace is resolved at verify time
    email           TEXT NOT NULL,
    purpose         TEXT NOT NULL,          -- 'guest_verify' | 'login'
    link_token_hash TEXT UNIQUE,            -- SHA-256 of the magic-link token (256-bit random)
    code_hash       TEXT NOT NULL,          -- SHA-256 of the 6-digit code
    attempts        INT DEFAULT 0,          -- locked after 5 failed code attempts
    expires_at      TIMESTAMPTZ NOT NULL,   -- 10 minutes
    consumed_at     TIMESTAMPTZ,            -- single-use
    created_at      TIMESTAMPTZ DEFAULT now()
);
-- Rate limiting: max 3 sends per email per 15 minutes, plus per-IP limits
-- on the public endpoints (email-spam protection).
-- Magic-link verify page never consumes the token on GET (link scanners
-- prefetch URLs) — only the explicit "Confirm sign-in" POST does.

-- Statuses a workspace defines for itself, and the workflow between them.
--
-- THE ONE RULE: a workspace invents statuses; Trackly only ever reasons about
-- their CATEGORY. Five categories, fixed — open, pending, active, resolved,
-- closed — and every behaviour in the system is written against those:
--
--   open      SLA response clock runs
--   pending   resolve clock PAUSES (waiting on someone outside the team)
--   active    clocks run
--   resolved  stamps resolved_at, issues the CSAT survey, stops the clock
--   closed    stops the clock, no survey
--
-- That split is what lets a team add "Estimation required", "Testing" or
-- "Awaiting CAB" without Trackly needing to know they exist. The alternative —
-- features testing status NAMES — is how a helpdesk ends up with
-- `if (status == "Done" || status == "Complete" || status == "Closed")`
-- scattered through it, one arm short in three places.
--
-- Statuses are seeded lazily on first read (one per category), like
-- ticket_options: it fixes existing workspaces and new ones by the same path.
CREATE TABLE ticket_statuses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    category     TEXT NOT NULL,   -- open | pending | active | resolved | closed
    value        TEXT NOT NULL,   -- lands on the ticket; stable, never edited
    name         TEXT NOT NULL,   -- what people read; safe to change
    color        TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT true,   -- retired = keeps existing tickets, leaves pickers
    is_default   BOOLEAN NOT NULL DEFAULT false,  -- where a new ticket starts; exactly one
    is_system    BOOLEAN NOT NULL DEFAULT false   -- shipped: renameable, never deletable
);
-- Unique because the value sits on every ticket: two statuses sharing one would
-- be indistinguishable once stored.
CREATE UNIQUE INDEX ON ticket_statuses (workspace_id, value);

-- The workflow: which moves are legal. Transitions only — no conditions,
-- validators or post-functions. Those are a different feature and overlap the
-- automation engine.
CREATE TABLE ticket_status_transitions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- NULL = "from any status" (Jira's ANY STATUS). A workspace that has never
    -- touched the workflow is seeded entirely with these, reproducing the old
    -- behaviour where every status reached every other.
    from_status_id UUID REFERENCES ticket_statuses(id),
    to_status_id   UUID NOT NULL REFERENCES ticket_statuses(id)
);
CREATE INDEX ON ticket_status_transitions (workspace_id, from_status_id);

-- AN EMPTY TRANSITION TABLE MEANS EVERYTHING IS ALLOWED, NOT NOTHING. A
-- workspace whose rows were somehow all deleted must not become a place where
-- no ticket can ever change status again.
--
-- One workflow per workspace, not per department or ticket type. Both of those
-- are defensible and neither is built; adding one later means a scope column on
-- both tables, not a redesign.

-- Tickets
CREATE TABLE tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    subject          TEXT NOT NULL,
    description      TEXT NOT NULL,
    -- A ticket_statuses.value, NOT a foreign key: it is what automation rules
    -- match, what the email and chat connectors write, and what every row
    -- already held before workflows existed.
    status           TEXT NOT NULL DEFAULT 'open',
    -- The category of that status, denormalised. EVERY RULE IN TRACKLY TESTS
    -- THIS, never the status. Keeping it on the row is what lets "open
    -- tickets", "pause the clock", "ask for a resolution note" and "issue a
    -- CSAT survey" stay single indexed comparisons instead of a join in every
    -- query. Written whenever status is written; re-written across affected
    -- tickets when an admin moves a status to another category.
    status_category  TEXT NOT NULL DEFAULT 'open',
    priority         TEXT NOT NULL DEFAULT 'medium',  -- low, medium, high, urgent
    category_id      UUID REFERENCES categories(id),
    requester_id     UUID REFERENCES users(id),       -- null if anonymous
    guest_email      TEXT,
    guest_name       TEXT,
    guest_token_hash TEXT,                            -- SHA-256 of magic link token
    assignee_id      UUID REFERENCES users(id),
    problem_id       UUID REFERENCES problems(id) ON DELETE SET NULL,
    channel          TEXT NOT NULL DEFAULT 'web',      -- web, widget, email
    -- Why it was resolved or closed. REQUIRED on the transition out of
    -- open/pending — enforced in TicketService.UpdateAsync, not in the dialog,
    -- so the rule holds for any caller. Cleared on reopen; the copy written into
    -- the thread as an internal comment is what keeps the history.
    -- Agent-facing: null for every non-agent caller (invariant 5).
    resolution_note  TEXT,
    resolution_link  TEXT,                             -- user story / PR, http(s) only
    resolved_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT requester_or_guest CHECK (requester_id IS NOT NULL OR guest_email IS NOT NULL)
);

-- Work logged against a ticket. Many rows, not one total on the ticket: a
-- ticket is worked in sittings and often by more than one person, and a single
-- number could not say who spent it or on what.
--
-- Typed in rather than measured by a running clock. A timer is left going
-- overnight or never started, and either way the figure is corrected by hand.
CREATE TABLE ticket_time_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    -- RESTRICT: Trackly deactivates people rather than deleting them, and this
    -- is a record of time already spent — it must not vanish with the user row.
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    minutes      INTEGER NOT NULL,
    note         TEXT,
    spent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the work happened
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT time_entry_minutes_positive CHECK (minutes > 0)
);
CREATE INDEX ON ticket_time_entries (ticket_id, spent_at);
CREATE INDEX ON ticket_time_entries (workspace_id, user_id);

-- Related work: the stories, PRs and docs a ticket is about.
--
-- Separate from tickets.resolution_link, which is the link for the resolution
-- the ticket CURRENTLY has and is cleared on reopen. These rows are the
-- ticket's references and outlive any one resolution, so neither replaces the
-- other. The resolve dialog copies its link in here so both lists agree.
--
-- The ticket's audit trail, behind the Activity tab.
--
-- STORES WHAT CHANGED, NEVER A SENTENCE. A row holds a type and two labels and
-- the client builds the wording. Trackly ships in two languages; a row that
-- already read "changed status to Open" would be frozen in whichever one the
-- person making the change happened to have selected.
--
-- THE LABELS ARE CAPTURED AS THEY READ AT THE TIME, which is why they are plain
-- text and not foreign keys. An audit trail records what happened: renaming a
-- status to "QA" must not rewrite last month's entries into changes nobody made,
-- and deleting a category must not blank the rows that mention it. The actor is
-- the exception — an id, rendered live, because a person's name changing is a
-- fact about them rather than about the ticket.
--
-- Agent-facing (invariant 5): the feed records THAT a private note was written,
-- never its words, and never reaches a customer or guest surface at all.
CREATE TABLE ticket_activities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    -- NULL = Trackly did it: automation, an inbound email, the SLA clock.
    -- SET NULL rather than CASCADE: removing an agent must not erase the changes
    -- they made.
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    type         TEXT NOT NULL,   -- created | status | priority | assignee | …
    from_label   TEXT,            -- NULL for one-sided events
    to_label     TEXT,            -- the "after", or the detail of a one-sided event
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON ticket_activities (ticket_id, created_at);

-- TICKET-TO-TICKET LINKS. Stored ONCE and read from both ends: the inverse of a
-- kind is a pure function (TicketRelationKind.Inverse), so "A duplicates B" is
-- shown on B as "duplicated by A" with no second row that could fall out of
-- step. Two rows for one fact is how a pair goes half-broken when one is deleted.
--
-- related_ticket_id is NO ACTION, not CASCADE: two cascade paths from tickets
-- into one table is a schema PostgreSQL will not create. TicketRelationService
-- .ClearIncomingAsync exists for that, and must run before a ticket is deleted.
CREATE TABLE ticket_relations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id         UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    related_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE NO ACTION,
    kind              TEXT NOT NULL,   -- relates | duplicates | blocks | caused_by | …
    created_by_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ON ticket_relations (ticket_id, related_ticket_id, kind);

-- A CHECKLIST, not sub-tickets. A sub-ticket has its own requester, SLA, status
-- vocabulary and inbox, and none of that is wanted for "call the vendor".
--
-- NOTHING BLOCKS ON THEM. An open task does not stop the ticket being resolved:
-- a hard block means a ticket nobody can close because of an item somebody added
-- and forgot, and the usual escape is deleting the task, which loses the record.
CREATE TABLE ticket_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id       UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    due_at          TIMESTAMPTZ,
    -- NULL = open. One column carrying both the flag and the timestamp, so they
    -- cannot contradict each other.
    completed_at    TIMESTAMPTZ,
    completed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- RESPONDERS ARE NOT WATCHERS. A watcher is reading; a responder is doing.
-- Merging them means either notifying every bystander as though they owed the
-- customer an answer, or leaving the second engineer on an incident with no way
-- to say they are on it. Adding a responder ALSO writes a watcher row, so being
-- on the ticket means not missing the next reply; removing one leaves the
-- watcher row, because "take me off this" is a different statement.
--
-- Still exactly one assignee: "everyone is responsible" is how a ticket ends up
-- with nobody answering it.
CREATE TABLE ticket_responders (
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    agent_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT,                     -- "network side", "vendor liaison" — free text
    added_by  UUID,
    added_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticket_id, agent_id)
);

-- THE ASSET REGISTER. Deliberately thin — a real CMDB has relationships,
-- lifecycle states and discovery, and a bad one is worse than none because
-- people put data in it and then cannot trust it. What Trackly needs is "which
-- machine is this ticket about" and "what else has been raised about it".
CREATE TABLE assets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    kind           TEXT,               -- free text; the next workspace's list differs
    tag            TEXT,               -- serial / asset tag
    location       TEXT,
    assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes          TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT true,   -- retire, never delete once used
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);
-- Sparse: many assets have no tag, but a tag that IS set must identify exactly
-- one thing or it is not an asset tag.
CREATE UNIQUE INDEX ON assets (workspace_id, tag) WHERE tag IS NOT NULL;

CREATE TABLE ticket_assets (
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_by  UUID,
    added_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticket_id, asset_id)
);

-- THE SERVICE CATALOGUE. An asset is a thing you own; a service is a thing you
-- promise. "Payments is down" and "this laptop is broken" are different
-- sentences with different audiences, and a workspace counts them separately.
--
-- Named business_services because the codebase is full of *Service classes and a
-- domain entity sharing that suffix would be misread on every import line.
CREATE TABLE business_services (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ON business_services (workspace_id, name);

-- `impact` is what makes the row worth having. "Payments" says almost nothing;
-- "Payments — card captures failing for EU customers since 09:40" is the
-- sentence whoever writes the status page needs, written once instead of three
-- times in the thread. Upserted, not appended: the first note in an incident is
-- a guess, and refining it is an edit.
CREATE TABLE ticket_impacted_services (
    ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
    impact     TEXT,
    level      TEXT NOT NULL DEFAULT 'degraded',   -- down | degraded | minor
    added_by   UUID,
    added_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticket_id, service_id)
);

-- THE WORKSPACE'S OWN TICKET PROPERTIES.
--
-- Trackly's properties are columns because the product reasons about them — SLA
-- clocks, routing, counts, permissions. Anything a workspace invents cannot be
-- reasoned about by code that has never heard of it, so it lives here as data
-- and NOTHING acts on it: it is stored, shown and searched, and that is the
-- trade for being able to invent it.
--
-- `key` is derived from the label once and NEVER edited: it is what every stored
-- answer points at. The TYPE is not editable either — a text field becoming a
-- checkbox would leave a column of sentences that render as neither ticked nor
-- unticked, and there is no honest migration for that.
CREATE TABLE ticket_fields (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key               TEXT NOT NULL,
    label             TEXT NOT NULL,
    type              TEXT NOT NULL DEFAULT 'text',   -- text | select | radio | checkbox
    help_text         TEXT,
    -- Newline-separated, not JSON: an admin edits this in a textarea and a
    -- malformed array is a field nobody can fill in.
    options           TEXT,
    -- A select that accepts a value not on the list and REMEMBERS it. Without
    -- this, filling in a ticket means stopping to ask an admin to add "Mumbai"
    -- to a list of offices, and the field gets left blank instead.
    allow_new_options BOOLEAN NOT NULL DEFAULT true,
    -- Only ever enforced for an agent editing a ticket. A required custom field
    -- can never block an inbound email or a chat transcript from becoming a
    -- ticket: the customer has no idea it exists.
    is_required       BOOLEAN NOT NULL DEFAULT false,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ON ticket_fields (workspace_id, key);

-- A row per ANSWERED field, not a JSON blob on the ticket: this is what lets a
-- value be filtered and counted in SQL, and stops one malformed write corrupting
-- every other answer.
--
-- AN EMPTY ANSWER IS NO ROW. Clearing a field deletes it, so "never answered"
-- and "answered with nothing" cannot drift into two states that look identical
-- on screen and behave differently in a query. A checkbox is the exception:
-- unticked is a real answer and stores "false".
CREATE TABLE ticket_field_values (
    ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    field_id   UUID NOT NULL REFERENCES ticket_fields(id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticket_id, field_id)
);
CREATE INDEX ON ticket_field_values (field_id, value);

-- Agent-facing: engineering references, on the same footing as a private note
-- (invariant 5). Never projected onto a customer or guest surface.
CREATE TABLE ticket_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    url           TEXT NOT NULL,          -- absolute http(s), validated on write
    title         TEXT,                   -- falls back to the URL when absent
    kind          TEXT NOT NULL DEFAULT 'related',  -- related | story | pr | doc
    -- SET NULL: the link is about the work, not about who filed it.
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT now()
);
-- Unique, so one URL cannot be added to a ticket twice. Its leading column also
-- serves the card's read, which is why there is no separate ticket_id index.
CREATE UNIQUE INDEX ON ticket_links (ticket_id, url);
CREATE INDEX ON ticket_links (workspace_id);
CREATE INDEX ON ticket_links (created_by_id);

-- Comments / replies
CREATE TABLE comments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id        UUID REFERENCES users(id),   -- null for guest comments
    guest_email      TEXT,                        -- set for guest replies
    body             TEXT NOT NULL,
    -- 'text' or 'html'. A column, not a guess: "<3 that fix" is plain text that
    -- reads as markup, and sniffing would render a customer's words as a broken
    -- tag. Defaulting to 'text' also keeps every pre-composer row correct.
    --
    -- HTML bodies are sanitised on WRITE (Trackly.Infrastructure.Text.RichText,
    -- HtmlSanitizer/AngleSharp) against a small allowlist: p, br, div, span,
    -- strong/b, em/i, u, s, ul/ol/li, blockquote, pre, code, h3, h4, a, hr —
    -- href/title/class(language-*) only, http(s)/mailto only. Nothing
    -- downstream re-checks, so nothing downstream may skip it.
    body_format      TEXT NOT NULL DEFAULT 'text',
    -- 'public' | 'internal' | 'private'.
    --   public   — the customer sees it; the only kind that leaves Trackly
    --   internal — every agent in the workspace sees it, no customer does
    --   private  — ONLY the author, including from an admin. A note nobody else
    --              can read is only useful if that is actually true.
    visibility       TEXT NOT NULL DEFAULT 'public',
    -- Kept in step with visibility (= visibility <> 'public') and still what
    -- every customer-facing filter tests. Invariant 5 is enforced by THIS
    -- boolean; adding a level a filter forgot about is how it breaks quietly.
    is_internal      BOOLEAN DEFAULT false,
    source           TEXT DEFAULT 'web',          -- 'web' or 'email'
    email_message_id TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- Somebody named in a comment.
--
-- A row rather than re-parsing every body on read: "tickets where I was
-- mentioned" is a nav item with a count beside it, and scanning the workspace's
-- comments to build it is not a query anybody wants on each page load.
--
-- The mention list is DERIVED FROM THE BODY server-side, never taken from a
-- field beside it: two lists that can disagree is one too many, and a
-- hand-written request could otherwise ping anyone without naming them.
CREATE TABLE comment_mentions (
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Denormalised from the comment, purely for the query above.
    -- NO ACTION, not CASCADE: the comment's cascade already clears these, and a
    -- second cascade path from tickets is one PostgreSQL refuses to create.
    ticket_id  UUID NOT NULL REFERENCES tickets(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX ON comment_mentions (user_id, ticket_id);
CREATE INDEX ON comment_mentions (ticket_id);

-- The in-app bell. Distinct from the email notifications: email is for people
-- who are NOT looking at Trackly, this is for people who are. A mention writes
-- both, because it should reach you either way.
--
-- Stores WHAT HAPPENED, never a sentence. "Priya mentioned you" as a stored
-- string would freeze the notification in whatever language the server was
-- running in; the client renders it from type + actor + ticket.
CREATE TABLE notifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
    type         TEXT NOT NULL,   -- mention | watching | assigned | reply
    -- CASCADE: a bell row that leads to a 404 is worse than no row.
    ticket_id    UUID REFERENCES tickets(id) ON DELETE CASCADE,
    comment_id   UUID,
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    preview      TEXT,             -- plain text only, never markup
    read_at      TIMESTAMPTZ,      -- null = unread; a timestamp, so "when" survives
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at);
CREATE INDEX ON notifications (user_id, read_at);

-- Attachments (on tickets and comments)
CREATE TABLE attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    comment_id   UUID REFERENCES comments(id) ON DELETE CASCADE,  -- null if attached to the ticket itself
    uploaded_by  UUID REFERENCES users(id),   -- null for guest uploads
    file_name    TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,             -- enforce max size (e.g. 10 MB) at API level
    storage_key  TEXT NOT NULL,               -- provider-prefixed key, see below
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Storage is PER WORKSPACE, not per deployment: an admin picks local disk,
-- Azure Blob or GCS under Admin → Storage, and brings their own bucket.
CREATE TABLE storage_configs (
    id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider                          TEXT NOT NULL DEFAULT 'local',  -- local | azure | gcs
    azure_connection_string_encrypted TEXT,       -- AES-256-GCM
    azure_container                   TEXT,
    gcs_credentials_json_encrypted    TEXT,       -- AES-256-GCM
    gcs_bucket                        TEXT,
    path_prefix                       TEXT,       -- folder inside the bucket, e.g. 'trackly'
    public_base_url                   TEXT,       -- optional CDN origin, maps to the bucket root
    last_verified_at                  TIMESTAMPTZ,
    updated_at                        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (workspace_id)
);

-- storage_key carries the provider that WROTE it: 'gcs:trackly/…',
-- 'azure:…', 'local:…', plus a '-public' variant ('gcs-public:…'). Reads route
-- on that prefix, never on the workspace's current setting — otherwise
-- switching provider would orphan every file written beforehand, with no way
-- to recover it from the key alone. An unprefixed key predates this and means
-- local disk. Azure and GCS credentials therefore live in separate columns, so
-- a switch leaves the old provider's still readable.
--
-- Only '-public' keys (workspace logos) are ever given a CDN URL. Attachments
-- are always served by GET /api/attachments/{id} after the visibility checks,
-- because a CDN link carries no sign-in and would bypass invariant 5. Signed
-- URLs issued after the permission check (Azure SAS / GCS V4) are the intended
-- answer if attachment throughput ever needs one — not a public CDN.

-- Categories
CREATE TABLE categories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    color        TEXT
);
```

---

### 4. SSO Setup — Authly as a Provider (Optional)

If a customer uses Authly, they configure it as a **Custom OIDC** connection in Trackly:

```
Step 1 — Select provider: "Authly" (or "Custom OIDC")
Step 2 — In Authly TenantAdmin → Applications → New SPA client
          Redirect URI: https://trackly.yourdomain.com/auth/callback
          Copy client_id
Step 3 — Claims: sub, email, given_name, family_name already in Authly JWT.
          For group mapping: configure a custom claim "groups" in Authly
          using the ClaimConfig feature (webhook-sourced or metadata-mapped)
Step 4 — Trackly: Discovery endpoint = https://auth.yourdomain.com
                   Client ID = client_abc123
                   Client Secret = optional. Since Trackly's backend performs
                   the code exchange server-side, registering a confidential
                   Web client with a secret is the standard setup; an Authly
                   SPA client with PKCE (no secret) also works.
Step 5 — Group → role mapping in Trackly:
          Authly role "support_agent" → trackly role "agent"
Step 6 — Test
```

Authly is treated exactly the same as any other OIDC provider. No special code path for Authly in Trackly.

---

### 5. User Sync

**JIT provisioning on login** (primary): user record created/updated automatically from IdP claims on every SSO login. No separate sync job needed.

**Workspace webhook** (optional): If a customer uses Authly, they can configure Authly webhooks (`user.suspended`, `user.deleted`) to call a Trackly endpoint that deactivates the matching user by email in Trackly's DB.

---

## Tech Stack Summary

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | React 18 + Vite + MUI + TanStack Query + Zustand + RHF + Zod | Type-safe, fast SPA |
| State | Zustand | Auth state is minimal |
| Backend | ASP.NET Core Web API (.NET 10) | Strong auth middleware ecosystem |
| OIDC | Built-in `Microsoft.AspNetCore.Authentication.OpenIdConnect` | Generic OIDC support |
| SAML | `ITfoxtec.Identity.Saml2` NuGet | SAML 2.0 for enterprise providers |
| Email | `MailKit` NuGet (SMTP out, IMAP in) | Outbound relay + Option B polling. (`ms_graph`/`gmail_api` reserved, not yet built) |
| Real-time | ASP.NET Core **SignalR** (`/hubs/chat`) | Live-chat presence/typing/message push |
| AI copilot | **Anthropic SDK** (Claude), default `claude-opus-5` | Reply drafting, summarization, triage, KB drafting (opt-in) |
| ORM | Entity Framework Core | Consistent, well-supported |
| Database | PostgreSQL (`trackly` DB) | No external infra dependency |
| Session | HttpOnly cookie → Trackly `sessions` table | Provider-agnostic, fully controlled |
| Secrets encryption | AES-256-GCM | Client/SMTP/IMAP + connector signing secrets at rest |

---

## Implementation Phases

Build in this order — each phase is independently shippable and testable:

**Phase 1 — Foundation (walking skeleton)**
- Solution scaffold: `Trackly.Core` / `Modules` / `Infrastructure` / `Api` + React app (Vite)
- PostgreSQL `trackly` DB, EF Core migrations for: workspaces, users, sessions, email_tokens
- Magic-link auth end-to-end (send → verify → session cookie) + `GET /api/users/me`
- First-run setup (`POST /api/setup`) — one workspace per deployment

**Phase 2 — Core ticketing**
- Tables: tickets, comments, categories, attachments
- Ticket CRUD, comment threads, private notes, role enforcement (customer/agent/admin)
- Customer portal + agent three-pane workspace (per mockups 03/07)
- Round-robin assignment, watchers, manual reassign

**Phase 3 — Guest flow + branding**
- Guest OTP submission, magic-link ticket view, email-to-account linking
- workspace_branding + public branding endpoint + branded `/submit` page (mockup 06)
- Invitations (`workspace_invitations`, accept flow)

**Phase 4 — Email**
- Outbound notifications (MailKit + notification_settings)
- Inbound Option A (parse webhook) with shared pipeline
- Inbound Option B (EmailPollingWorker, IMAP first; Graph/Gmail later)
- new-ticket-via-email toggle

**Phase 5 — SSO**
- sso_connections + generic OIDC scheme (single scheme, per-workspace resolution)
- JIT provisioning + group→role mapping + SSO wizard UI (mockup 05)
- SAML via ITfoxtec (after OIDC works)

**Phase 6 — Remaining features**
- Problems (group tickets under a root cause, bulk-resolve), broadcast
  announcements (typed outage emails, schedule + per-recipient delivery tracking),
  embeddable widget (`/widget.js` floating/inline/link over the branded submit
  form), agent dashboard stats endpoint (mockup 04).
- The admin **email settings UI** (`/admin/settings/email`) — SMTP, interaction
  mode, inbound connector (parse webhook / IMAP), and notification toggles — was
  the one place the product wasn't UI-configurable after Phase 4; it was built as
  a follow-up (the backend API had shipped in Phase 4).

**Phase 7 — Service desk intelligence**

Everything in Phases 1–6 brings Trackly to parity with a basic help desk. Phase 7
is what makes it competitive; it splits into three independently shippable slices.

*7A — Service desk fundamentals* — **built.**
- **SLA policies** — per workspace, per priority: first-response and resolution
  targets (`sla_policies`), pause-while-pending (deadlines shift by the paused
  duration so `first_response_due_at`/`resolve_due_at` stay comparable
  timestamps). The agent list + detail show a green→amber→red countdown
  (`SlaBadge`). _Business-hours calendars and a dedicated breach worker are
  deferred — targets are wall-clock and breach state is derived in the UI;
  SLA-breach escalation will ride the automation engine's future time-based
  trigger._
- **Tags** — free-form `tags` + `ticket_tags`, type-ahead entry, filterable in the
  agent workspace. Agent-only (never on customer surfaces).
- **Teams / groups** — `teams`, `team_members`; a ticket routed to a team is
  round-robin assigned within it (`PickRoundRobinAssigneeAsync(workspace, team)`).
- **Knowledge base** — `kb_articles` (draft/published, per-category), a public
  branded `/kb`, and title-match suggestions on the submit form (deflection).
- **Automation rules** — `automation_rules` (trigger `on_create`/`on_update` +
  conditions + actions): set priority/status, assign team (round-robin), add tag,
  add internal note. Runs inside the create/update transaction; a rule's own
  mutations aren't re-evaluated (no loops). _Time-based triggers and canned-reply
  actions are deferred._
- **Canned responses** — `canned_responses`, inserted from the ⚡ button in the
  reply box.

*7B — AI copilot (Claude API)* — **delivered**
- ✅ Reply drafting from the thread plus the workspace's KB, agent edits before
  send (`✨ Draft reply` in the composer; fills the box, never auto-sends)
- ✅ Thread summarisation for handoffs and long escalations (`✨ Summarize`)
- ✅ Auto-categorisation, priority and tag suggestions (`✨ Suggest triage` in the
  details pane → one-click Apply). _Delivered as an on-demand agent action rather
  than automatic at intake — the agent stays in control._
- ✅ Sentiment / frustration flag — surfaced inside the triage suggestion panel
  (part of the `✨ Suggest triage` result), not yet persisted as a ticket-list
  column. _Deviation from "surfaced on the ticket list"; list badge is deferred._
- ✅ Draft a KB article from a resolved ticket (`✨ Draft KB article` → editable
  dialog → saved as a **draft**, agent publishes separately)
- ✅ Guardrails: never auto-send without an agent action; per-workspace AI toggle
  (`workspaces.ai_enabled`) + deployment key both required; **private notes and
  other workspaces' data are never sent** (enforced in `AiService`, not the UI)
- **Backend:** `IAiCopilot`/`AnthropicAiCopilot` (Anthropic .NET SDK, default
  `claude-opus-5`), `AiService` (prompt building + guardrails), `AiController`
  (`/api/tickets/{id}/ai/{draft-reply,summary,triage,kb-draft}`, `/api/ai/available`),
  `AiSettingsController` (`/api/admin/ai`). Config: `Ai:ApiKey` (secret), `Ai:Model`.

*7C — Omnichannel & insight* — **delivered** (deflection deferred)
- ✅ CSAT survey on resolution — `csat_surveys`, single-use hashed token in the
  resolution email, score stored per ticket and attributed per agent; branded
  `/csat/:ticketId` page; agent sees the rating on the ticket. Toggle in email
  settings. `CsatService` + public/agent controllers.
- ✅ Analytics — `AnalyticsService` + `/api/dashboard/analytics` (Admin) and the
  `/admin/analytics` page: volume, first-response/resolution times, first-response
  & resolution SLA attainment, CSAT, per-agent leaderboard. Needed `Ticket
  .ResolvedAt`. _Deflection rate deferred — it needs KB self-service-session
  instrumentation Trackly doesn't yet capture; recording it truthfully is its own
  slice._
- ✅ Connectors (Slack / WhatsApp / Teams) — `ChannelConnector` (encrypted signing
  secret), `ChannelConversation` (threading), `InboundChannelEvent` (idempotency).
  `ChannelInboundService` mirrors the Phase 4 pipeline on a connector identity
  model: HMAC-verified `POST /api/channels/inbound/{provider}/{slug}` (X-Trackly-
  Signature over the raw body), new conversation → guest ticket, follow-up →
  threaded comment, retry → dedup. Admin `/admin/channels`. _Provider-native
  envelopes (Slack Events API, WhatsApp Cloud API, Bot Framework) are normalized +
  re-signed by a thin relay — the same model the email parse webhook already uses;
  native signature adapters are a deployment concern._
- ✅ Live chat — `chat_sessions`/`chat_messages`; `ChatService` (REST source of
  truth) + `ChatHub` (SignalR `/hubs/chat`) for presence/typing/live delivery;
  branded visitor `/chat?workspace=slug` and agent `/dashboard/chat` console;
  **ending a chat turns the transcript into a ticket** (channel=chat, each message
  a comment). _Real-time needs WebSockets + a single API instance (or a SignalR
  backplane) — see go-live._

---

## Verification Checklist

- [ ] Configure Authly as Custom OIDC in a local Trackly workspace — confirm SSO login works
- [ ] Configure Google as OIDC in a second workspace — confirm SSO login works
- [ ] JIT provisioning: new SSO user auto-created in Trackly `users` table on first login
- [ ] Group → role mapping: agent group maps to `agent` role, customer group maps to `customer`
- [ ] Manual role change in `/admin/users` takes effect on next request without re-login
- [ ] `customer` cannot access `/dashboard`; `agent` can
- [ ] Magic-link login works independently of any SSO connection (link click and 6-digit code both issue a session)
- [ ] Verify page GET does not consume the link token (scanner-prefetch safe); only the confirm POST does
- [ ] Login email to an unknown address creates the account after verification (signup = login)
- [ ] Anonymous guest submits ticket via OTP → magic link tracks ticket without login
- [ ] OTP rate limiting: 4th send within 15 minutes for the same email is rejected
- [ ] Attachment upload on ticket + comment; customer cannot download attachments on private notes
- [ ] Disable email login for a workspace → magic-link sends rejected, SSO still works
- [ ] Guest ticket linked to user on first SSO login with matching email
- [ ] Agent responds → customer notified; customer replies via email → appears in thread
- [ ] Inbound Option A: reply routed via MX → parse webhook → comment added; HMAC-invalid request rejected
- [ ] Inbound Option B: reply lands in IMAP mailbox → polling worker ingests it exactly once (no duplicates on restart)
- [ ] Threading fallback: reply with mangled Reply-To still matched via In-Reply-To header
- [ ] Cold email to support mailbox with `new_ticket_via_email` on → new guest ticket with channel='email'; toggle off → email ignored
- [ ] From-address spoofing: email from a non-participant address is rejected, no comment created
- [ ] Suspend user in Trackly → session invalidated, access denied immediately
- [ ] Workspace B cannot see Workspace A's tickets (workspace isolation)
- [x] Phase 7A: SLA resolve clock pauses while a ticket is pending (deadline shifts by the paused duration)
- [x] Phase 7A: automation rule mutations are not re-evaluated within the same op (no loops); a malformed rule is skipped, not fatal
- [x] Phase 7A: KB suggestions/list expose only published articles of that workspace; drafts and other workspaces never leak
- [x] Phase 7A: tags are agent-only — a customer's ticket view never includes them
- [x] Phase 7A: a ticket routed to a team is round-robin assigned among that team's members only
- [x] Phase 7B: AI copilot prompt contains no private notes and no other workspace's data (filtered + workspace-scoped in `AiService`)
- [x] Phase 7B: AI never sends a reply without an explicit agent action; workspace AI toggle off (or no `Ai:ApiKey`) disables all calls (409)
- [x] Phase 7C: chat transcript becomes a ticket in the right workspace; CSAT score cannot be submitted twice (single-use token + submitted_at guard)
- [x] Phase 7C: connector inbound is HMAC-verified, idempotent, and threads a conversation into one ticket; a bad signature is rejected
- [x] Email templates: a key with no row renders the built-in; saving one, then Reset, returns byte-identically to it
- [x] Email templates: a stored template with an unbalanced `{{#if}}` degrades to the built-in on send (logged), while the **editor preview** reports the error instead of degrading
- [x] Email templates: `is_active = false` selects the built-in — it never suppresses the send (invariant 8)
- [x] Email templates: saving a body that has lost a required variable is refused, and refused again after sanitising in case the placeholder went with a stripped tag
- [x] Email templates: `<script>` is stripped on save while tables, inline styles and `{{placeholders}}` in `href` survive
- [x] Email templates: the per-template test does **not** set `email_configs.last_verified_at`
- [x] Email branding: with no logo uploaded the layout prints the brand name as text; a broken `<img>` never appears
- [x] Sign-in, guest-OTP, invitation and guest-confirmation mail all go through the workspace's designated sender, not the shared relay — and all four carry an HTML part
- [x] Email templates: an edit to `_layout` changes every message at once, and a `standalone` template ignores it
