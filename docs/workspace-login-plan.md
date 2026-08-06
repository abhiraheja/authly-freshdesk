# Design Plan — Workspace-Scoped Login & SSO Discovery

**Status:** Proposed (for review)
**Date:** 2026-08-06
**Owner:** _unassigned_
**Audience:** Trackly engineers
**Related:** `docs/trackly-plan.md` (auth architecture), `docs/admin-guide.md` §3, `docs/go-live.md` §5–6

---

## 1. Summary (TL;DR)

Today the login page is global and **email-first**, and the only way to reach a
workspace's SSO is if the user's **email domain** is a verified, discoverable
domain for that workspace. Consumer emails (gmail, etc.) can therefore never see
SSO, and there is no first-class "log in to *this* workspace" entry point.

**Proposal:** add **path-based, workspace-scoped login** — `trackly.com/{workspace}`
(Azure-DevOps style, not subdomains) — that renders the workspace's branding and
**all of its enabled login methods** (SSO buttons + email). Keep the global
`/login` as a hub that discovers a user's workspace(s) and deep-links into them.
No subdomains, no wildcard TLS; the same-origin session cookie keeps working
unchanged.

---

## 2. Problem (current behaviour)

**As-is login flow**

```
/login (global, email-first)
   └─ user types email
        └─ GET /api/public/sso/discover?email=…
             ├─ looks up email DOMAIN in workspace_domains (verified && discoverable)
             │   └─ if that workspace has an active SSO connection → hand off to IdP
             └─ else 204 → magic-link (send code → verify)
                  └─ verify can return choose_workspace when the email
                     belongs to multiple workspaces (chooser already supported)
```

**Two concrete gaps (both hit in testing):**

1. **SSO is unreachable for non-corporate emails.** Discovery keys on the email
   **domain** being verified for the workspace. You can't verify DNS TXT on
   `gmail.com`, so a gmail user in an SSO-enabled workspace only ever sees email
   login. There is **no explicit path** to a workspace's SSO.
2. **No workspace-scoped entry point.** A workspace admin has no shareable link
   that lands a user on *their* branded login showing *their* SSO options. (The
   multi-workspace membership case — one email in two workspaces — is handled
   only *after* email verification, via the chooser.)

**Relevant code today**
- `PublicSsoController.Discover` — domain-based SSO discovery (the choke point).
- `AuthController` — `magic-link/send`, `magic-link/verify` (verify already emits
  `choose_workspace` + a `workspaces` list).
- `GET /api/auth/sso?workspace={slug}` — existing SSO **start** endpoint.
- `workspaces.email_login_enabled`, `sso_connections` (per workspace), branding —
  all the data we need already exists.

---

## 3. Goals / Non-goals

**Goals**
- A shareable, brandable **per-workspace login URL** that shows SSO + email.
- Make **SSO reachable regardless of email domain**.
- Keep the multi-workspace case graceful.
- Zero new infrastructure (no wildcard DNS/TLS, no CORS, no cookie changes).

**Non-goals (out of scope for this plan)**
- Subdomain tenancy (`{slug}.trackly.com`).
- Changing the SSO protocols themselves (OIDC/SAML handlers stay as-is).
- Customer (end-user) portal auth changes — customers already arrive via branded
  `?workspace=slug` links; this plan is about the **agent/admin + SSO** entry.

---

## 4. Decision: path-based URLs, not subdomains

Recommend **`trackly.com/{workspace}`**.

| Concern | Path `trackly.com/{slug}` | Subdomain `{slug}.trackly.com` |
|---|---|---|
| Session cookie | Same-origin; current `SameSite=Strict; Path=/` cookie works unchanged | Cross-subdomain scoping, fragile |
| TLS / DNS | One cert, one host | **Wildcard cert + wildcard DNS** required |
| Local dev | `localhost:5173/acme` — trivial | `*.localhost` / hosts entries |
| CORS | None | Likely required |
| Effort / infra | Low | High |

Subdomains were only ever aspirational in `trackly-plan.md`; nothing implements
them. Path-based preserves the same-origin guarantee the whole auth design relies
on.

---

## 5. Proposed UX

**New: workspace login page** — `GET /{workspace}` in the SPA

