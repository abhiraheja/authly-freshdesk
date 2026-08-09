# Trackly — Go-Live Plan

**Living deployment checklist.** Every time a phase adds a setting, secret, or
external dependency, record it here in the same change. Before promoting to any
new environment (staging, prod, a customer's tenant), walk this document
top-to-bottom. Nothing that isn't written here should be assumed to have a
sensible default.

> Convention: `keep as-is` = the committed default is fine everywhere;
> `per-env` = must be set for each environment; `secret` = must be provided via
> the platform's secret store, never committed.

---

## 0. The three things most likely to bite

1. **Whoever reaches `/setup` first becomes your administrator.** A freshly
   deployed Trackly with an empty database is unclaimed, and setup is anonymous
   by necessity — there is no account to authenticate against yet. Claim it
   yourself immediately after the first deploy, before the URL is reachable by
   anyone else. Once claimed it answers `409` forever.
2. **`Security:MasterKey` is forever.** It encrypts every stored secret (SMTP/IMAP
   passwords, webhook secrets, future OAuth tokens). If it changes or is lost,
   every previously-encrypted value becomes undecryptable. Generate it once per
   environment, store it in the secret manager, and back it up. In Development a
   fixed fallback key is used so local runs work — **never let that reach prod.**
3. **There is no password recovery outside the app.** No CLI, no reset script. An
   admin resets another admin from **Admin ▾ → People → Members**, and a "forgot
   password" email only works once SMTP does. **Keep two administrators.** With
   one admin, one lost password and a broken mail relay means restoring from a
   database backup.

Migrations apply automatically on boot (`Trackly:AutoMigrate`, default true), which
is what a container pointed at an empty database needs. If you set it false, apply
them yourself as a deploy step:
```
dotnet ef database update --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
```

---

## 1. Server configuration (`Trackly.Api`)

Set via `appsettings.{Environment}.json`, environment variables
(`ConnectionStrings__Trackly`, `Security__MasterKey`, …), or the platform secret
store. Empty strings in the committed `appsettings.json` are placeholders.

| Key | Purpose | Prod requirement | Secret |
|-----|---------|------------------|--------|
| `ConnectionStrings:Trackly` | PostgreSQL connection string | per-env | secret |
| `Trackly:AutoMigrate` | Apply EF migrations on boot. Defaults to **true**, which is what a self-hosted container needs — it is pointed at an empty database with no separate migration step. Set false only if you apply migrations out of band, or run several replicas and want exactly one touching DDL | default true | no |
| `Security:MasterKey` | base64 **32-byte** AES-256-GCM key for secrets at rest | per-env, generate once, back up | secret |
| `Ai:ApiKey` | Anthropic (Claude) API key for the AI copilot. Unset ⇒ AI features stay off everywhere | per-env (only if using AI) | secret |
| `Ai:Model` | Claude model id for the copilot (defaults to `claude-opus-5`) | optional | no |
| `App:FrontendBaseUrl` | Absolute base URL of the SPA; used to build links in **emails** (magic links, invites, guest tracking, notifications) and SSO redirects | per-env (e.g. `https://app.trackly.com`) | no |
| `App:ApiBaseUrl` | Public base URL of the API; used to build the **OIDC/SAML redirect (callback) URI** and the **mail OAuth callback URI**. Falls back to the request scheme+host if unset — set it explicitly behind a proxy | per-env (e.g. `https://app.trackly.com`) | no |
| `Storage:LocalPath` | Directory for uploaded attachments + logos | per-env (see §3) | no |
| `Email:Smtp:Host` | Shared/deployment-level SMTP relay host. Empty ⇒ emails are logged, not sent | per-env | no |
| `Email:Smtp:Port` | SMTP port | default 587 | no |
| `Email:Smtp:Username` / `Password` | Shared relay credentials | per-env | secret (password) |
| `Email:Smtp:UseStartTls` | STARTTLS on the shared relay | default true | no |
| `Email:Smtp:FromEmail` / `FromName` | Default From on shared-relay mail | per-env | no |
| `AllowedHosts` | Host filtering | set to real host(s) in prod, not `*` | no |
| `Logging:*` | Log levels | keep as-is / tune | no |

Generate a master key:
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))   # dev-grade
# prefer a CSPRNG in CI: openssl rand -base64 32
```

---

## 2. Database (PostgreSQL)

- Provision a Postgres 16 instance and database (local dev uses `docker-compose.yml`:
  db `trackly`, user `trackly`, pass `trackly` — **change all three in prod**).
- Put the connection string in `ConnectionStrings:Trackly`.
- **Apply migrations as a deploy step** (see §0.1).
- Back up: the DB holds all tenant data, hashed tokens, and *encrypted* secrets —
  useless without the matching `Security:MasterKey`, so back up both together.

---

## 2.5 Time zone data (business hours)

Business hours resolve an **IANA time zone name** (`Asia/Kolkata`,
`Europe/London`) at runtime, and every SLA deadline in a workspace that has them
switched on is computed from it.

- **Linux containers need `tzdata` installed.** The `mcr.microsoft.com/dotnet/aspnet`
  images include it; a trimmed or distroless base may not. Without it
  `TimeZoneInfo.FindSystemTimeZoneById` throws for every name, the calendar falls
  back to UTC, and deadlines are wrong by hours with nothing on screen to explain
  it.
- **Verify after deploying** by saving a schedule with a non-UTC zone: the admin
  screen refuses a name the server cannot resolve, so a successful save is the
  check.
- Windows hosts accept IANA names on .NET 6+; no extra step.

Nothing else here is configuration — the schedule lives in the database, per
workspace, and is off by default.

## 3. File storage (attachments, profile photos, workspace logos)

Storage is **per workspace**, chosen by an admin under **Admin → Storage**, not
by an environment variable. Three providers:

| Provider | Configured with | Notes |
|---|---|---|
| `local` (default) | `Storage:LocalPath` | Single instance only |
| `azure` | Connection string + container | Container auto-created if the credential may |
| `gcs` | Service-account JSON + bucket | Bucket must already exist |

One bucket per workspace holds everything Trackly writes; an optional folder
prefix keeps it out of the way of anything else sharing that bucket. Three kinds
of object, at `<prefix>/<workspace-id>/…`:

| Path | What | Visibility |
|---|---|---|
| `<ticket-id>/…` | Ticket attachments | Private — `GET /api/attachments/{id}` |
| `avatars/<user-id>/…` | Profile photos | Private — `GET /api/users/{id}/avatar` |
| `branding/…` | Workspace logo | Public — the only thing a CDN URL is ever built for |

Only the logo is saved with `StorageVisibility.Public`, which is what puts the
`-public` marker in its storage key. `PublicUrlAsync` returns null for any key
without it, so no code path can hand out a CDN link to an attachment or a photo
even by mistake.

Both cloud credentials are AES-256-GCM encrypted with `Security:MasterKey`, so
**that key must be set and backed up before any workspace configures one** —
lose it and the credentials are unrecoverable.

- **Local disk remains the default and the fallback.** A workspace with no
  configuration, and any workspace on `local`, still writes to
  `Storage:LocalPath` (defaults to `<app>/storage`). Mount a **persistent**
  volume there, include it in backups, and run one API instance — local disk is
  neither shared across instances nor durable on ephemeral hosts.
- **Switching provider does not move existing files.** Every storage key is
  written with a provider prefix (`azure:`, `gcs:`, `local:`) and reads route on
  that prefix, so files written before a switch keep being served from where
  they are. This works *only while the old provider's credentials remain saved* —
  the admin screen keeps Azure and GCS credentials in separate fields for
  exactly this reason, and warns before a switch. There is no migration tool
  that moves existing objects between providers.
- Keys with no prefix predate this and mean local disk.
- **Verify after configuring:** Admin → Storage → *Test connection* writes a
  probe file, reads it back and deletes it, which is what catches a credential
  that can write but not read.

### Folder prefix

**Folder prefix** (e.g. `trackly`) is the folder inside the bucket everything is
written under. Set one whenever the bucket is shared with another application.
It lives inside the stored key, so changing it later does not strand old files —
they keep resolving under the prefix they were written with.

### CDN (optional)

A workspace on a cloud provider may set a **Public CDN base URL**
(e.g. `https://cdn-beta.saarvix.in`). It maps onto the **bucket root**, so the
bucket name is not part of a CDN path:

