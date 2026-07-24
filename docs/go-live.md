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
| `App:FrontendBaseUrl` | Absolute base URL of the SPA; used to build links in **emails** (magic links, invites, guest tracking, notifications) | per-env (e.g. `https://app.trackly.com`) | no |
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

## 3. File storage (attachments + workspace logos)

- Current implementation is **`LocalFileStorage`** — writes to `Storage:LocalPath`
  (defaults to `<app>/storage`). Fine for a single instance.
- **Gaps to close before horizontal scaling:** local disk is not shared across
  instances and not durable on ephemeral hosts. A cloud `IFileStorage`
  (S3 / Azure Blob / GCS) is the intended production implementation — not yet
  built. Until then: run a single API instance, mount a **persistent** volume at
  `Storage:LocalPath`, and include it in backups.

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

- Build: `cd frontend && npm ci && npm run build` → static assets in `frontend/dist`.
- **Dev** uses a Vite proxy (`/api` → `http://localhost:5210`), so the SPA and API
  are same-origin from the browser's view.
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

---

## 7. Pre-flight checklist (run per environment)

- [ ] `ConnectionStrings:Trackly` set; DB reachable
- [ ] Migrations applied (`dotnet ef database update`) — **not automatic here**
- [ ] `Security:MasterKey` set to a real base64 32-byte key, stored + backed up
- [ ] `App:FrontendBaseUrl` = the public SPA URL (test a magic-link email points there)
- [ ] `Storage:LocalPath` on a persistent, backed-up volume (single instance)
- [ ] Shared SMTP relay configured + SPF/DKIM, or a conscious decision to rely only on per-workspace relays
- [ ] SPA served same-origin with `/api/*` reverse-proxied over HTTPS
- [ ] `AllowedHosts` restricted; forwarded headers configured behind the proxy
- [ ] One API instance if any workspace uses IMAP polling (until leader election exists)
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
- **Phase 5 (SSO):** _TBD — will add per-workspace OIDC/SAML config (encrypted
  client secrets, redirect URIs that must be whitelisted at each IdP), and the
  public callback URL(s) that must be reachable._
- **Phase 6+ / Phase 7:** _TBD — widget embed origin/CORS, AI copilot API key
  (`Anthropic`/Claude) as a deployment secret, omnichannel connector credentials._