```
trackly.com/acme
  ┌───────────────────────────────┐
  │  [Acme logo]  Acme Support     │   ← workspace branding
  │                                │
  │  [ Continue with Okta    ]     │   ← one button per active SSO connection
  │  [ Continue with Google  ]     │
  │  ───────────  or  ───────────  │
  │  Email:  [__________________]  │   ← magic-link, scoped to this workspace
  │          [ Send sign-in code ] │      (hidden if email_login_enabled = false)
  └───────────────────────────────┘
```

- Unknown slug → a clean "workspace not found" page.
- If `email_login_enabled = false` and there are SSO connections → SSO-only.
- If a workspace has **no** SSO and email is enabled → just the email form
  (same as today, but branded and scoped).

**Global `/login` becomes a hub**
- Enter email → `discover` (unchanged accelerator for corporate domains).
- On magic-link verify returning `choose_workspace`, render a **workspace
  chooser** (already have the `workspaces` list) whose entries link to
  `/{slug}`.
- This keeps a "I don't know my workspace URL" path working.

---

## 6. API changes

**New endpoint — public workspace login config**

```
GET /api/public/workspaces/{slug}/login   → 200 | 404
{
  "workspaceName": "Acme",
  "branding": { "logoUrl": "...", "primaryColor": "#4F46E5", "pageTitle": "Acme Support" },
  "emailLoginEnabled": true,
  "ssoConnections": [
    { "providerName": "Okta",  "protocol": "oidc", "startUrl": "/api/auth/sso?workspace=acme&connection=<id>" }
  ]
}
```
- Anonymous, rate-limited (`auth` policy).
- `ssoConnections` = active connections only (`Status != Error`).
- **Implementation note:** the existing start endpoint is
  `/api/auth/sso?workspace={slug}`. If a workspace can have **multiple** SSO
  connections, the start endpoint must select one — add `&connection={id}` and
  have `SsoController` resolve by it. Confirm/adjust during implementation.

**Reused, unchanged**
- `GET /api/auth/sso?workspace={slug}[&connection=…]` — SSO start.
- `POST /api/auth/magic-link/send` / `verify` — email path (already accept a
  `workspaceSlug`).
- `GET /api/public/sso/discover` — kept as the corporate-email accelerator on the
  global hub.

---

## 7. Frontend changes

- **New page** `WorkspaceLoginPage` at route `/:workspaceSlug`:
  - fetch `/api/public/workspaces/{slug}/login`;
  - render branding + SSO buttons (link to each `startUrl`) + branded email form;
  - reuse the existing magic-link components, passing `workspaceSlug`.