```
object:  trackly/019fd6b2-…/branding/019f…_logo.png
bucket:  https://storage.googleapis.com/saarvix-beta-public/trackly/…/logo.png
CDN:     https://cdn-beta.saarvix.in/trackly/…/logo.png
```

**Only workspace logos are ever given a CDN URL.**
`GET /api/public/workspaces/{slug}/logo` answers with a `302` to the CDN;
everything else keeps streaming through the API. Attachments go through
`GET /api/attachments/{id}`, which is where workspace isolation, requester
scoping and the private-note rule (invariant 5) are enforced — a CDN URL carries
no sign-in, so publishing one would bypass all three. The mechanism is the key
prefix: logos are written `gcs-public:…`, everything else `gcs:…`, and
`PublicUrlAsync` returns null for anything not marked public.

> ⚠️ **One bucket holds both.** A CDN requires that bucket to be publicly
> readable, and attachments live in it. Trackly never publishes an attachment's
> path, but it cannot make a public bucket private — anyone who *knows* an object
> path could fetch it directly, and GCS uniform access cannot make one folder
> public and another private. If that matters, give attachments a separate
> private bucket, or skip the CDN and let Trackly serve logos.

- Points at the CDN only while the key's provider matches the workspace's
  current provider — a logo left behind on local disk keeps being streamed.
