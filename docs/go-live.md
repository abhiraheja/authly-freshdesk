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
is what a container pointed at an empty database needs. The whole schema is a
**single `InitialCreate`** — the phase-by-phase chain was squashed before the
first production deploy, while no deployed database existed to be upgraded. That
also means there is no upgrade path *from* a pre-squash database: any that exists
is a development one, and it must be dropped and recreated (see
`docs/dev-setup.md` §7). If you set `AutoMigrate` false, apply them yourself as a
deploy step:
```
dotnet ef database update --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
```

---

## 0.5 Deploying with Docker (the supported path)

Trackly ships as **two images**, built and published by
`.github/workflows/docker-image.yml` on every push to `main`:

| Image | Built from | What it is |
|---|---|---|
| `abhiraheja/trackly-api` | `Dockerfile.api` (context = repo root) | ASP.NET Core API + SignalR hub + background workers. Listens on `8080`, runs as uid **1654** (non-root) |
| `abhiraheja/trackly-web` | `frontend-angular/Dockerfile` | The Angular bundle served by nginx, which also reverse-proxies `/api`, `/hubs` and `/widget.js` to the API. Listens on `8080` |

Tags: `latest` (default branch), `sha-<commit>`, and `X.Y.Z` / `X.Y` when a
`v*.*.*` tag is pushed. Pin a digest or a version tag in production — `latest`
means "whatever landed on main".

**Only `web` should be published.** It is the single origin the browser talks to.
That is a correctness requirement, not a preference: the session cookie is
`HttpOnly; SameSite=Strict; Path=/`, so an SPA on one origin and an API on
another would drop it on every request (§5). Exposing the API's port as well is
harmless but pointless; exposing it *instead* does not work.

```bash
cp .env.example .env          # fill POSTGRES_PASSWORD + TRACKLY_MASTER_KEY
docker compose -f docker-compose.self-host.yml up -d
docker compose -f docker-compose.self-host.yml logs -f api   # watch migrations
```

Then open the published URL — an unclaimed install lands on `/setup`. Re-read
§0.1 before that URL is reachable by anyone else.

### What must be persisted

| Volume | Mount | Loses what, if missing |
|---|---|---|
| `trackly-pgdata` | `postgres:/var/lib/postgresql/data` | everything |
| `trackly-storage` | `api:/app/data` | attachments, workspace logos, avatars (`Storage:LocalPath`, preset to `/app/data/storage` in the image) |

The API image creates `/app/data` owned by uid 1654 before dropping privileges,
so a **named** volume inherits that ownership. A **bind mount** does not — `chown
-R 1654:1654` the host directory yourself or every upload fails with a
permission error that only surfaces when a user attaches a file.

### Image-level configuration

Config keys map to environment variables with `__` for `:` —
`ConnectionStrings__Trackly`, `Security__MasterKey`, `App__FrontendBaseUrl`.
`docker-compose.self-host.yml` wires the full set from `.env`; §1 below is the
authoritative list of what each one does.

The `web` image takes three of its own:

| Variable | Default | Purpose |
|---|---|---|
| `TRACKLY_API_URL` | `http://api:8080` | Where nginx forwards `/api`, `/hubs`, `/widget.js`. **No trailing slash** — a trailing slash becomes a `proxy_pass` URI and rewrites the request path. On Kubernetes this must be the **FQDN** — see §0.6 |
| `TRACKLY_RESOLVER` | from `/etc/resolv.conf` | DNS for re-resolving `TRACKLY_API_URL` per request; re-resolution is what keeps the proxy alive across an API container restart, which changes its IP. Auto-detected at container start by `10-trackly-resolver.envsh`, so one image is correct under Docker (`127.0.0.11`) and Kubernetes (kube-dns). Pin it only when neither applies |
| `TRACKLY_MAX_BODY_SIZE` | `30m` | Upload ceiling at the proxy. Keep it **≥** the API's own attachment limit or large uploads fail with a bare `413` from nginx before the API ever sees them |

### TLS

Neither image terminates TLS — put Caddy, Traefik or nginx in front of `web` and
forward `X-Forwarded-Proto`. The compose file already sets
`App__ForwardedHeaders=true` on the API, which is what makes the session cookie
pick up `Secure` and the rate limiter see real client IPs (§6).

### Health

Both images declare a `HEALTHCHECK`, so `depends_on: condition: service_healthy`
works and orchestrators get a real signal:

- API → `GET /health` (anonymous, **does not touch the database**: first boot
  runs EF migrations, and a probe that waited on the DB would restart the
  container mid-migration). Use it for liveness, not readiness.
- Web → `GET /healthz`, served by nginx itself.

---

## 0.6 Deploying on Kubernetes

Compose is the documented path; Kubernetes works from the same two images, and
these five things are what differ. A reference deployment lives in the
`saarvix-k8s` repo (`apps/trackly.yaml`, `config/trackly.yaml`,
`gateway/Ingress-trackly-gateway.yaml`).

1. **`TRACKLY_API_URL` must be the FQDN** —
   `http://trackly-api.<namespace>.svc.cluster.local:8080`. nginx's `resolver`
   does not apply the search domains from `/etc/resolv.conf`, so the bare service
   name that works in Compose never resolves in-cluster. Symptom: the SPA loads
   and every `/api` call 502s.
2. **The resolver itself is auto-detected** from `/etc/resolv.conf`, so leave
   `TRACKLY_RESOLVER` unset — a pinned value would hard-code a cluster IP.
3. **`fsGroup` on the API pod must match the image's uid (1654).** Mounting a
   volume over `/app/data` replaces the directory the image created, so without
   `securityContext.fsGroup: 1654` the mount is root-owned and uploads fail — and
   nothing surfaces it until someone attaches a file to a ticket.
4. **Probes need an explicit `Host` header** if `AllowedHosts` is restricted (and
   §6 says it should be). A kubelet probe sends the pod IP as `Host`, which host
   filtering answers with `400` — so the pod never goes ready.
5. **One API replica, `strategy: Recreate`.** Same singleton constraint as §4/§7C
   (IMAP polling, announcement and SLA workers, in-process SignalR hub, no leader
   election) — and with a ReadWriteOnce volume a RollingUpdate would deadlock
   waiting for the old pod to release it. `trackly-web` is stateless and scales
   freely.

Route the Ingress **only** to `trackly-web`. Splitting `/api` off to the API
Service at the Ingress would work, but it duplicates proxy rules that already
live — and are tested — inside the web image, including the `/hubs` WebSocket
upgrade and `/widget.js` (which the API serves at the site root, not under
`/api`).

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
| `App:ApiBaseUrl` | Public base URL of the API; used to build the **OIDC/SAML redirect (callback) URI**, the **mail OAuth callback URI**, and the **workspace logo URL in HTML emails**. Falls back to the request scheme+host if unset for the callbacks — but the logo has no request to fall back on, so leaving it unset means emails show the workspace name as text instead of the logo | per-env (e.g. `https://app.trackly.com`) | no |
| `App:WidgetScriptBaseUrl` | Origin that serves `/widget.js`, used **only** to build the embed snippet an admin copies from Widget → Integration. Leave unset in any deployment where the API and the SPA share an origin — it falls back to `App:ApiBaseUrl`, which is correct there. Set it only when the two are split, as in local dev, where `ApiBaseUrl` names the SPA (which proxies `/api`) and the SPA does **not** proxy `/widget.js`; a snippet naming that host is copied onto a customer's real site and fetches `index.html` as JavaScript, failing silently | unset in prod; `http://localhost:5210` in dev | no |
| `App:ForwardedHeaders` | Trust `X-Forwarded-For` / `X-Forwarded-Proto`. **Required behind any reverse proxy** (including the bundled nginx image) — without it the per-IP auth rate limiter collapses onto one bucket and the session cookie loses `Secure` behind TLS termination. Leave **false** if the API is directly internet-reachable: the headers are client-spoofable and this flag is the trust boundary (§6) | true behind a proxy, false otherwise | no |
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
| `branding/…` | Workspace logo, sign-in panel image | Public — the only things a CDN URL is ever built for |
| `widgets/<widget-id>/…` | A single widget's own logo, when it overrides the workspace's | Public, same rules |

Only these branding assets are saved with `StorageVisibility.Public`, which is what puts the
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

