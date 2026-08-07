# Trackly — Ticket Management App

## Context

Trackly is a standalone, multi-tenant ticket management SaaS that can be sold to **any organisation** regardless of their existing identity infrastructure. Authly is supported as one of many identity providers — not a hard dependency.

This design mirrors how products like Claude for Teams, Notion, and GitHub handle enterprise SSO: each workspace configures the identity provider they already use (Okta, Google Workspace, Microsoft Entra ID, Authly — or no IdP at all, using passwordless email magic links), and Trackly works with all of them identically.

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

### Workspaces (Trackly's own multi-tenancy)

Trackly has its own `workspaces` table — this replaces any dependency on an external IdP's tenant concept. Each customer gets one workspace. All data (tickets, users, roles, settings) is scoped to a `workspace_id` in Trackly's own DB.

### Supported Identity Providers

Each workspace configures exactly one SSO connection (like Claude's model — one active provider at a time, switchable). Additionally, **passwordless email login (magic link + code)** is always available as a fallback unless the admin disables it (stored as `email_login_enabled` on the workspace — see schema). Trackly stores **no passwords at all**.

| Provider | Protocol | Notes |
|----------|---------|-------|
| **Authly** | Custom OIDC | Your own product — first-class support |
| **Google Workspace** | SAML or OIDC | Most common for SMBs |
| **Microsoft Entra ID** | SAML | Enterprise standard |
| **Okta** | SAML | Enterprise standard |
| **Auth0** | SAML or OIDC | Common in SaaS companies |
| **Custom SAML** | SAML | Any SAML 2.0 compliant IdP |
| **Custom OIDC** | OIDC | Any OIDC compliant IdP |
| **Email magic link** | Native (passwordless) | Trackly emails a sign-in link + 6-digit code; no credentials stored |

---

### SSO Configuration Wizard (per workspace)

Admin sets up SSO at `/admin/settings/sso`. The wizard follows the same pattern as Claude's SSO setup (as seen in the reference screenshots):

```
Step 1 — Select your identity provider
         (list of pre-built providers + Custom SAML + Custom OIDC)
         ↓
Step 2 — Create an application in your IdP
         Trackly shows: redirect/callback URI to register in the IdP
         ↓
Step 3 — Add required claims
         IdP must send: sub (required), email (required),
                        given_name (required), family_name (required),
                        groups (optional — used for auto role mapping)
         ↓
Step 4 — Provide your OIDC / SAML configuration
         OIDC: Discovery endpoint URL, Client ID, Client Secret
               (Client Secret is optional if the IdP supports PKCE for
                public clients — e.g. Authly SPA clients)
         SAML: IdP metadata URL (or paste XML), SP Entity ID
         ↓
Step 5 — Configure group → role mapping (optional)
         e.g. Okta group "support-agents"  → agent
              Okta group "support-admins"  → admin
              (everyone else)              → customer
         ↓
Step 6 — Test Single Sign-On
         Trackly initiates a test auth flow and confirms claims are received
```

**Switching providers:** Admin can switch to a different provider at any time. Existing user records and tickets are preserved — only the SSO connection changes. User identity records (`user_identities`) for the old provider are kept but marked inactive (`is_active = false`); users are re-matched by email and get a new identity record on first login via the new provider.

---

### Domain Verification

Admin verifies their organisation's email domain(s) at `/admin/settings/domains`:

- Add a domain (e.g. `acme.com`)
- Verify ownership via DNS TXT record
- Toggle **Discoverable** — if on, users entering an `@acme.com` email on the Trackly login page are automatically routed to this workspace's SSO provider

```sql
CREATE TABLE workspace_domains (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain       TEXT NOT NULL UNIQUE,  -- globally unique: only one workspace may claim a domain
    verified     BOOLEAN DEFAULT false,
    discoverable BOOLEAN DEFAULT true,
    dns_txt_token TEXT NOT NULL,         -- token to place in DNS for verification
    verified_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

### Login Flow

```
User visits trackly.yourdomain.com/login
    │
    ▼
User enters email address
    │
    ▼
Trackly checks: is this email domain linked to a workspace with active SSO?
    │
   YES ──────────────────────────────────────────────────────────────────────┐
    │                                                                        ▼
    │                                                    SSO flow (OIDC or SAML)
    │                                                    Redirect to IdP → user authenticates
    │                                                    IdP redirects back with code/assertion
    │                                                    Trackly validates, extracts claims
    │                                                    JIT provision or update user record
    │                                                    Apply group→role mapping (if configured)
    │                                                    Issue Trackly session → redirect to app
    │
   NO
    ▼
Passwordless email login (magic link + code)
    │
    ▼
Trackly emails a sign-in link + 6-digit code
    → user clicks the link (or types the code)
    → Trackly verifies the token → issues session → redirect to app
```

---

### Passwordless Email Login (magic link + code)

The native fallback is passwordless — Trackly never stores passwords. It reuses the same email-token machinery as guest OTP verification.

```
1. User enters their email on /login
2. Trackly creates a login token:
     - a random 256-bit link token  → magic link URL
     - a 6-digit code              → typed fallback
   (single row, both hashes stored, 10-minute expiry, single-use)
3. Email sent: "Sign in to Acme Support"
     [ Sign in → https://acme.trackly.com/auth/verify?token=… ]
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
- **Global vs workspace-scoped sends:** a send from a workspace context
  (e.g. acme.trackly.com/login) stores `workspace_id` on the token; a send from
  trackly.com stores NULL and the workspace is resolved at verify time from the
  user's memberships. Verify then returns one of: `ok` (session issued),
  `signup_required` (email verified but no account anywhere → onboarding step 2),
  or `choose_workspace` (email belongs to several workspaces → client re-verifies
  with a slug).
- **Deferred consumption for multi-step outcomes:** `signup_required` and
  `choose_workspace` responses do **not** consume the token — the follow-up
  request (`POST /api/signup`, or re-verify with a workspace slug) validates it
  again and consumes it there. Expiry and the failed-attempt lock still apply
  throughout; a session is only ever issued from a request that consumes the token.

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
| `email` | From IdP JWT/SAML assertion (or verified via magic link for passwordless users) |
| `name` | From IdP JWT/SAML assertion (or asked on first magic-link login) |
| `role` | Set in Trackly's DB (via group mapping or manual assignment by admin) |
| `workspace_id` | Determined at login by domain lookup or workspace slug |

No `password_hash` — Trackly is fully passwordless. Non-SSO users authenticate via emailed magic link + code.

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

Any SMTP relay works: SendGrid, Mailgun, Postmark, AWS SES, or the enterprise's own relay. Trackly connects as a client and sends. What matters is the headers stamped on every notification email — they enable reply threading:

```
From:        Acme Support <support@tickets.acme.com>
Reply-To:    reply+<ticket-uuid>@tickets.acme.com
Message-ID:  <ticket-uuid>.<comment-uuid>@trackly
```

The `reply+<ticket-uuid>@` address encodes which ticket a reply belongs to. DNS setup for deliverability: SPF + DKIM records on the sending domain (the SMTP provider gives these).

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

Per workspace in `/admin/settings/email`. Admin provides their own SMTP credentials (Gmail, SendGrid, Mailgun, etc.) or uses a shared deployment-level SMTP configured at install time.

```sql
CREATE TABLE email_configs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID NOT NULL UNIQUE REFERENCES workspaces(id),
    -- Outbound
    use_shared_smtp        BOOLEAN DEFAULT true,
    smtp_host              TEXT,
    smtp_port              INT,
    smtp_user              TEXT,
    smtp_password_encrypted TEXT,                -- AES-256-GCM (ISecretProtector)
    smtp_use_start_tls     BOOLEAN DEFAULT true,
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
    -- Option B: mailbox polling
    mailbox_protocol       TEXT,                 -- imap | ms_graph | gmail_api
    mailbox_address        TEXT,                 -- e.g. support@acme.com
    mailbox_host           TEXT,                 -- IMAP host (imap only)
    mailbox_port           INT,                  -- IMAP port (default 993)
    mailbox_username       TEXT,
    mailbox_password_encrypted TEXT,             -- AES-256-GCM (imap app password)
    mailbox_oauth_tokens_encrypted TEXT,         -- AES-256-GCM JSON (graph/gmail refresh token)
    poll_interval_seconds  INT DEFAULT 60,
    last_polled_at         TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ DEFAULT now()
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
> and are never returned by the admin API — `GET /api/admin/settings/email`
> exposes `hasSmtpPassword` / `hasInboundWebhookSecret` / `hasMailboxPassword`
> booleans instead. The parse-webhook endpoint is `POST /api/email/inbound/{slug}`;
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
| Internal portal | `app.trackly.com` (or `acme.trackly.com`) | Workspace admins + agents | Trackly brand + workspace name |
| Customer-facing support | `acme.trackly.com/support` (+ widget) | The enterprise's end customers | **The enterprise's brand** (logo, colors) |

Layout inspiration: three-pane agent workspace (ticket list left, conversation centre, details right) — styled with Material UI and Trackly's own branding, not a pixel copy of any reference design.

---

### 1. Enterprise Journey — Discover → Sign Up → Live

```
Marketing site                    Onboarding wizard                      Live
──────────────                    ─────────────────                      ────
Landing page                      Step 1  Create admin account
  → Features                      Step 2  Create workspace
  → Pricing                       Step 3  Add your branding
  → [Start free trial] ────────►  Step 4  Invite agents        ────►  /dashboard
                                  Step 5  Set up SSO (optional,       (setup checklist
                                          skippable — do later)        card shown)
```

The signup itself always uses **Google sign-in or an emailed magic link** — SSO can't be used yet because the workspace doesn't exist, and Trackly stores no passwords. The first user becomes the workspace `admin`.

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

### 3. Onboarding Wizard (after "Start free trial")

```
Step 1 — Create your account            Step 2 — Create your workspace
┌────────────────────────────┐          ┌────────────────────────────┐
│  Create your account       │          │  Name your workspace       │
│                            │          │                            │
│  [ Continue with Google ]  │          │  Company name  __________  │
│                            │          │  Subdomain     [acme   ]   │
│  ───────── or ─────────    │          │                .trackly.com│
│  Work email  ____________  │          │                            │
│  [ Email me a sign-in link]│          │        [ Continue → ]      │
│  (link + 6-digit code —    │          └────────────────────────────┘
│   no password to create)   │
└────────────────────────────┘

Step 3 — Add your branding              Step 4 — Invite your team
┌────────────────────────────┐          ┌────────────────────────────┐
│  Brand your support portal │          │  Invite agents             │
│                            │          │                            │
│  Logo         [ Upload ]   │          │  email@…  [agent ▾]  [+]   │
│  Brand color  [■ #2563EB]  │          │  email@…  [admin ▾]  [+]   │
│  Portal title __________   │          │                            │
│                            │          │  Invitees get an email     │
│  ┌ Live preview ────────┐  │          │  with a join link          │
│  │ [logo] Acme Support  │  │          │                            │
│  │  Submit a ticket …   │  │          │  [ Skip ]  [ Send & → ]    │
│  └──────────────────────┘  │          └────────────────────────────┘
│  [ Skip ]  [ Continue → ]  │
└────────────────────────────┘

Step 5 — Single Sign-On (optional)
┌───────────────────────────────────────┐
│  Connect your identity provider       │
│                                       │
│  ○ Okta   ○ Google   ○ Entra ID       │
│  ○ Authly ○ Custom SAML ○ Custom OIDC │
│                                       │
│  You can set this up any time in      │
│  Settings → SSO.                      │
│                                       │
│  [ Skip for now ]  [ Configure → ]    │
└───────────────────────────────────────┘
        │
        ▼
Lands on /dashboard with a "Getting started" checklist card:
  ☐ Verify your domain   ☐ Configure SSO   ☐ Embed the widget
  ☑ Invite agents        ☑ Add branding
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
| Signup + onboarding | `/signup`, `/onboarding/*` (5-step wizard) | Signup only | New workspace admins |
| Accept invite | `/invite/:token` | No | Invited agents/admins |
| Public ticket form | `/submit` (workspace-branded) | No | Anyone |
| Anonymous ticket view | `/tickets/:id?token=` | No | Guest (magic link) |
| Login | `/login` | No | All |
| SSO callback | `/auth/callback` | No | All |
| Customer portal | `/portal/tickets`, `/portal/tickets/new`, `/portal/tickets/:id` | Yes | `customer` |
| Agent dashboard | `/dashboard/tickets`, `/dashboard/tickets/:id`, `/dashboard/problems` | Yes | `agent`, `admin` |
| Admin settings | `/admin/users`, `/admin/settings/sso`, `/admin/settings/email`, `/admin/settings/domains`, `/admin/settings/branding`, `/admin/widget`, `/admin/announcements` | Yes | `admin` |

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
> `GET /api/auth/sso?workspace=slug` → IdP; `GET /api/auth/sso/callback` → session.
> Login-page routing: `GET /api/public/sso/discover?email=` returns the workspace's
> SSO start URL when the email domain is a verified, discoverable claim.

**SAML handling:** `ITfoxtec.Identity.Saml2` (`.MvcCore`), handled in the API layer
(`SamlController`): `GET /api/auth/saml?workspace=slug`, `POST /api/auth/saml/acs`,
`GET /api/auth/saml/metadata?workspace=slug`. AuthnRequests are unsigned; the IdP
**response signature is validated** against the cert in the IdP metadata before any
claim is trusted. JIT/session/role-mapping is shared with OIDC via
`SsoLoginService.FinishLoginAsync`.

**Key API endpoints:**

| Method | Path | Auth | Role |
|--------|------|------|------|
| POST   | `/api/signup` | None | Create admin account + workspace (onboarding steps 1–2) |
| POST   | `/api/invitations` | Session | admin — invite agents by email |
| POST   | `/api/invitations/accept` | None | Accept invite via token, create account |
| GET    | `/api/public/workspaces/{slug}/branding` | None | Public, cacheable — branding for form/widget |
| PUT    | `/api/admin/branding` | Session | admin — update logo, colour, portal title |
| GET    | `/api/auth/sso?workspace=` | None | Initiate SSO for workspace |
| GET    | `/auth/callback` | None | OIDC/SAML callback |
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
- **`due` puts nulls last in both directions.** No SLA is neither the most nor
  the least urgent.

Facet groups are each counted with every filter applied **except their own** —
that is what makes the rail navigable rather than a dead end.

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
| POST   | `/api/tickets/{id}/comments` | Session | owner or agent/admin |
| POST   | `/api/guest/otp/send` | None | Public — send 6-digit OTP to guest email (rate-limited) |
| POST   | `/api/guest/otp/verify` | None | Public — verify OTP, returns short-lived submission token |
| POST   | `/api/tickets/guest` | None | Public — anonymous submission (requires verified submission token) |
| GET    | `/api/tickets/guest/{id}?token=` | None | Guest magic link |
| POST   | `/api/tickets/{id}/attachments` | Session or guest token | Upload attachment |
| GET    | `/api/attachments/{id}` | Session or guest token | Download via signed URL (visibility-checked) |
| POST   | `/api/admin/sso` | Session | admin — save SSO connection |
| POST   | `/api/admin/sso/test` | Session | admin — test SSO connection |
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
    slug                   TEXT NOT NULL UNIQUE,   -- e.g. "acme" → acme.trackly.com
    email_login_enabled    BOOLEAN DEFAULT true,   -- magic-link fallback; off = SSO-only login
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now()
);

-- Verified email domains
CREATE TABLE workspace_domains (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain        TEXT NOT NULL UNIQUE,  -- globally unique: only one workspace may claim a domain
    verified      BOOLEAN DEFAULT false,
    discoverable  BOOLEAN DEFAULT true,
    dns_txt_token TEXT NOT NULL,
    verified_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- SSO connections (one active per workspace)
CREATE TABLE sso_connections (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_name      TEXT NOT NULL,       -- "Authly", "Okta", "Google", "Entra ID", "Custom OIDC", etc.
    protocol           TEXT NOT NULL,       -- 'oidc' or 'saml'
    -- OIDC fields
    discovery_endpoint TEXT,
    client_id          TEXT,
    client_secret      TEXT,               -- AES-256-GCM encrypted
    -- SAML fields
    idp_metadata_url   TEXT,
    idp_metadata_xml   TEXT,
    sp_entity_id       TEXT,
    -- Status
    status             TEXT DEFAULT 'pending',  -- pending, active, error
    tested_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

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
    -- no password_hash: Trackly is passwordless (SSO or magic link only)
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
- Workspace signup (`POST /api/signup`) + onboarding steps 1–2

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
- Domain verification + login-page domain routing
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
