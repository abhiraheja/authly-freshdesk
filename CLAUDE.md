# Trackly

Trackly is a standalone, **self-hosted** ticket management app (FreshDesk/Zendesk-like) that any organisation can run on its own infrastructure, regardless of their identity infrastructure. Organisations bring their own SSO (Okta, Google, Entra ID, Authly, custom SAML/OIDC) or use passwordless email magic links. Trackly owns its own users, roles, and sessions — external IdPs authenticate only.

**One deployment, one workspace.** There is no public sign-up, no workspace picker and no domain verification: whoever runs the container owns it. An empty database is claimed once via `POST /api/setup`, which creates the workspace and its first admin and signs them in inline — it cannot email a link, because SMTP is configured from inside the admin UI.

## Source of truth

- **`docs/trackly-plan.md`** — the complete, reviewed design document: architecture, auth flows, full PostgreSQL schema, API endpoint list, email architecture (two inbound connector options), wireframes, implementation phases, and verification checklist. **Read it before designing or building anything.** If implementation needs to deviate from the plan, update the plan in the same change.
- **`docs/mockups/`** — 9 self-contained HTML mockups (open in a browser). These are the approved visual design. `index.html` is the gallery. Match their layout; styling is Material UI with the design tokens they demonstrate.
- **`docs/go-live.md`** — living deployment checklist. Whenever a change adds a config key, secret, external dependency, or a prod-only concern, record it there in the same change so nothing is missed when deploying to a new environment.
- **`docs/admin-guide.md`** — admin-facing handbook: every feature with what-it-is / setup / usage. When you add or change a user-visible feature or admin setting, update this in the same change so admins have an accurate reference.
- **`docs/dev-setup.md`** — first-time developer setup + everyday dev workflow + troubleshooting. Update it when the local-run steps, prerequisites, or common pitfalls change.

## Tech stack (decided — do not re-litigate)

- **Backend:** ASP.NET Core Web API (.NET 10), EF Core, PostgreSQL (`trackly` DB), SignalR (live-chat hub), Anthropic SDK (AI copilot)
- **Frontend:** Angular 22 + TypeScript + Vite (`@angular/build`), Tailwind v4 on a CSS-variable token layer, standalone components, signals + `resource()`, zoneless change detection. Lives in **`frontend-angular/`**.
  - **Migration in progress.** `frontend/` is the retiring React 19 + MUI app. Routes not yet ported render `ComingSoon`, which names the React file to port. Read `frontend/` for *behaviour*; never port its MUI markup. Delete each React screen in the same change that lands its Angular replacement. When `app.routes.ts` stops importing `ComingSoon`, delete `frontend/` and its `.vscode` entries.
  - No Angular Material, PrimeNG, or a second styling system — the design system is `src/styles.scss` (tokens + component CSS) plus thin wrappers in `src/app/ui/`.
- **Auth:** Trackly's own HttpOnly session cookie (hash stored in `sessions` table). SSO via one generic OIDC scheme (per-workspace config resolved at request time — see plan caveat) + `ITfoxtec.Identity.Saml2` for SAML. Passwordless magic link + 6-digit code as native fallback. **No passwords, ever.**
- **Email:** MailKit (SMTP out, IMAP polling in) + inbound parse webhooks; both connectors feed one shared pipeline
- **Solution layout:** `src/Trackly.Core` (entities/interfaces), `src/Trackly.Modules` (business logic), `src/Trackly.Infrastructure` (EF, email, SSO handlers), `src/Trackly.Api` (controllers/middleware)

## Non-negotiable invariants

1. **Workspace isolation:** every query filters by `workspace_id`. No cross-workspace data access, ever. This stands even though a deployment only ever has one workspace — the column is what makes the guarantee checkable, and removing it would rewrite every query for no user-visible gain. Surfaces with no session (guest views, chat, branding, widget, CSAT, SSO start) resolve it with `db.ResolveWorkspaceAsync(slug, ct)`, which falls back to the single workspace when no slug is supplied.
2. **Roles live in Trackly's DB** (`users.role`), never derived from IdP tokens at request time. Group→role mapping is applied at login only.
3. **Secrets at rest** (SSO client secrets, SMTP/IMAP credentials, OAuth tokens, messaging-connector signing secrets) are AES-256-GCM encrypted.
4. **Tokens are stored hashed** (sessions, magic links, OTPs, invite tokens, guest magic links, CSAT rating tokens, chat visitor tokens) — SHA-256, single-use where applicable.
5. **Private notes (`is_internal`)** must never reach customers, guest views, messaging connectors, or the AI model — enforce in the API, not the UI.
6. **Customer-facing surfaces** (submit form, portal, guest view, knowledge base, widget, live chat, CSAT survey, notification emails) render the **workspace's branding**, not Trackly's, and are always light.
7. **Magic-link verify pages never consume the token on GET** — only the confirm POST does (email scanners prefetch GETs).

## Build order

Follow the **Implementation Phases** section at the end of `docs/trackly-plan.md` (Phase 1: scaffold + magic-link auth → Phase 2: core ticketing → Phase 3: guest flow + branding → Phase 4: email → Phase 5: SSO → Phase 6: problems/announcements/widget → Phase 7: SLA/KB/automation, AI copilot, omnichannel). Each phase is independently shippable; use the Verification Checklist as acceptance criteria.

## UI work

Use the **`trackly-ui`** skill — it carries the whole design system (tokens, layout shell, component catalogue, page recipes) and is the authority for anything visual. Read the **Design Direction (decided)** section of the plan for the *why*.

Three rules matter most:
1. **Never interpolate a Tailwind class.** `'bg-' + tone` emits no CSS at all — v4 only sees literal strings. Use a static lookup or a design-system class. This is the most common bug in the codebase and it fails silently.
2. **Trackly surfaces** get the Trackly palette plus dark mode; **customer-facing surfaces** get the workspace's brand and are always light (invariant 6).
3. **Four states or it isn't done** — loading, empty (which kind?), error with retry, data.
