# Trackly — Developer Setup

First-time setup for running Trackly locally, plus the everyday dev workflow and a
troubleshooting section for the issues you're most likely to hit. If you just want
to understand the product, read `docs/admin-guide.md`; for architecture, read
`docs/trackly-plan.md`.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **.NET SDK** | **10.0+** | Backend targets `net10.0`. `dotnet --version` |
| **Node.js** | **20+** (22/24 fine) | Frontend SPA. `node -v` |
| **Docker Desktop** | any recent | Runs PostgreSQL locally |
| **Git** | any | — |

Windows is the primary dev environment (PowerShell). macOS/Linux work too — swap
PowerShell commands for your shell.

---

## 2. Get the code

```bash
git clone <repo-url> authly-freshdesk
cd authly-freshdesk
```

Solution file is **`Trackly.slnx`** (the .NET 10 XML solution format) at the repo
root — `dotnet build` at the root picks it up automatically.

---

## 3. One-time local configuration

### 3a. Start PostgreSQL

```bash
docker compose up -d
```

This runs **PostgreSQL 16** as `trackly-postgres` on `localhost:5432` with database
`trackly`, user `trackly`, password `trackly` (see `docker-compose.yml`). Data
persists in the `trackly-pgdata` volume.

### 3b. Create `appsettings.Development.json`

`src/Trackly.Api/appsettings.Development.json` is **gitignored**, so a fresh clone
doesn't have it. Create it with the minimum:

```json
{
  "ConnectionStrings": {
    "Trackly": "Host=localhost;Port=5432;Database=trackly;Username=trackly;Password=trackly"
  },
  "App": { "FrontendBaseUrl": "http://localhost:4200" }
}
```

`FrontendBaseUrl` is what magic links, invitations and CSAT emails point at — set
it to whichever SPA you're running (`:4200` Angular, `:5173` the legacy React
app). A link generated against the wrong port lands on a dead page.

That's all you need for local dev. Everything else has a safe development fallback:

- **`Security:MasterKey`** — a fixed dev key is derived automatically in
  Development (secrets-at-rest still work). Never let that fallback reach prod.
- **`Storage:LocalPath`** — defaults to `<app>/storage` for uploaded files.
- **`Email:Smtp:*`** — if unset, outbound mail (magic-link codes, notifications) is
  **written to the API console log** instead of being sent. This is how you grab
  login codes locally (see §5).
- **`Ai:ApiKey`** — optional; leave empty to keep the AI copilot off (§7).

---

## 4. Run it

Two terminals:

```bash
# Terminal 1 — API on http://localhost:5210
#   In Development it auto-applies EF migrations on startup.
dotnet run --project src/Trackly.Api --urls http://localhost:5210
```

```bash
# Terminal 2 — SPA on http://localhost:4200
cd frontend-angular
npm install          # first time only
npm start            # = ng serve, picks up proxy.conf.js
```

Open **http://localhost:4200**. The Angular dev server proxies `/api` **and**
`/hubs` (the SignalR live-chat WebSocket) to the API at `:5210`, so the browser
sees one origin — which the same-site session cookie requires. Point it at a
different API with `TRACKLY_API=http://host:port npm start`.

> **Migrating from React.** `frontend/` is the retiring React + MUI SPA on
> `:5173` (`cd frontend && npm run dev`). Both still run; routes not yet ported
> render a "Not migrated yet" placeholder naming the React file to port. When
> the port finishes, `frontend/` and its launch configs get deleted.

### Run both together in VS Code (one F5)

The repo ships VS Code configs, so you don't have to create anything:

- **`.vscode/launch.json`** — `API (Trackly.Api)` (coreclr on `:5210`),
  `Frontend (Angular)`, `Frontend (Angular) + browser`, and the legacy
  `Frontend (Vite — legacy React)`. Compounds: **`Full stack (API + Angular)`**,
  **`Full stack + browser debug`**, and `Full stack (API + legacy React)`.
  All use `stopAll`, so stopping tears everything down.
- **`.vscode/tasks.json`** — `postgres: up` (`docker compose up -d`),
  `build: api` (depends on `postgres: up`, so the DB comes up first),
  `frontend-angular: dev`, `frontend-angular: build`, and the legacy
  `frontend: dev`.

