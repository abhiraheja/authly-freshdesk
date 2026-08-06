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
  "App": { "FrontendBaseUrl": "http://localhost:5173" }
}
```

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
# Terminal 2 — SPA on http://localhost:5173
cd frontend
npm install          # first time only (installs @microsoft/signalr etc.)
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` **and** `/hubs` (the SignalR
live-chat WebSocket) to the API at `:5210`, so the browser sees one origin.

### Run both together in VS Code (one F5)

The repo already ships VS Code configs, so you don't have to create anything:

- **`.vscode/launch.json`** — an `API (Trackly.Api)` config (coreclr, on `:5210`), a
  `Frontend (Vite)` config, and a **compound** `Full stack (API + Frontend)` that
  starts both with `stopAll` (stopping tears both down).
- **`.vscode/tasks.json`** — `postgres: up` (`docker compose up -d`), `build: api`
  (depends on `postgres: up`, so the DB comes up first), and `frontend: dev`.

**To use it:** open the **Run and Debug** panel (Ctrl+Shift+D), pick
**“Full stack (API + Frontend)”** from the dropdown, and press **F5**. That brings
up Postgres, builds and debugs the API on `:5210`, and runs the SPA on `:5173`.
Breakpoints work in both C# and the SPA's TypeScript.

Requires the **C#** (or C# Dev Kit) extension for the .NET debugger; the JavaScript
debugger is built in. Run `npm install` in `frontend/` once before the first launch.

> If you customise these, they’re just JSON under `.vscode/` — edit the config
> names/ports there. The `API (Trackly.Api)` config sets
> `ASPNETCORE_URLS=http://localhost:5210` so it matches the Vite proxy in
> `frontend/vite.config.ts`.

---

## 5. First login + create a workspace

1. On the login page, enter any email (e.g. `you@example.com`).
2. Because no SMTP relay is configured, the **magic link + 6-digit code are printed
   to the API console** (Terminal 1). Copy the code.
3. Paste it to verify. A new email = a new account (sign-up = login).
4. Complete onboarding: name your workspace and pick a **slug** (used in customer
   URLs like `/submit?workspace=<slug>`). You're now an **admin**.

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
frontend/                    # React 18 + TS + Vite SPA (MUI, TanStack Query, Zustand)
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
cd frontend && npx tsc -b --noEmit             # frontend type check
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
| Port `5210`/`5173` in use | Another instance is running; stop it or pass a different `--urls` / Vite port. |
| Live chat doesn't connect (`/hubs/chat`) | Make sure you're on the Vite dev URL (`:5173`) so the WebSocket is proxied; the `/hubs` proxy has `ws: true` in `vite.config.ts`. |
| Git warns `LF will be replaced by CRLF` | Harmless line-ending normalization on Windows. |
| `dotnet ef` not found | `dotnet tool install --global dotnet-ef`. |
| Restore fails `NU1301 … 401 (Unauthorized)` on a private feed | A machine- or user-level `NuGet.Config` (`%AppData%\NuGet\NuGet.Config`) adds a private feed with expired credentials; NuGet queries **every** configured source on restore, even though Trackly uses only nuget.org. The repo-root `nuget.config` `<clear />`s inherited sources — make sure you're restoring from the repo root and that file is present. |

---

## 9. Where to go next

- **`docs/admin-guide.md`** — what every feature does and how to set it up.
- **`docs/trackly-plan.md`** — architecture, auth flows, schema, phases.
- **`docs/go-live.md`** — deploying to a real environment (config, secrets, infra).
- **`CLAUDE.md`** — invariants and conventions to follow when contributing.