- If attachment throughput ever becomes the bottleneck, the answer is short-TTL
  signed URLs issued *after* the permission check (Azure SAS / GCS V4), not a
  public CDN.

### Browser caching of attachments and avatars

Both endpoints answer with `Cache-Control: private` **and `Vary: Cookie`**.

The `Vary` is the load-bearing half. These responses are authorised per user, so
a long `max-age` on a shared machine would otherwise let the next person to sign
in read a colleague's document straight out of the browser cache without the
server ever seeing the request. Keying the cache entry on the session cookie
makes that a miss and a real authorisation check.

**Do not put a shared/proxy cache in front of these routes**, and do not
"optimise" the `private` to `public`. If a reverse proxy is added, confirm it
honours `Vary` — several do not by default.

Attachments use `max-age=86400`: the bytes behind an id never change (there is
no endpoint that replaces one). Avatars use a year plus `immutable`, because
their URL carries a version token derived from the storage key.

---

## 4. Email (Phase 4)

Outbound and inbound are separate concerns — see `docs/trackly-plan.md` → Email
Architecture. Per-workspace settings live in the DB (`/admin/settings/email`);
only the **shared/deployment-level** pieces are environment config.

**Deployment-level:**
- Shared SMTP relay (`Email:Smtp:*`) — the fallback sender for workspaces that
  don't bring their own relay. Configure SPF/DKIM on its sending domain.
- If unset, all mail is written to the log (dev behaviour) — acceptable for a
  smoke test, never for real users.

**Per-workspace (configured by each tenant admin, encrypted at rest):**
- **Mail providers** (`email_providers`, one row per provider) — Google,
  Microsoft 365, Yahoo, generic SMTP, Amazon SES. Configured at
  `/admin/settings/email`; credentials are AES-256-GCM encrypted with
  `Security:MasterKey`. **No new environment config** — every provider is set up
  from inside the admin UI, deliberately, because SMTP is what an empty install
  lacks.
  - **Google connects with OAuth (XOAUTH2).** The operator registers **their own**
    OAuth client in **their own** Google Cloud project — Trackly ships no client
    id — and pastes the id and secret into the Google card. Still DB config, not
    environment config.
    - **The redirect URI must be registered in that OAuth client, byte-identical.**
      It is `{App:ApiBaseUrl}/api/email/oauth/callback`, and the Google card
      shows the exact string to copy. Getting it wrong fails at Google with an
      error that never reaches Trackly. **`App:ApiBaseUrl` must be set in prod** —
      it falls back to the request's own host, which is wrong behind a proxy.
    - Scope is `https://mail.google.com/`, which Google classes as **restricted**.
      An app published **Internal** to the operator's own Workspace organisation
      needs no verification. A **public** app using this scope needs Google's
      verification and a CASA security assessment — so a personal Gmail account,
      which cannot publish internally, should use the app password path instead.
    - Google Workspace stopped accepting plain passwords for IMAP/SMTP/POP in
      March 2025. **App passwords still work** and remain the fallback here, but
      they require 2-Step Verification on the account.
  - Microsoft 365 and Yahoo authenticate with an **app password** over ordinary
    SMTP/IMAP. Their OAuth cards land in Phases 3 and 4.
  - SES needs the region's `email-smtp.{region}.amazonaws.com` reachable and a
    **verified identity** for the From address, or mail is rejected.
