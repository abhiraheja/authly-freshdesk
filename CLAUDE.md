# Trackly

Trackly is a standalone, multi-tenant ticket management SaaS (FreshDesk/Zendesk-like) that any organisation can adopt regardless of their identity infrastructure. Enterprises bring their own SSO (Okta, Google, Entra ID, Authly, custom SAML/OIDC) or use passwordless email magic links. Trackly owns its own users, roles, and sessions — external IdPs authenticate only.

## Source of truth

- **`docs/trackly-plan.md`** — the complete, reviewed design document: architecture, auth flows, full PostgreSQL schema, API endpoint list, email architecture (two inbound connector options), wireframes, implementation phases, and verification checklist. **Read it before designing or building anything.** If implementation needs to deviate from the plan, update the plan in the same change.
- **`docs/mockups/`** — 9 self-contained HTML mockups (open in a browser). These are the approved visual design. `index.html` is the gallery. Match their layout; styling is Material UI with the design tokens they demonstrate.

## Tech stack (decided — do not re-litigate)

- **Backend:** ASP.NET Core Web API (.NET 9+), EF Core, PostgreSQL (`trackly` DB)
- **Frontend:** React 18 + TypeScript + Vite, Material UI, TanStack Query, React Router v6, React Hook Form + Zod, Zustand
- **Auth:** Trackly's own HttpOnly session cookie (hash stored in `sessions` table). SSO via one generic OIDC scheme (per-workspace config resolved at request time — see plan caveat) + `ITfoxtec.Identity.Saml2` for SAML. Passwordless magic link + 6-digit code as native fallback. **No passwords, ever.**
- **Email:** MailKit (SMTP out, IMAP polling in) + inbound parse webhooks; both connectors feed one shared pipeline
- **Solution layout:** `src/Trackly.Core` (entities/interfaces), `src/Trackly.Modules` (business logic), `src/Trackly.Infrastructure` (EF, email, SSO handlers), `src/Trackly.Api` (controllers/middleware)

## Non-negotiable invariants

1. **Workspace isolation:** every query filters by `workspace_id`. No cross-workspace data access, ever.
2. **Roles live in Trackly's DB** (`users.role`), never derived from IdP tokens at request time. Group→role mapping is applied at login only.
3. **Secrets at rest** (SSO client secrets, SMTP/IMAP credentials, OAuth tokens) are AES-256-GCM encrypted.
4. **Tokens are stored hashed** (sessions, magic links, OTPs, invite tokens, guest magic links) — SHA-256, single-use where applicable.
5. **Private notes (`is_internal`)** must never reach customers or guest magic-link views — enforce in the API, not the UI.
6. **Customer-facing surfaces** (submit form, portal, widget, notification emails) render the **workspace's branding**, not Trackly's.
7. **Magic-link verify pages never consume the token on GET** — only the confirm POST does (email scanners prefetch GETs).

## Build order

Follow the **Implementation Phases** section at the end of `docs/trackly-plan.md` (Phase 1: scaffold + magic-link auth → Phase 2: core ticketing → Phase 3: guest flow + branding → Phase 4: email → Phase 5: SSO → Phase 6: problems/announcements/widget → Phase 7: SLA/KB/automation, AI copilot, omnichannel). Each phase is independently shippable; use the Verification Checklist as acceptance criteria.

## UI work

Read the **Design Direction (decided)** section of the plan before touching the frontend, and use the `trackly-ui` skill for component patterns. Two rules matter most: Material UI stays (the refreshed design was adopted, the framework was not), and Trackly surfaces get the Trackly palette plus dark mode while customer-facing surfaces get the workspace's brand and are always light.