**To use it:** open **Run and Debug** (Ctrl+Shift+D), pick **“Full stack (API +
Angular)”**, and press **F5**. That brings up Postgres, builds and debugs the API
on `:5210`, and serves the SPA on `:4200`. Breakpoints work in C# immediately.

For breakpoints in Angular components pick **“Full stack + browser debug”**
instead — it waits for the dev server to print its URL before launching a
debuggable browser, which a plain compound would race.

Requires the **C#** (or C# Dev Kit) extension for the .NET debugger; the
JavaScript debugger is built in. Run `npm install` in `frontend-angular/` once
before the first launch.

> If you customise these, they're just JSON under `.vscode/`. The
> `API (Trackly.Api)` config sets `ASPNETCORE_URLS=http://localhost:5210` so it
> matches the proxy target in `frontend-angular/proxy.conf.js`.

---

## 5. First run + signing in

An empty database has no workspace, so the app sends you to **`/setup`**:

1. Enter an organisation name, your email, and a password (12+ characters). You
   are created as the **admin** and signed in immediately, with no code to paste.
   Setup deliberately does not email anything: SMTP is configured from inside the
   app, so on a fresh database there is no way to deliver a link yet — which is
   also why there is a password at all.
2. `/setup` closes permanently once it has run; going back there redirects to
   `/login`.

**Signing in afterwards.** Email and password, on the login page — that is the
everyday path and it needs nothing configured.

**Adding an agent to test with.** **Admin ▾ → People → Members → Add member**.
Trackly shows a temporary password once; sign in with it in a private window and
you will be forced to replace it before anything else works.

**The emailed-code path** (customers, and anyone without a password):

1. On the login page, choose **Email me a sign-in code instead**.
2. Because no SMTP relay is configured, the **magic link + 6-digit code are printed
   to the API console** (Terminal 1). Copy the code.
3. Paste it to verify. An email with no account signs in as a **customer** — that
   is how customers self-serve the portal.

**Starting over.** Setup only runs on an installation with no workspace, so to see
it again drop and recreate the database:

```bash
docker compose down -v && docker compose up -d
```

### Seed demo data (recommended)

Fill the empty workspace with realistic data (agents, customers, ~10 tickets across
statuses/priorities with SLA countdowns, a problem, tags, a team, SLA policies, KB
articles, canned responses, an automation rule, an announcement):

```bash
powershell -File .\scripts\seed-demo.ps1 -AdminEmail you@example.com
```

or, signed in as admin, run in the browser console:

```js
fetch('/api/dev/seed', { method: 'POST' }).then(r => r.json()).then(console.log)
```

It's one-time (refuses if the workspace already has tickets) and `POST /api/dev/seed`
**404s outside Development**.

---

## 6. Project orientation

```
Trackly.slnx                 # .NET 10 solution (root)
docker-compose.yml           # local PostgreSQL 16
src/
  Trackly.Core/              # entities, interfaces, enums (no dependencies)
  Trackly.Modules/           # business logic (auth, tickets, email, sso, kb, sla,
                             #   automation, ai, channels, chat, csat, dashboard…)
  Trackly.Infrastructure/    # EF Core DbContext + migrations, email, storage, crypto,
                             #   OIDC/DNS, Anthropic AI client
  Trackly.Api/               # controllers, SignalR chat hub, background workers,
                             #   session auth scheme, middleware
frontend-angular/            # Angular 22 SPA — the frontend
  src/styles.scss            #   design tokens + component CSS layer
  src/tailwind.css           #   @theme inline — tokens → Tailwind utilities
  src/app/core/              #   api client, session, guards, theme, tone maps
  src/app/ui/                #   the design system (import from 'app/ui')
  src/app/shell/             #   sidebar + top bar + ⌘K palette + nav.ts
  src/app/features/          #   one folder per screen
frontend/                    # LEGACY React 19 + MUI SPA — retiring, port in progress
scripts/                     # PowerShell verify suites + demo seeder
docs/                        # plan (design), admin-guide, go-live, dev-setup, mockups
```

Layering: **Core → Infrastructure → Modules → Api** (dependencies point inward).
Read `CLAUDE.md` for the non-negotiable invariants (workspace isolation, hashed
tokens, encrypted secrets, private-note handling) before writing backend code.

---