- `email_configs.sending_provider_id` / `receiving_provider_id` say which
  provider does which job. **A null sender means the shared relay** — that is what
  a fresh install runs on.
- **Upgrade note:** the `EmailProviders` migration copies existing
  `email_configs` SMTP/mailbox columns into an `smtp` provider row and points the
  config at it, so a working installation keeps working. The old columns are
  **left in place** and dropped one release later, so a rollback still has the
  credentials — nobody can retype a password they were never shown. Delete them
  only after that release has been on prod long enough to rule out a rollback.
- Own SMTP relay (deprecated legacy path) — falls back to the shared relay.
- Inbound connector, **one of**:
  - **Option A — parse webhook:** tenant adds an **MX record** on a subdomain
    (e.g. `tickets.acme.com`) pointing at their provider (SendGrid/Mailgun/…),
    which POSTs to `POST /api/email/inbound/{slug}`. Trackly verifies
    `X-Trackly-Signature` (HMAC-SHA256 of the raw body) against the workspace's
    stored webhook secret. **This endpoint must be publicly reachable over HTTPS.**
  - **Option B — mailbox polling (IMAP):** tenant provides mailbox host/user/app-
    password; the `EmailPollingWorker` background service polls on an interval.
    **Requires the API process to run continuously** (not scale-to-zero) and to
    have outbound network access to the IMAP host.
- `new_ticket_via_email` toggle (off by default) turns cold inbound mail into
  tickets.

**Infra implications:** the polling worker is an in-process `BackgroundService`, so
running multiple API instances would poll each mailbox multiple times. Until a
distributed lock/leader election is added, **run one instance** (or disable the
worker on all but one) if any workspace uses mailbox polling.

---

## 5. Frontend (SPA)

- Build: `cd frontend-angular && npm ci && npm run build` → static assets in
  `frontend-angular/dist/frontend-angular/browser`.
  - The production configuration swaps `src/environments/environment.ts` for
    `environment.prod.ts`. Both ship `apiBaseUrl: ''` (same origin) — see below
    for why that must stay empty.
  - Budgets fail the build at 1 MB initial. Current initial bundle is ~324 kB
    raw / ~84 kB transferred; a sudden jump means an accidental eager import of
    a lazy route.
  - *(Legacy React app, until it is deleted: `cd frontend && npm ci && npm run
    build` → `frontend/dist`.)*
- **Dev** uses the Angular dev-server proxy (`/api` and `/hubs` →
  `http://localhost:5210`, see `frontend-angular/proxy.conf.js`), so the SPA and
  API are same-origin from the browser's view.
- **Prod** must preserve same-origin for `/api`, because the session cookie is
  `SameSite=Strict`, `HttpOnly`, `Secure`, `Path=/`. Serve the SPA and reverse-proxy
  `/api/*` to the API under **one HTTPS origin** (e.g. nginx / a CDN + origin rule).
  - If you split origins instead, you must add CORS on the API **and** relax the
    cookie's `SameSite` — currently there is **no CORS policy configured**, by
    design. Prefer same-origin.
- No build-time API URL is baked in (calls are relative `/api/...`), so the same
  build works in every environment.

---