**Only branding assets are ever given a CDN URL.**
`GET /api/public/workspaces/{slug}/logo`, its slug-less twin `/api/public/logo`,
`/api/public/sign-in-image` and `/api/public/widget/{token}/logo` answer with a
`302` to the CDN;
everything else keeps streaming through the API. Attachments go through
`GET /api/attachments/{id}`, which is where workspace isolation, requester
scoping and the private-note rule (invariant 5) are enforced — a CDN URL carries
no sign-in, so publishing one would bypass all three. The mechanism is the key
prefix: branding assets are written `gcs-public:…`, everything else `gcs:…`, and
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
  - **Google and Microsoft connect with OAuth (XOAUTH2).** The operator registers
    **their own** OAuth client in **their own** Google Cloud project or Entra
    directory — Trackly ships no client id — and pastes the id and secret into the
    card. Still DB config, not environment config.
    - **The redirect URI must be registered in that OAuth client, byte-identical.**
      It is `{App:FrontendBaseUrl}/oauth/callback` — a front-end route, not an API
      path — and the card shows the exact string to copy. Getting it wrong fails at
      the provider with an error that never reaches Trackly.
      **`App:FrontendBaseUrl` must be set in prod**, and to the address an admin
      actually types in a browser; it is also what magic-link and notification
      emails are built from.
    - **Whatever hosts the SPA must serve `index.html` for `/oauth/callback`.** It
      is a deep link the provider navigates to cold, not a route the app ever
      routes to itself — a host that 404s unknown paths breaks consent at the last
      step, after the admin has already approved.
    - Scope is `https://mail.google.com/`, which Google classes as **restricted**.
      An app published **Internal** to the operator's own Workspace organisation
      needs no verification. A **public** app using this scope needs Google's
      verification and a CASA security assessment — so a personal Gmail account,
      which cannot publish internally, should use the app password path instead.
    - Google Workspace stopped accepting plain passwords for IMAP/SMTP/POP in
      March 2025. **App passwords still work** and remain the fallback here, but
      they require 2-Step Verification on the account.
  - **Microsoft has two prod-only traps of its own**, both invisible until after
    go-live:
    - **Register the redirect URI under Entra's *Web* platform, never
      *Single-page application*.** A `spa` redirect URI caps the refresh token at
      **24 hours** with no inactivity reset; a Web one lasts 90 days. Wrong
      choice = inbound mail stops every morning, with a configuration that looks
      correct. Trackly's callback being a front-end route makes SPA the tempting
      answer — it is still wrong.
    - **The directory (tenant) ID is required for a single-tenant registration.**
      Entra rejects the shared `/common` endpoint with `AADSTS50194` for any app
      registered as "Accounts in this organizational directory only" after
      15 Oct 2018. Stored in `email_providers.oauth_tenant_id`; leave it blank
      only for a multi-tenant app (which is also the only way personal
      Outlook.com accounts can connect).
    - Delegated permissions `IMAP.AccessAsUser.All` + `SMTP.Send` on Office 365
      Exchange Online, with tenant admin consent if required. **SMTP AUTH and
      IMAP must be enabled for the mailbox** (`Set-CASMailbox`) — tenant policy
      can have them off and Trackly cannot see that from here.
    - Microsoft publishes no v2.0 revocation endpoint, so **Remove provider**
      clears Trackly's tokens but cannot retire the grant remotely; it is removed
      at myaccount.microsoft.com.
    - Basic auth for SMTP AUTH client submission is disabled by default for
      existing tenants at the end of **December 2026** and removed during 2027.
      That is the **app password** path, not this one — an installation on a
      Microsoft app password has a deadline; one on Connect does not.
  - Yahoo authenticates with an **app password** over ordinary SMTP/IMAP. Its
    OAuth card is deferred (plan Phase 4).
  - SES needs the region's `email-smtp.{region}.amazonaws.com` reachable and a
    **verified identity** for the From address, or mail is rejected.
- `email_configs.sending_provider_id` / `receiving_provider_id` say which
  provider does which job. **A null sender means the shared relay** — that is what
  a fresh install runs on, and since `EmailProviderCleanup` it means exactly that
  and nothing else. Before it, an installation with leftover legacy columns kept
  sending through them while the screen showed the shared relay.
