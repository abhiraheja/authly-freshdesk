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
| `src/` | (to be created) .NET solution: Core / Modules / Infrastructure / Api |
| `web/` | (to be created) React + Vite frontend |

## Tech stack

ASP.NET Core (.NET 9+) · EF Core · PostgreSQL · React 18 + TypeScript + Vite · Material UI · MailKit

## Status

Design phase complete. Implementation starts with Phase 1 (see `docs/trackly-plan.md` → Implementation Phases).
