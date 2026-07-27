# Trackly

A standalone, multi-tenant ticket management SaaS — submit, track, and resolve customer support tickets with a fully branded customer portal, agent workspace, and bring-your-own-SSO authentication.

## Key capabilities

- **Multi-IdP authentication** — each workspace connects its own identity provider (Okta, Google Workspace, Microsoft Entra ID, Authly, custom SAML/OIDC) or uses passwordless email magic links. No passwords stored, ever.
- **Ticketing** — round-robin assignment, watchers, private internal notes, problem grouping, categories, priorities.
- **Email** — outbound notifications plus two-way email threading via either an inbound parse webhook (MX record) or polling an existing support mailbox (IMAP / Microsoft Graph / Gmail API).
- **Customer surfaces in *your* brand** — branded submit form, customer portal, embeddable widget, and guest submissions verified by one-time codes with magic-link tracking.
- **Workspace admin** — SSO wizard with group→role mapping, domain verification, branding editor, user/role management, outage announcements.

## Repository layout

| Path | Contents |
|------|----------|
| `CLAUDE.md` | Working agreement + invariants for AI-assisted development |
| `docs/trackly-plan.md` | Complete design document (architecture, schema, API, phases) |
| `docs/mockups/` | Approved HTML design mockups — open `index.html` in a browser |
| `src/Trackly.Core` | Entities, interfaces, enums |
| `src/Trackly.Modules` | Business logic — auth, tickets, guest flow, email, SSO, problems, KB, SLA, automation |
| `src/Trackly.Infrastructure` | EF Core DbContext + migrations, email (SMTP/IMAP), storage, crypto, OIDC/DNS |
| `src/Trackly.Api` | Controllers, session auth scheme, background workers, middleware |
| `frontend/` | React 18 + TypeScript + Vite SPA (Material UI, TanStack Query, Zustand) |
| `scripts/` | Per-phase PowerShell verification suites + demo-data seeder |

## Tech stack

ASP.NET Core (.NET 10) · EF Core · PostgreSQL · React 18 + TypeScript + Vite · Material UI · MailKit

## Running locally

Prerequisites: .NET 10 SDK, Node 20+, Docker Desktop.

```powershell
# 1. Database
docker compose up -d          # PostgreSQL 16 on localhost:5432 (trackly/trackly)

# 2. API — http://localhost:5210 (applies EF migrations on startup in Development)
dotnet run --project src/Trackly.Api --urls http://localhost:5210

# 3. Frontend — http://localhost:5173 (proxies /api to :5210)
cd frontend
npm install
npm run dev
```

`src/Trackly.Api/appsettings.Development.json` is gitignored. On a fresh clone, create it with:

```json
{
  "ConnectionStrings": {
    "Trackly": "Host=localhost;Port=5432;Database=trackly;Username=trackly;Password=trackly"
  },
  "App": { "FrontendBaseUrl": "http://localhost:5173" }
}
```

With no SMTP configured (`Email:Smtp:Host` empty), sign-in emails are written to the API console log — grab the magic link or 6-digit code from there.

### Demo data (Development only)

To fill a freshly-created workspace with realistic sample data (agents, customers, ~10 tickets across statuses/priorities with SLA countdowns, a problem, tags, a team, SLA policies, KB articles, canned responses, an automation rule, a draft announcement):

- **From the browser** — sign in as your workspace admin, open devtools (F12), and run:
  ```js
  fetch('/api/dev/seed', { method: 'POST' }).then(r => r.json()).then(console.log)
  ```
- **Or from a terminal:** `powershell -File .\scripts\seed-demo.ps1 -AdminEmail <your-admin-email>`

It's one-time (refuses if the workspace already has tickets) and the endpoint (`POST /api/dev/seed`) 404s outside Development.

### Verification scripts

Each phase has a PowerShell suite in `scripts/` that drives the running API and asserts behaviour (`verify-phase4.ps1` … `verify-phase7a.ps1`). Run one against a live API, e.g. `powershell -File .\scripts\verify-phase7a.ps1 -AdminEmail <email>`. SSO/SAML need a real IdP and aren't fully automatable.

EF migrations:

```powershell
dotnet ef migrations add <Name> --project src/Trackly.Infrastructure --startup-project src/Trackly.Api --output-dir Data/Migrations
dotnet ef database update --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
```

## Status

Phases 1–6, 7A and 7B complete (see `docs/trackly-plan.md` → Implementation Phases):

- **1 — Foundation:** scaffold, magic-link + 6-digit auth, workspace signup, session cookies.
- **2 — Ticketing:** tickets/comments/categories/attachments, private notes, round-robin, watchers, customer portal + three-pane agent workspace.
- **3 — Guest flow + branding:** OTP guest submission, magic-link tracking, workspace branding, invitations.
- **4 — Email:** outbound notifications, inbound parse webhook + IMAP polling, encrypted secrets, admin email settings.
- **5 — SSO:** per-workspace OIDC (auth-code + PKCE) and SAML, JIT provisioning + group→role mapping, domain verification + login-page routing.
- **6 — Problems, announcements, embeddable widget, dashboard stats.**
- **7A — Service desk fundamentals:** tags, teams (team round-robin), SLA policies with live countdown, knowledge base + submit-form deflection, canned responses, automation rules.
- **7B — AI copilot (Claude API):** agent-reviewed reply drafting, thread summarization, triage suggestions (priority/category/tags/sentiment), and KB-article drafting from resolved tickets. Per-workspace toggle + deployment key both required; private notes and other workspaces' data are never sent to the model.

Next: **Phase 7C** — omnichannel & analytics (live chat, WhatsApp/Slack/Teams, CSAT, reporting). `docs/go-live.md` is the living deployment checklist; set `Ai:ApiKey` to enable the copilot.