## 6. Security hardening (prod)

- **HTTPS everywhere.** The session cookie's `Secure` flag is set only when the
  request is HTTPS (`Request.IsHttps`). Terminate TLS at the proxy and forward
  proto so the app sees HTTPS (configure `ForwardedHeaders` if behind a proxy —
  **not yet wired up; add when deploying behind a load balancer**).
- `AllowedHosts` → the real hostname(s).
- Rate limiting: the `auth` policy is a fixed 20 req/min per IP on public
  auth/guest/webhook endpoints (in `Program.cs`). Behind a proxy this needs the
  real client IP (forwarded headers, above) or it limits the proxy's IP.
- Secrets: `Security:MasterKey`, DB password, SMTP password → secret store only.
- Confirm the dev master-key fallback is **not** in effect (set a real
  `Security:MasterKey`).
- `POST /api/dev/seed` (demo-data seeder) is **Development-only** — it 404s when
  `ASPNETCORE_ENVIRONMENT` isn't Development, so it can't run in prod. Nothing to
  do beyond keeping the environment set correctly.
- **Bulk delete is the only irreversible action in Trackly** (`POST
  /api/tickets/bulk` with `action: "delete"`, up to 100 tickets, **admin only**).
  There is no archive, no soft delete and no bin: the ticket, its conversation,
  attachments, private notes, time entries and activity log all go, and the
  attachment blobs are removed from the bucket too. Nothing needs configuring —
  but two things follow from it in production:
  - **Database backups are the only undo.** Confirm PITR or nightly dumps are
    actually running and restorable *before* handing an admin account to anyone.
  - **Keep the admin role scarce.** Everything else destructive in Trackly is
    reachable by agents; this is not, and that is the only thing standing
    between a mis-click and a permanent loss.

---

## 7. Pre-flight checklist (run per environment)

- [ ] `ConnectionStrings:Trackly` set; DB reachable
- [ ] Migrations applied — automatic on boot unless `Trackly:AutoMigrate` is false, in which case run `dotnet ef database update` yourself
- [ ] **First-run setup done** — open the app, land on `/setup`, create the workspace + first admin **with a password**. This signs you in inline (no email), so it works before SMTP exists. It answers `409` afterwards; if it does not, the installation was never claimed and **anyone who reaches it becomes your administrator**
- [ ] **A second administrator exists.** There is no CLI password recovery. If the only admin loses their password while email is not working, the installation cannot be recovered through the app — only from a database backup
- [ ] **Email proven, if you intend to turn password sign-in off** — **Admin ▾ → Workspace → Email → Send a test email** must succeed first. Trackly refuses to disable the last *proven* method, and an unproven email setting does not count. **Re-send it after any change on the Email screen** — connecting a provider, changing which one sends, or editing the From address all clear the proof, because none of them are what the last test demonstrated
- [ ] **A mail provider connected and designated, or a conscious decision to use the shared relay** — **Admin ▾ → Workspace → Email**. Connecting a provider is not enough; the *Send mail through* dropdown is what puts it to work. A per-provider **Test** proves credentials only, never delivery
- [ ] `Security:MasterKey` set to a real base64 32-byte key, stored + backed up
- [ ] `App:FrontendBaseUrl` = the public SPA URL (test a magic-link email points there)
- [ ] `Storage:LocalPath` on a persistent, backed-up volume (single instance) — still the default and the fallback even when workspaces use a cloud provider
- [ ] Any workspace on Azure/GCS has passed **Admin → Storage → Test connection**
- [ ] Cloud buckets are **private** — unless a CDN is in use, in which case the exposure noted in §3 was a conscious decision
- [ ] Shared SMTP relay configured + SPF/DKIM, or a conscious decision to rely only on per-workspace relays
- [ ] SPA served same-origin with `/api/*` reverse-proxied over HTTPS
- [ ] `AllowedHosts` restricted; forwarded headers configured behind the proxy
- [ ] One API instance if any workspace uses IMAP polling **or live chat** (or add a SignalR backplane) — until leader election / a backplane exists
- [ ] Proxy allows the WebSocket upgrade on `/hubs/*` (live chat)
- [ ] Inbound webhook endpoint publicly reachable over HTTPS (if any tenant uses Option A)
- [ ] Database backups verified **restorable** — bulk delete has no undo (§6)
- [ ] Smoke test: sign in, create a ticket, agent reply → notification email sent, inbound reply → comment added