- **Upgrade note — the two-step column move, and the one-way door.** The
  `EmailProviders` migration copied the old `email_configs` SMTP/mailbox columns
  into an `smtp` provider row and pointed the config at it, leaving the originals
  in place so a rollback still had credentials nobody could retype.
  **`EmailProviderCleanup` drops them.** It re-runs the carry-forward first (for
  anyone who edited email through the now-deleted `/api/admin/settings/email`
  after the first migration), and only assigns the sending/receiving roles where
  they are still unset — an installation that has already chosen a sender keeps
  it.

  **Take a database backup before applying it.** Its `Down` restores the columns
  empty: the passwords were encrypted and never displayed, so there is no copy to
  put back and a rollback needs a restore, not a migration. Do not ship it in the
  same deployment as the release that introduced providers — the gap is the whole
  point.

  After it applies, `GET`/`PUT /api/admin/settings/email` no longer exist
  (`POST .../email/test` and the notification endpoints are unaffected). The only
  caller was the retiring React email screen.
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
- **Email templates** (`email_templates`) — the subject and body of every
  message, edited at `/admin/settings/email/templates`. **No environment config,
  and nothing to seed:** a key with no row renders the built-in from code, which
  is what lets a default improved in a later release reach an install that never
  customised it. Two operational consequences:
  - **A customised template is data, so it is a restore concern, not a
    redeploy concern.** It survives upgrades; it does not survive a database
    restore to a point before the edit.
  - **A release that retires a catalogue key leaves its row inert** rather than
    breaking — nothing renders it and nothing errors. Removing a *variable* a
    customised template still references is the case to watch: it renders empty,
    silently. Grep `email_templates.body_html` before dropping one.

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
- **The `trackly-web` image is this, already assembled** (§0.5): the bundle plus
  an nginx that proxies `/api`, `/hubs` (with the WebSocket upgrade) and
  `/widget.js` to the API, so one published port satisfies the same-origin
  requirement above. Rolling your own proxy instead? Copy the rules from
  `frontend-angular/nginx/default.conf.template` — in particular `/widget.js`,
  which is served by the API at the **site root**, not under `/api`, and is
  invisible in a proxy config written from the SPA's routes alone.

---

## 6. Security hardening (prod)

