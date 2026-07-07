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
| `src/Trackly.Modules` | Business logic (auth, signup; tickets et al. in later phases) |
| `src/Trackly.Infrastructure` | EF Core DbContext + migrations, email senders |
| `src/Trackly.Api` | Controllers, session auth scheme, middleware |
| `frontend/` | React 18 + TypeScript + Vite SPA (Material UI, TanStack Query, Zustand) |

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

EF migrations:

```powershell
dotnet ef migrations add <Name> --project src/Trackly.Infrastructure --startup-project src/Trackly.Api --output-dir Data/Migrations
dotnet ef database update --project src/Trackly.Infrastructure --startup-project src/Trackly.Api
```

## Status

Phase 1 (foundation / walking skeleton) complete: solution scaffold, PostgreSQL schema for workspaces/users/sessions/email_tokens, passwordless magic-link + 6-digit-code auth, workspace signup with onboarding steps 1–2, session cookie auth, and placeholder dashboard/portal. Next: Phase 2 — core ticketing (see `docs/trackly-plan.md` → Implementation Phases).