---

## 8. Per-phase settings log

Append here as phases land, so nothing is missed later.

- **Phase 1–3:** `ConnectionStrings:Trackly`, `App:FrontendBaseUrl`,
  `Storage:LocalPath`, shared `Email:Smtp:*` (magic-link + invite + guest mail).
- **Phase 4 (email):** `Security:MasterKey` (secrets at rest), shared SMTP relay,
  the inbound webhook endpoint reachability, the IMAP-worker single-instance
  constraint. Per-workspace email config is data, not env.
- **Cloud storage:** no new env keys — provider and credentials are per-workspace
  data, set in Admin → Storage. But they are encrypted with `Security:MasterKey`,
  so that key must exist and be backed up *before* any workspace configures one.
  `Storage:LocalPath` still applies to every workspace left on local disk.
- **Phase 5 (SSO):** `App:ApiBaseUrl` drives the OIDC/SAML callback URIs, which
  must be publicly reachable over HTTPS and whitelisted at each IdP:
  - OIDC redirect URI: `{ApiBaseUrl}/api/auth/sso/callback`
  - SAML ACS (POST): `{ApiBaseUrl}/api/auth/saml/acs`; SP metadata for the IdP:
    `{ApiBaseUrl}/api/auth/saml/metadata?workspace=<slug>`
  Per-workspace OIDC config (discovery URL, client id, encrypted client secret),
  SAML IdP metadata, and group→role mappings are data, not env. OIDC to a
  non-loopback IdP requires HTTPS on the discovery URL. SAML AuthnRequests are
  unsigned (no SP signing cert needed); the IdP **response** signature is
  validated against the IdP metadata cert. **Both OIDC and SAML must be verified
  against a real IdP** — there is no automated substitute for a live identity
  provider.
- **Multi-provider SSO (Google / Microsoft / Facebook / Authly / custom):** still
  no new env keys — every provider is a row in `sso_connections`, encrypted with
  `Security:MasterKey`. What changes at deploy time:
  - **One** redirect URI covers every OIDC and OAuth 2.0 provider:
    `{ApiBaseUrl}/api/auth/sso/callback`. Register that exact string at Google,
    Entra and Facebook. It is shown on the SSO settings screen, built from
    `ApiBaseUrl` — so a wrong `ApiBaseUrl` produces a registration that fails at
    the last step of a login and nowhere earlier.
  - **Facebook requires HTTPS** on the redirect URI outside its own dev mode, and
    runs as plain OAuth 2.0 against `graph.facebook.com` — outbound egress to
    `www.facebook.com` and `graph.facebook.com` must be open. The Graph API
    version is pinned in `SsoProviderCatalog` (`v21.0`) and needs revisiting when
    Meta retires it; a retired version fails every Facebook sign-in at once.
  - **Outbound egress** for discovery + JWKS: `accounts.google.com`,
    `login.microsoftonline.com`, plus whatever host serves an Authly or custom
    IdP. A locked-down egress policy is the usual cause of "could not reach the
    identity provider".
  - **Microsoft tenant:** blank means `organizations` — any work or school
    account, from any directory. Set the directory ID to admit only yours.
  - **Authly:** register the redirect URI on an Authly **application** (Web
    confidential, or SPA public — Trackly always sends PKCE, which Authly
    requires either way). Set the **workspace slug** unless your Authly is on a
    per-tenant custom domain; without it `/connect/authorize` fails with
    "different workspace". The `roles` scope is requested by default — leave it
    in, or group→role mapping silently matches nothing. Signing out of Trackly
    does **not** clear Authly's SSO cookie, so the next Authly click
    re-authenticates without a prompt; RP-initiated logout is not implemented.
  - **`allowed_email_domains`** on Google and Facebook connections: without it,
    those buttons admit every account those companies have ever issued and each
    one is created as a Trackly customer. Decide this before the button goes live,
    not after.
  - Verify each provider with a **real sign-in** in a private window. There is no
    test endpoint, deliberately — a connection is only `active` once a login has
    actually completed, and that is what the last-way-in guard counts.