## 7. Everyday dev workflow

### Build & typecheck

```bash
dotnet build                                   # whole solution (Trackly.slnx)
cd frontend-angular && npx ng build            # frontend build + type check
```

### EF Core migrations

Adding or changing an entity? Create a migration, then apply it:

```bash
dotnet ef migrations add <Name> \
  --project src/Trackly.Infrastructure --startup-project src/Trackly.Api \
  --output-dir Data/Migrations

dotnet ef database update \
  --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
```

In Development the API also applies pending migrations on startup, so once the
migration exists you can just restart the API. (Install the tool once if needed:
`dotnet tool install --global dotnet-ef`.)

### Verification scripts

Each phase has a PowerShell suite in `scripts/` that drives the **running** API and
asserts behaviour. Start the DB + API, then:

```bash
powershell -File .\scripts\verify-phase7c-chat.ps1 -AdminEmail you@example.com
```

Available: `verify-phase4` … `verify-phase7b`, and
`verify-phase7c-{csat,analytics,channels,chat}`. Most prompt you to paste the login
code from the API console. **Not fully automatable:** SSO/SAML (need a real IdP) and
live-chat real-time (SignalR needs a browser — the script covers the REST surface).

### Optional: enable the AI copilot locally

Set an Anthropic key in `appsettings.Development.json`, then turn it on per workspace
under **Admin ▾ → Workflow → AI copilot**:

```json
{ "Ai": { "ApiKey": "sk-ant-…" } }
```

Both the key **and** the workspace toggle are required, or all AI actions stay off.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| API can't connect to the DB on startup | Postgres isn't up. `docker compose up -d`; check `docker ps` for `trackly-postgres`. |
| `appsettings.Development.json` missing / connection string null | You skipped §3b — create the file. |
| Login page never shows a code | No SMTP configured (expected in dev) — the code is in the **API console log** (Terminal 1), not your inbox. |
| Build error `MSB3021` / `MSB3027` "cannot copy … .dll … being used" | The API is running (often under the debugger) and holds a lock. Stop it, or build a single non-Api project (`dotnet build src/Trackly.Core`). The compile itself already succeeded. |
| EF `PendingModelChangesWarning` | A model change has no migration. Add one (§7). (A known EF 10 false-positive is suppressed in `Program.cs`.) |
| `Port 5432 already in use` | Another Postgres is running. Stop it, or change the host port in `docker-compose.yml` and the connection string. |
| Port `5210`/`4200` in use | Another instance is running; stop it, or pass a different `--urls` / `npm start -- --port 4300`. |
| Live chat doesn't connect (`/hubs/chat`) | Make sure you're on the dev-server URL (`:4200`), so the WebSocket is proxied — `/hubs` has `ws: true` in `proxy.conf.js`. Hitting `:5210` directly bypasses the proxy. |
| Signed out on every request / 401 loop | You're on a different origin from the API. The session is a same-site HttpOnly cookie, so the SPA must be reached through the dev-server proxy, not the API host. |
| A Tailwind class silently does nothing | It was built by interpolation (`'bg-' + tone`). Tailwind v4 only emits classes it can find as literal strings — use a static lookup or a class from `styles.scss`. No error is reported for this. |
| Angular page doesn't repaint after an update | The app is **zoneless**. State that a template reads must be a signal; mutating a plain field or array in place won't trigger anything. |
| Git warns `LF will be replaced by CRLF` | Harmless line-ending normalization on Windows. |
| `dotnet ef` not found | `dotnet tool install --global dotnet-ef`. |
| Restore fails `NU1301 … 401 (Unauthorized)` on a private feed | A machine- or user-level `NuGet.Config` (`%AppData%\NuGet\NuGet.Config`) adds a private feed with expired credentials; NuGet queries **every** configured source on restore, even though Trackly uses only nuget.org. The repo-root `nuget.config` `<clear />`s inherited sources — make sure you're restoring from the repo root and that file is present. |

---

## 9. Where to go next

- **`docs/admin-guide.md`** — what every feature does and how to set it up.
- **`docs/trackly-plan.md`** — architecture, auth flows, schema, phases.
- **`docs/go-live.md`** — deploying to a real environment (config, secrets, infra).
- **`CLAUDE.md`** — invariants and conventions to follow when contributing.