- **Router** (`App.tsx`): add `/:workspaceSlug` **after** all known routes and
  **before** the catch-all. Today the catch-all is `* → /dashboard`; change it so
  an unknown top-level segment resolves to the workspace page (which itself 404s
  if the slug doesn't exist), and only truly-authenticated no-match falls through
  to `/dashboard`.
- **Global `/login`**: on `choose_workspace`, show the chooser linking to
  `/{slug}`; otherwise unchanged.

---

## 8. Slug reservation (important for top-level `/{slug}`)

Top-level `/{slug}` collides with app routes, so the **reserved-slug list must
cover every top-level route**. Current list (in `AuthService`) is incomplete:

```
present:  www app api admin auth login signup support trackly
MISSING:  dashboard portal submit kb chat csat tickets invite onboarding
          hubs widget assets static
```

- **Extend `ReservedSlugs`** to the full set and keep it the single source of
  truth; signup already validates against it (`SignupStatus.InvalidSlug`).
- **Migration check:** query existing workspaces for any slug now in the reserved
  set (unlikely — they're dictionary words and slugs are user-chosen). If any
  exist, decide (rename vs grandfather) before enabling top-level routing.
- Slug format is already constrained: `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$`
  (3–30 chars, lowercase alnum + hyphens).

> Alternative that removes the collision problem entirely: namespace under a
> prefix (`/w/{slug}` or `/login/{slug}`). See Open Decisions.

---

## 9. Security & invariants

- **No account enumeration.** `/api/public/workspaces/{slug}/login` reveals only
  that a workspace slug exists and its **public** branding + which login methods
  are on — no user data. Same exposure as the existing public branding endpoint.
  Rate-limit it.
- **Roles still come from Trackly, at login only** (invariant 2) — unchanged.
- **Tokens hashed, secrets encrypted** — unchanged; we surface only provider
  *names*, never client secrets.
- **Customer-facing branding** on the workspace login page (invariant 6) — it is a
  customer-adjacent surface: workspace brand, always light.
- Magic-link scoping to `{slug}` narrows, never widens, access.

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Slug doesn't exist | Branded-neutral "workspace not found" page (404 from the config endpoint) |
| Email in 2 workspaces, user hits global `/login` | Verify → `choose_workspace` → chooser → deep-link to `/{slug}` |
| Email not a member of `{slug}` but user opens `/{slug}` and requests a code | Same as today: magic-link send scoped to that workspace fails/には no membership → generic "check your email"; verify won't issue a session for a non-member. (Confirm current `send` behaviour for unknown email.) |
| `email_login_enabled = false`, no SSO | Login page explains no methods are enabled (shouldn't happen; guard at settings) |
| Multiple SSO connections | One button each; start endpoint selects by `connection` id (§6) |
| Existing branded links `?workspace=slug` (submit/portal/invite) | Keep working — this plan is additive; `/login?workspace=slug` still supported |

---

## 11. Backward compatibility

- Existing `?workspace=slug` query-scoped links (customer submit/portal/invite,
  branded magic links) **continue to work** — nothing removed.
- The global `/login` still functions for people without a workspace URL.
- Domain-based auto-discovery stays as an accelerator.
- No DB schema change required (only extending the reserved-slug constant).

---

## 12. Implementation slices (each shippable + verifiable)

1. **Backend — login config endpoint.** `GET /api/public/workspaces/{slug}/login`
   + (if needed) `&connection=` support in `SsoController`. Verify script:
   config returns branding + methods; 404 on unknown slug.
2. **Reserved slugs.** Extend `ReservedSlugs`, add the migration check. Test:
   signup rejects each reserved slug.
3. **Frontend — workspace login page + routing.** `/:workspaceSlug` page, SSO
   buttons, branded email form, not-found state; adjust catch-all.
4. **Global hub — workspace chooser.** Render `choose_workspace` as links into
   `/{slug}`.
5. **Docs.** admin-guide ("share your login link `trackly.com/{slug}`"),
   trackly-plan (login-flow section), go-live if any routing note.

Ship 1–2 first (no user-visible change), then 3–4 together.

---

## 13. Test plan

- Unit/integration: config endpoint (present/absent SSO, email on/off, unknown
  slug); reserved-slug rejection at signup.
- Manual: gmail account in an SSO-enabled workspace → `/{slug}` shows the SSO
  button and completes SSO; email-in-two-workspaces → global `/login` chooser →
  correct workspace.
- Add `scripts/verify-workspace-login.ps1` covering the config endpoint + reserved
  slugs (SSO round-trip stays manual — needs a real IdP).

---

## 14. Docs to update on delivery

- `docs/admin-guide.md` §3 — "Your workspace login link is `trackly.com/{slug}`;
  share it with your team."
- `docs/trackly-plan.md` — replace/annotate the login-flow section to describe
  workspace-scoped entry (supersedes the `acme.trackly.com` aside).
- `docs/go-live.md` — note the reserved-slug requirement and that `/{slug}` is
  same-origin (no new infra).

---

## 15. Open decisions (need a call before slice 3)

1. **URL shape** — top-level `trackly.com/{slug}` (needs the extended reserved
   list) vs a prefix `trackly.com/w/{slug}` or `/login/{slug}` (collision-proof,
   no denylist). **Recommendation: top-level `/{slug}`** — best UX, and the
   reserved list is cheap and already exists.
2. **Global `/login` role** — keep it as the default email-first hub (recommended)
   vs make per-workspace URLs primary and `/login` a thin fallback.
3. **Multiple SSO connections per workspace** — list all active as separate
   buttons (recommended). Confirms whether the start endpoint needs `connection`.

_Current recommendation baked into this plan: top-level `/{slug}`, keep `/login`
as the hub, list all active SSO connections._