- **Phase 6 (problems / announcements / widget / dashboard):**
  - `GET /widget.js` and `GET /api/public/workspaces/{slug}/widget` are public and
    must be reachable over HTTPS from wherever customers embed the widget. The
    loader embeds the branded submit form same-origin (`{ApiBaseUrl}/submit?...`),
    so keep the SPA and API same-origin (§5).
  - **`AnnouncementWorker` is a second in-process background service** (alongside
    the IMAP poller). It claims each scheduled announcement by stamping `sent_at`
    before sending, but running multiple API instances would still risk double
    sends — reinforces the **single-instance** guidance until leader election
    exists (§4).
  - No new config keys or secrets.
- **Phase 7A (service desk fundamentals):** tags, teams, SLA policies, knowledge
  base, canned responses, automation rules. No new config keys or secrets — all
  per-workspace data. The public KB endpoints (`/api/public/workspaces/{slug}/kb`,
  `/suggest`) and the branded `/kb` SPA route must be reachable over HTTPS like the
  other public surfaces (§5).
- **Phase 7B (AI copilot):** Claude-powered agent assists (draft reply, summarize
  thread, triage suggestion, KB-article draft). New config:
  - `Ai:ApiKey` — Anthropic API key, a **deployment secret**. **Unset ⇒ AI is off
    everywhere** (the API reports `configured: false` and every AI endpoint returns
    409); no key means no external calls, so this is the safe default.
  - `Ai:Model` — optional, defaults to `claude-opus-5`.
  - Per-workspace `workspaces.ai_enabled` (default true, `Phase7bAi` migration) is a
    tenant kill switch **and** must be on for any AI call — both the deployment key
    and the workspace toggle are required.
  - **Data-egress note:** AI features send ticket subject/description, the public
    thread, and (for drafts) published KB excerpts to Anthropic. **Private notes
    (`is_internal`) and other workspaces' data are never sent** — enforced in
    `AiService`. Nothing is auto-sent to customers; every output is agent-reviewed.
    Confirm the tenant is comfortable with this before enabling AI in their workspace.
  - Outbound HTTPS to `api.anthropic.com` must be allowed from the API host.
- **Phase 7C (omnichannel & insight):** CSAT, analytics, messaging connectors,
  live chat. No new server config **keys**, but real deployment concerns:
  - **Public surfaces** (reachable over HTTPS, same origin as the SPA — §5): the
    branded `/csat/:ticketId` and `/chat` pages, `POST /api/public/csat/*`,
    `POST /api/public/chat/*`, and `POST /api/channels/inbound/{provider}/{slug}`.
  - **Live chat needs WebSockets.** SignalR is mapped at `/hubs/chat`; the reverse
    proxy must allow the WebSocket upgrade on `/hubs/*` (nginx: `Upgrade`/
    `Connection` headers). The hub is **in-process**, so with more than one API
    instance either add a **SignalR backplane** (Redis) or run a **single
    instance** — the same single-instance guidance the IMAP/announcement workers
    already impose (§4). Cookie auth flows over the same-origin WS handshake, so
    keep the SPA and API same-origin (§5).
  - **Connector signing secrets** are per-workspace, AES-256-GCM encrypted (data,
    not env). Inbound uses `X-Trackly-Signature` (HMAC-SHA256 over the raw body);
    a provider-native relay (Slack/WhatsApp/Teams) translates the provider payload
    and re-signs. That relay + provider app credentials are configured per tenant,
    outside Trackly.
  - **CSAT** rides existing email config; no new keys. **Analytics** is DB-only.
  - Data note: `Ticket.ResolvedAt` (analytics), `csat_surveys`, `channel_*`,
    `inbound_channel_events`, and `chat_*` tables ship via the Phase 7C migrations
    — apply them (§0.1).
