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

## 0. The two things most likely to bite

1. **Migrations do not auto-apply outside Development.** `Program.cs` runs
   `Database.Migrate()` only when `app.Environment.IsDevelopment()`. In every other
   environment you must apply migrations yourself as a deploy step:
   ```
   dotnet ef database update --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
   ```
   (or generate an idempotent SQL script with `dotnet ef migrations script -i` and
   run it in your release pipeline). Forgetting this = a running API against an
   empty/stale schema.
2. **`Security:MasterKey` is forever.** It encrypts every stored secret (SMTP/IMAP
   passwords, webhook secrets, future OAuth tokens). If it changes or is lost,
   every previously-encrypted value becomes undecryptable. Generate it once per
   environment, store it in the secret manager, and back it up. In Development a
   fixed fallback key is used so local runs work — **never let that reach prod.**

---

## 1. Server configuration (`Trackly.Api`)

Set via `appsettings.{Environment}.json`, environment variables
(`ConnectionStrings__Trackly`, `Security__MasterKey`, …), or the platform secret
store. Empty strings in the committed `appsettings.json` are placeholders.

| Key | Purpose | Prod requirement | Secret |
|-----|---------|------------------|--------|
| `ConnectionStrings:Trackly` | PostgreSQL connection string | per-env | secret |
| `Security:MasterKey` | base64 **32-byte** AES-256-GCM key for secrets at rest | per-env, generate once, back up | secret |
| `Ai:ApiKey` | Anthropic (Claude) API key for the AI copilot. Unset ⇒ AI features stay off everywhere | per-env (only if using AI) | secret |
| `Ai:Model` | Claude model id for the copilot (defaults to `claude-opus-5`) | optional | no |
| `App:FrontendBaseUrl` | Absolute base URL of the SPA; used to build links in **emails** (magic links, invites, guest tracking, notifications) and SSO redirects | per-env (e.g. `https://app.trackly.com`) | no |
| `App:ApiBaseUrl` | Public base URL of the API; used to build the **OIDC/SAML redirect (callback) URI**. Falls back to the request scheme+host if unset — set it explicitly behind a proxy | per-env (e.g. `https://app.trackly.com`) | no |
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
- Own SMTP relay (optional) — falls back to the shared relay.
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

---

## 7. Pre-flight checklist (run per environment)

- [ ] `ConnectionStrings:Trackly` set; DB reachable
- [ ] Migrations applied (`dotnet ef database update`) — **not automatic here**
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
  validated against the IdP metadata cert. Domain routing needs outbound DNS
  (TXT lookups) from the API host. **Both OIDC and SAML must be verified against a
  real IdP** — there is no automated substitute for a live identity provider.
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