- **HTTPS everywhere.** The session cookie's `Secure` flag is set only when the
  request is HTTPS (`Request.IsHttps`). Terminate TLS at the proxy and set
  **`App:ForwardedHeaders=true`** so the app trusts `X-Forwarded-Proto` and sees
  HTTPS. Without it the cookie silently loses `Secure` behind a TLS-terminating
  proxy — the sign-in still works, so nothing looks wrong.
  - Opt-in on purpose: `X-Forwarded-*` are client-spoofable, and the flag *is*
    the trust boundary (the middleware's default loopback allow-list is cleared,
    because a container proxy's address is not knowable ahead of time). Turn it
    on only when a proxy you control is the sole thing that can reach the API —
    which is exactly the case in `docker-compose.self-host.yml`, where it is
    already set. Never turn it on for an API that is directly internet-reachable.
- `AllowedHosts` → the real hostname(s).
- Rate limiting: the `auth` policy is a fixed 20 req/min per IP on public
  auth/guest/webhook endpoints (in `Program.cs`). Behind a proxy this needs the
  real client IP (`App:ForwardedHeaders`, above) or every visitor in the world
  shares one bucket — the proxy's.
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
- [ ] **If Microsoft is connected:** its redirect URI is registered under Entra's **Web** platform, not *Single-page application*, and the **directory (tenant) ID** is filled in unless the app registration is multi-tenant. The SPA platform silently caps the refresh token at 24 hours; `/common` with a single-tenant app fails outright with `AADSTS50194`
- [ ] `Security:MasterKey` set to a real base64 32-byte key, stored + backed up
- [ ] `App:FrontendBaseUrl` = the public SPA URL (test a magic-link email points there); the SPA host must also serve `index.html` for `/oauth/callback`
- [ ] `App:ApiBaseUrl` = the public API URL, and **reachable from outside** — mail clients fetch the workspace logo from it over the open internet. An address that only resolves inside the cluster gives every recipient a broken image. (Emails only reference the logo when one has actually been uploaded; with no logo the layout prints the workspace name as text, so this matters from the moment branding is set, not before)
- [ ] **Send a test email** and open it: the layout, logo and brand colour are what customers will see. This is also the send that satisfies invariant 8
- [ ] **Branding set** — **Admin ▾ → Branding**: logo, sign-in image, colour and words. The sign-in and verify pages, the portal, the KB, guest views and every email read this one record, so it is worth doing before the first invitation goes out rather than after. Both assets are written to storage as **public** objects (§3); on a workspace using a CDN they get a CDN URL, which is the exposure recorded there
- [ ] **If any email template was customised:** open **Admin ▾ → Workspace → Email → Edit templates** and send a **Test** for each one showing *Customised*. Built-in templates are covered by the send above; a customised one is the only mail nobody has read since it was edited
- [ ] `Storage:LocalPath` on a persistent, backed-up volume (single instance) — still the default and the fallback even when workspaces use a cloud provider
- [ ] Any workspace on Azure/GCS has passed **Admin → Storage → Test connection**
- [ ] Cloud buckets are **private** — unless a CDN is in use, in which case the exposure noted in §3 was a conscious decision
- [ ] Shared SMTP relay configured + SPF/DKIM, or a conscious decision to rely only on per-workspace relays
- [ ] SPA served same-origin with `/api/*` reverse-proxied over HTTPS
- [ ] **Only the `web` container's port is published** — the API is reachable through it, never directly
- [ ] **Image tags pinned** to a version or digest, not `latest`
- [ ] **`/app/data` on the API and `/var/lib/postgresql/data` on Postgres are on persistent volumes** — and if either is a *bind* mount, the host directory is `chown`ed to uid 1654 for the API (§0.5)
- [ ] `TRACKLY_MAX_BODY_SIZE` on the `web` container ≥ the API's attachment limit
- [ ] `AllowedHosts` restricted; `App:ForwardedHeaders=true` **and** the API unreachable except through the proxy (§6)
- [ ] One API instance if any workspace uses IMAP polling **or live chat** (or add a SignalR backplane) — until leader election / a backplane exists. The widget and ticket hubs have the same constraint, but degrade to polling / a manual refresh rather than breaking
- [ ] Proxy allows the WebSocket upgrade on `/hubs/*` (live chat, widget, tickets)
- [ ] Inbound webhook endpoint publicly reachable over HTTPS (if any tenant uses Option A)
- [ ] Database backups verified **restorable** — bulk delete has no undo (§6)
- [ ] Smoke test: sign in, create a ticket, agent reply → notification email sent, inbound reply → comment added

---

## 8. Per-phase settings log

Append here as phases land, so nothing is missed later.

- **Phase 1–3:** `ConnectionStrings:Trackly`, `App:FrontendBaseUrl`,
  `Storage:LocalPath`, shared `Email:Smtp:*`. Magic-link, invite and guest mail
  used to go **straight** to that shared relay, ignoring whatever the admin had
  connected; they now go through the workspace's sending provider and fall back
  to `Email:Smtp:*` only when none is designated. So the shared relay is still
  worth configuring — it is what carries sign-in mail on an install that never
  connects a provider — but it is no longer the only thing that can.
- **Phase 4 (email):** `Security:MasterKey` (secrets at rest), shared SMTP relay,
  the inbound webhook endpoint reachability, the IMAP-worker single-instance
  constraint. Per-workspace email config is data, not env.
- **Email templates:** no new env keys and nothing to seed — a key with no row
  renders the built-in from code. The one environment dependency is
  `App:ApiBaseUrl`, which is what makes the workspace logo an absolute,
  externally-fetchable URL in HTML mail. Customised templates are workspace data:
  they survive upgrades, and a database restore is the only way to get one back.
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
- **Widget rework (`docs/widget-plan.md`, phases 1–5 landed):**
  - **`/widget/:token` must be served by the SPA** like every other client-side
    route — it is the document the loader puts in its iframe. A proxy that does
    not fall back to `index.html` for it produces an embed whose launcher opens
    an empty box. No new config: the URL is built from `App:FrontendBaseUrl`.
  - **The panel opens a WebSocket.** It connects to `/hubs/widget` and falls back
    to polling only while that connection is down — see the hub entry below for
    what a proxy that blocks the upgrade actually costs. `@microsoft/signalr` is
    already in the bundle for live chat and stays in a lazy chunk, so the initial
    payload is unchanged; there is no new package to install.
  - **CORS.** Since phase 4 the API declares one cross-origin policy, applied to
    `/api/public/widget/*` and `/api/public/workspaces/{slug}/widget` only. It
    allows **any** origin, because `widget.js` runs on the customer's site and
    those are the calls it makes; the per-widget `allowed_origins` list is the
    actual boundary and is checked server-side. Nothing else in Trackly answers
    another origin. A reverse proxy that strips or rewrites
    `Access-Control-Allow-Origin` will make every embedded widget silently
    inert — the launcher simply never appears.
  - **`App:FrontendBaseUrl` is now load-bearing for the widget.** The public
    config returns `frameUrl` built from it, and that is the iframe's `src` *and*
    the origin the loader validates `postMessage` against. Wrong or unset, the
    panel does not open. Previously it only shaped links inside emails, where a
    bad value was survivable.
  - **A new family of anonymous endpoints** under `/api/public/widget/{token}/…`
    — config, session, email verification, conversation create, conversation
    list/thread/reply/read-receipt/attachments. All must be reachable over HTTPS
    from every site that embeds a widget. They resolve the workspace from the
    widget token server-side and never accept a slug.
  - **A second SignalR hub, `/hubs/widget`** (phase 3; the panel connects to it
    as of the SignalR change). Same proxy requirement as `/hubs/chat`: the
    WebSocket upgrade must be allowed on `/hubs/*`.

    Still a latency feature, not a correctness one — a blocked upgrade drops the
    panel back to polling, so a reply takes up to 20 seconds to appear instead of
    the ~300ms measured with the socket up. That is the *symptom to look for*:
    "the widget is slow to show replies, but the ticket is fine" means the
    upgrade is being blocked somewhere, and SignalR's own SSE/long-polling
    fallbacks are being blocked too. Nothing is lost, only time.
  - **Widget secret keys are AES-256-GCM under `Security:MasterKey`.** Losing or
    rotating that key makes every widget's secret unreadable, which breaks
    identity verification on every embed at once. Rotation story: regenerate each
    widget's key from the admin screen and re-deploy the host pages' signing
    config — there is deliberately no overlap window, so plan the order.
  - **The `allowed_origins` allowlist is the only enforcement there is.** A
    `frame-ancestors` header cannot be set for `/widget/:token`, because nginx
    serves it as a static SPA route and does not know the per-widget list (see
    the deliberate no-`X-Frame-Options` comment in `default.conf.template`). An
    unlisted site can still *draw* the iframe; it just cannot obtain config or a
    session, so the panel is inert. Leave the list empty only if you are happy
    for the widget to load anywhere.
  - **`X-Forwarded-For` matters more here than anywhere else.** The session,
    verification and conversation endpoints carry the per-IP `"auth"` rate limit;
    behind the SPA's nginx without `App:ForwardedHeaders` (§5) every visitor on
    the internet shares one partition, and 20 requests a minute is the whole
    widget's budget.
  - No new config keys.
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
  - **The SPA ships a SignalR client** (`@microsoft/signalr`, a runtime
    dependency of `frontend-angular`). It is the only third-party runtime package
    in the frontend; it is bundled, so it needs no CDN and no CSP exception
    beyond the WebSocket connect-src to your own origin.
  - **A blocked upgrade degrades, it does not break.** Messages are posted and
    persisted over plain HTTP and only *delivered* over the socket, so a proxy
    that refuses the upgrade leaves both sides working with no live updates —
    the console shows a banner with a Refresh button and the visitor's window
    shows an amber connection dot. Worth knowing before somebody debugs a
    "broken" chat that is in fact a missing `proxy_set_header Upgrade`.
  - **Connector signing secrets** are per-workspace, AES-256-GCM encrypted (data,
    not env). Inbound uses `X-Trackly-Signature` (HMAC-SHA256 over the raw body);
    a provider-native relay (Slack/WhatsApp/Teams) translates the provider payload
    and re-signs. That relay + provider app credentials are configured per tenant,
    outside Trackly.
  - **CSAT** rides existing email config; no new keys. **Analytics** is DB-only.
  - Data note: `Ticket.ResolvedAt` (analytics), `csat_surveys`, `channel_*`,
    `inbound_channel_events`, and `chat_*` tables ship via the Phase 7C migrations
    — apply them (§0.1).
- **Packaging (Docker images + CI):** one new server key,
  **`App:ForwardedHeaders`** (§1, §6) — off by default, set to `true` in
  `docker-compose.self-host.yml` because the bundled nginx is then the only thing
  that can reach the API. It is what makes the per-IP auth rate limiter and the
  session cookie's `Secure` flag behave behind a proxy; both fail *silently*
  without it, which is why it is worth checking rather than assuming.
  - New anonymous endpoint **`GET /health`** (liveness, no DB access) for
    container and orchestrator probes. It reveals nothing and needs no config.
  - The `web` image adds three of its own variables (`TRACKLY_API_URL`,
    `TRACKLY_RESOLVER`, `TRACKLY_MAX_BODY_SIZE` — §0.5). No secrets.
  - **CI secrets:** `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` on the repository
    or its `DockerDeploy` environment. Nothing else in the workflow is sensitive;
    pull requests build both images but never push.
  - Two new persistent volumes to provision and back up (§0.5).
  - **Migrations were squashed to a single `InitialCreate`** before the first
    production deploy, while no deployed database existed. Verified by diffing a
    database built from the old 43-migration chain against one built from the
    squash — tables, columns, constraints and indexes. Two deliberate deltas:
    `ix_tickets_sla_sweep` moved from raw migration SQL into the model (it existed
    in the database but not the model, so the squash dropped it), and 20 columns
    lost a DB-level `DEFAULT` that only existed because `ADD COLUMN … NOT NULL`
    requires one. See `docs/dev-setup.md` §7 for why the defaults were not
    reinstated. **There is no upgrade path from a pre-squash database** — dev
    boxes must be dropped and recreated.
  - **Kubernetes:** five deployment-shape requirements that Compose hides — see
    §0.6. All five fail quietly rather than loudly, so they are worth checking
    against a running pod rather than assumed from the manifest.
- **Ticket relationships, the resolve gate and the registers:** **no new env keys,
  no new secrets, no migration** — DTOs, queries and endpoints over the existing
  schema. Three prod-only things to know:
  - **Resolving a ticket can now email several customers at once.** Ticking the
    duplicates in the resolve dialog resolves each linked ticket as a real
    resolve, so each one sends its own resolution email and issues its own CSAT
    survey. On an install whose sending provider has a low rate limit, one click
    can therefore queue up to 25 messages (`TicketResolveGuard.MaxCascade`). Worth
    checking against your provider's per-minute cap before an outage produces a
    genuinely long duplicate chain.
  - **`GET /api/tickets?search=#019fea6e` matches on the primary-key index**, via
    a uuid range rather than `id::text LIKE`. Nothing to configure, but if you ever
    replace the id strategy the range maths in `TicketNumber` assumes the canonical
    hex form orders the same way PostgreSQL orders `uuid` — true for any uuid, and
    the thing that would break silently if ids stopped being uuids.
  - **No new indexes were needed.** The relation, task, responder, asset and
    impacted-service queries all run on indexes that already existed
    (`ix_ticket_relations_related_ticket_id`, `ix_ticket_tasks_assignee_id_completed_at`,
    `ix_ticket_assets_asset_id`, `ix_ticket_impacted_services_service_id`). Worth
    re-checking with `EXPLAIN` on a workspace with a large ticket table before
    assuming it holds at your scale.
- **Dashboards and reward goals:** **no new env keys and no new secrets.** One
  migration (`AddRewardGoals` — `reward_goals`, `agent_reward_awards`) and one new
  background worker. What to know per environment:
  - **`RewardWorker` runs on every instance, and that is safe.** Awarding is made
    idempotent by the unique index on `(goal_id, agent_id, period_key)`, so two API
    replicas cannot double-award. Unlike `EmailPollingWorker` it needs **no**
    single-instance constraint — see §0.6 for the ones that do.
  - It sweeps every 15 minutes, after a 30-second start-up delay, and measures every
    active agent against every active goal. Cost scales with agents × goals and is
    capped at `RewardService.MaxAgentsPerSweep` (200). A workspace larger than that
    has outgrown a per-tick full recompute; the cap means it degrades to "the first
    200 agents" rather than to a slow sweep, so raise it deliberately rather than
    discovering it.
  - **`GET /api/dashboard/analytics` is admin-only and unbounded by page.** It pulls
    every ticket created or resolved in the window plus every unfinished ticket, and
    reduces in memory so the duration maths stays provider-agnostic. Fine at the
    scale this ships at; worth an `EXPLAIN` and a think about a materialised summary
    before a workspace with hundreds of thousands of tickets.
  - **`GET /api/dashboard/me` is agent-readable and `agent=` is honoured for admins
    only.** That check is in `DashboardController`, not the service. If you ever add
    another caller, re-apply it — without it, any agent can read a colleague's
    response times and CSAT by editing a query string.
  - Nothing is seeded. An install with no reward goals shows no scoreboard anywhere,
    which is the correct empty state rather than a configuration gap.

- **Release plans** — no new config key, no secret, no external dependency. Two
  things to know before this reaches production:
  - **`release_steps.body` is stored in plaintext, on purpose.** It holds
    migrations and shell commands, which are not secrets and are worthless if the
    person running them has to retype them from memory. Configuration steps store
    the variable **name** only — there is no field in the UI in which a value can
    be typed — so no application secret is meant to reach this table. That is a
    convention the product enforces structurally, not a database constraint: if
    somebody pastes a connection string into a manual step, it is in the table.
    Treat `release_steps` as readable by every agent, because it is.
  - **`workspaces.work_item_url_template` is interpolated into an `href`.** It is
    admin-only to write, must contain `{id}`, and the key is URL-escaped before
    substitution. It is a link target, not markup — but it is also the one field
    here that a non-admin's browser follows, so keep it admin-only if you ever move
    the endpoint.
  - **New SignalR hub at `/hubs/releases`**, and a matching SPA config key
    `releaseHubPath` (`src/environments/*.ts` → `app.config.ts`). Anything in
    front of the API that terminates or rewrites WebSockets — nginx, an ingress,
    an Application Gateway — needs the same treatment `/hubs/chat` already has,
    or release pages silently stop updating for everyone but the person clicking.
    Unlike the IMAP poller this needs **no** single-instance constraint, but it
    does need sticky sessions or a backplane behind more than one API replica:
    the broadcast only reaches clients connected to the instance that handled the
    write. Falling back to polling is not a problem — the REST response is the
    source of truth and every tick still lands.
  - **`POST /api/releases/{id}/status` with `resolveTickets: true` sends
    customer email.** It resolves every linked open ticket and fires the
    status-change notification for each, so it is the one release endpoint that
    writes to people outside the workspace. It is opt-in per call and the SPA
    asks separately, but if you script against this API, know that the flag is
    the difference between a status change and a mail-out.
  - Deleting a user is unaffected: every actor column on a release
    (`done_by`, `tested_by`, `verified_by`, `completed_by`, `release_manager_id`,
    `actor_id`) is `ON DELETE SET NULL`, so a two-year-old tick never blocks an
    offboarding. `releases.created_by` is `RESTRICT`, matching `problems`.

### Widget & ticket realtime, and the embed snippet's origin

- **New SignalR hub at `/hubs/tickets`**, with a matching SPA config key
  `ticketHubPath` (`src/environments/*.ts` → `app.config.ts`). It carries the
  push that was missing in the customer→agent direction: a reply arriving from
  the widget, the portal or an inbound email now reaches an open ticket page
  instead of waiting for someone to reload. Same proxy requirement as every
  other hub — the WebSocket upgrade must be allowed on `/hubs/*`.
  - **Staff only, and enforced in the hub.** `[Authorize]` alone is not enough:
    a customer holds a perfectly valid session, so `TicketHub.OnConnectedAsync`
    also checks the role before joining the workspace group. Without that check
    every customer would be told each time any ticket in the workspace moved.
  - The group is per **workspace**, not per ticket, and the payload is only a
    `ticketId`. Screens re-fetch through the ticket endpoints, so workspace
    isolation and the private-note rules (invariants 1 and 5) stay in exactly
    one place.
  - Behind more than one API replica it needs sticky sessions or a backplane,
    like `/hubs/releases`. Degrading costs a manual refresh, never data.
- **The widget panel now connects to `/hubs/widget`** (SPA key `widgetHubPath`).
  The hub had existed since phase 3 and the server had been pushing to it, but
  nothing in the panel ever subscribed — replies arrived only on the 20s list /
  10s thread poll. The polls stay as the documented fallback, so a network that
  blocks WebSockets costs latency and not delivery.
- **`App:WidgetScriptBaseUrl`** (see the config table in §5). Only affects the
  embed snippet on Widget → Integration. Leave it unset wherever the API and the
  SPA share an origin. It exists because dev deliberately points
  `App:ApiBaseUrl` at the SPA — which proxies `/api` and `/hubs` but **not**
  `/widget.js` — so the generated snippet named a host that answers with
  `index.html`. Pasted onto a customer's site that fails with nothing in the
  console anyone can act on.
