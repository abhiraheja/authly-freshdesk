# Embeddable widget — design plan

Turning the Phase-6 widget stub into a real embedded support surface: a
script-tag snippet with a public widget token, per-page config overrides,
identity that produces a **contact record**, and a conversation list so a visitor
can read every ticket they have raised without leaving the host page.

> **Working document.** Fold the settled parts into `docs/trackly-plan.md`
> (§ Embeddable Widget & Integration Options) as each phase lands, then delete
> this file — the same lifecycle `docs/email-providers-plan.md` and
> `docs/email-templates-plan.md` have.

---

## 1. Why

The widget today embeds the OTP-gated guest form in an iframe and stops there.
Concretely, what an operator gets:

- **One widget per install.** `widget_configs` is `UNIQUE(workspace_id)`. There
  is no way to run a staging widget beside a production one, or a different
  greeting on the pricing page than in the logged-in app.
- **A hardcoded launcher.** The injected button is `#4F46E5` with the label
  "Support" — not the workspace's brand colour, which every other
  customer-facing surface honours (invariant 6).
- **No config from the host page.** Everything is a `data-*` attribute the admin
  bakes into one snippet. The embedding site cannot say "this user is already
  signed in, their name is Alice" or "open the panel automatically on this page".
- **No contact.** Guest tickets set `guest_email`/`guest_name` strings and leave
  `requester_id` **null**. The Customer Detail screen, the "previous tickets"
  panel and every per-customer report see nothing at all from widget traffic.
- **No history.** One form, one ticket, the flow ends. A visitor who wants to
  know what happened to yesterday's request has to find the emailed magic link.
- **Friction on the first message.** `/submit` requires an emailed six-digit code
  before the ticket exists. Correct for an anonymous public form on the open
  internet; wrong for a widget embedded inside an app where the operator already
  knows who the user is.

The attached screenshots (MSG91's Hello widget — a different product) show the
shape that solves this: a **Configuration / Integration** tab pair, a generated
`initChatWidget(helloConfig, 0)` snippet with commented override keys, an
identity-verification secret with regenerate + "Verify JWT", and a details form
with a **Skip** for visitors the host page could not identify.

---

## 2. What exists today

Grounding, so the plan is measured against the real code.

| Piece | File | State |
|---|---|---|
| Entity | `src/Trackly.Core/Entities/WidgetConfig.cs` | `EmbedType`, `Fields` (JSON string), `Theme`. One row per workspace |
| Mapping | `TracklyDbContext.cs:764` | `ToTable("widget_configs")`, `HasIndex(WorkspaceId).IsUnique()` |
| Table | `20260810051542_InitialCreate.cs:578` | `id, workspace_id, embed_type, fields, theme, created_at, updated_at` |
| Admin API | `WidgetController.Get/Save` | `GET`/`PUT /api/admin/widget`, `Admin` policy, returns the snippet string |
| Public API | `WidgetController.PublicConfig` | `GET /api/public/workspaces/{slug}/widget` — embed type, fields, theme |
| Loader | `WidgetController.WidgetJs` | ~35 lines inlined as a C# raw string constant. Reads `data-*`, injects a fixed-colour button + iframe at `/submit?workspace=…&embed=1` |
| Loader route | `GET /widget.js` | Site root, `Cache-Control: public, max-age=300` |
| nginx | `frontend-angular/nginx/default.conf.template:105` | `location = /widget.js` proxies to the API. **No `X-Frame-Options` / `frame-ancestors` anywhere, deliberately** (comment at :51) |
| Guest flow | `src/Trackly.Modules/Guest/GuestService.cs` | OTP → 30-min `guest_submit` token → ticket with `guest_*` columns + hashed magic-link token |
| Guest API | `GuestController` | `/api/guest/otp/*`, `/api/tickets/guest[/{id}][/comments][/attachments]` |
| Branding | `BrandingController.GetPublic` | public + cached; name, logo URL, `primaryColor`, `pageTitle`, `welcomeText`, `footerText`, `hidePoweredBy`, categories |
| Live chat | `ChatService`, `PublicChatController`, `src/Trackly.Api/Chat/ChatHub.cs` | Anonymous session + hashed visitor token, SignalR groups `SessionGroup(id)` / `Lobby(workspaceId)`, transcript filed as a ticket on end |
| Channel | `Ticket.cs:181` `TicketChannel.Widget` | **Constant exists; nothing ever sets it** |
| Contacts | `User.cs` | `Role = customer`, `Phone`, `Company`, `Location`, `CustomFields` (schemaless dictionary) — everything a widget contact needs already |
| Admin UI (Angular) | `admin.routes.ts:71` | `ComingSoon`, `from: frontend/src/pages/admin/WidgetPage.tsx` |
| Admin UI (React) | `frontend/src/pages/admin/WidgetPage.tsx` | 106 lines: embed-type select, theme select, four field checkboxes, snippet + copy |
| Customer UI (Angular) | `guest.routes.ts` | `/submit`, `/chat`, `/tickets/:id` are **all `ComingSoon`** |

The iframe target the widget uses (`/submit`) is therefore **not ported yet**.
That is not a blocker: § 7 gives the widget its own Angular route rather than
reusing the submit screen, so this work does not wait on the submit-page port.

---

## 3. What MSG91 is actually doing

Three ideas in the reference snippet, in the order they matter.

### 3.1 A widget is an object, not a workspace setting

```js
widgetToken: "017a4"
```

A short, **public** identifier for one named widget — "DEVELOPMENT", tagline
"TestingTag", an assigned team, a theme colour. Several can exist per account.
Trackly's `UNIQUE(workspace_id)` makes that impossible today.

Public is the operative word: the token sits in the page source of every site
that embeds it. It identifies, it does not authorise.

### 3.2 Config is layered

Admin sets defaults in the Configuration tab; the host page overrides per page:

```js
hide_launcher: false,     // override default widget hide launcher settings
show_widget_form: true,   // override default widget show client form settings
show_close_button: true,
launch_widget: true,
show_send_button: true,
theme: "system",
```

Identity rides in the same object — `unique_id`, `name`, `mail`, `number` — and
when it is absent the widget shows the "Enter your details" form (screenshot 2:
Name required, Email, Phone with country code, **Skip** / **Submit**).
`variables: {}` is a free-form bag stashed against the contact.

### 3.3 Identity verification is the security hinge

The Configuration tab carries a **Secret Key**, **Regenerate Secret Key** and
**Verify JWT**. That block exists precisely *because* `widgetToken` is public. If
the widget will show "here is everything you have ever raised", a typed-in email
address cannot be what unlocks it. The host page signs a JWT with the secret,
proving "this browser really is `unique_id=alice@acme.com`".

**This is the one decision everything else hangs off**, so it is stated here as a
rule the implementation must uphold:

> **Trust rule.** An **unverified** visitor sees only the conversations created
> from their own browser session, matched by a hashed visitor token. A
> **verified** visitor — JWT-signed identity, or a completed email OTP — sees
> every conversation belonging to that contact. An email typed into a form is
> *claimed*, never *proven*.

Without it, "see all my tickets in the widget" is a data-leak endpoint: type
`ceo@theircompany.com`, read their support history. It is the widget's
equivalent of invariant 5 — enforce it in the API, never in the UI.

---

## 4. Design decisions

All settled. Nothing here is open.

### 4.1 The four that were decided in review

1. **"Theme" means the brand colour, and the panel is always light.** The
   Configuration tab's Widget Theme is a colour picker (`#1c65d4 Strong blue`),
   not a light/dark switch. **Invariant 6 stands unamended.** The snippet's
   `theme: "light" | "dark" | "system"` key is parsed and ignored — it exists so
   a snippet copied from another vendor's docs does not throw. Do not add a dark
   palette to the widget without revisiting invariant 6 for the portal, guest
   view, KB and CSAT at the same time.

2. **A widget thread is a ticket thread.** Comments on a ticket, not a
   `chat_session`. "See every ticket I raised" is then one query rather than a
   union across two histories, and every existing agent tool — assignment, SLA,
   automation, canned responses, CSAT — works on a widget conversation with no
   new code. Live chat stays where it is; escalating a widget thread into one is
   a later, optional step.

3. **No OTP on the first widget message.** Off by default, with an admin toggle
   *"Require email verification for widget tickets"*. An unverified email is
   stored and flagged as such on the ticket, and the trust rule (§ 3.3) is what
   keeps it from unlocking anything. `/submit` keeps its OTP unchanged — same
   product, different exposure: an open form on the public internet is not an
   embed inside an app that already knows its user.

4. **Branding merges into the widget screen, but not into the widget record.**
   The planned `/admin/settings/branding` screen — still a `ComingSoon`, never
   built — is dropped, and its fields are edited from a **Branding** block on the
   widget screen instead. See § 4.2, because *which* fields move is the part that
   matters.

### 4.2 Where branding lives after the merge

`workspace_branding` is **not** retired. It feeds the login page, `/submit`,
`/portal`, the KB, the guest ticket view, CSAT, and — through
`src/Trackly.Modules/Email/EmailBrandResolver.cs` — the header of every outbound
email. None of those surfaces has a widget token to resolve, so per-widget
branding would need a "which widget brands the emails?" concept, which is a
worse answer than the one screen it saves.

| Field | Lives on | Why |
|---|---|---|
| Logo | `workspace_branding` | One organisation, one logo. Emails need it with no widget in sight |
| Footer text, Hide "Powered by" | `workspace_branding` | Same reason |
| Page title, welcome text | `workspace_branding` | They belong to `/submit` and `/portal`, not the widget |
| **Primary colour** | `workspace_branding`, **overridable per widget** | The organisation has a colour; a given widget may want another (`primary_color NULL` ⇒ inherit) |
| Name, tagline, greeting | `widget_configs` only | Per-widget by nature — "DEVELOPMENT" / "TestingTag" in the screenshot |

So: **one screen, two records.** The widget screen's Branding block writes
`workspace_branding` and says so in a line of help text, because an admin editing
a logo there is editing something their emails will wear. Everything else on the
screen writes the widget row.

The `/admin/settings/branding` route is removed from `admin.routes.ts` and its
nav entry from `nav.ts`; `frontend/src/pages/admin/BrandingSettingsPage.tsx` is
never ported. `BrandingController`'s endpoints are untouched — only the screen
moves.

### 4.3 Settled from the outset

- **Keep the table name `widget_configs`** and the entity name `WidgetConfig`.
  The shape changes; renaming as well buys clarity that is not worth a rename
  migration across the snapshot, the designer file and every query.
- **Keep serving the loader from `GET /widget.js`.** nginx, `docs/go-live.md`
  and every snippet already in the wild point at it. Its *contents* are rewritten
  from a C# constant into a real asset; the route does not move.
- **Same-origin iframe, not inline DOM.** The widget must not inherit the host
  page's CSS, and the host page must not be able to read the visitor's
  conversation. An iframe on Trackly's own origin gives both for free and keeps
  the session cookie story unchanged.
- **Config crosses by `postMessage`, not query string.** `variables` can be
  large, and an identity JWT must never land in a URL, a `Referer` header or an
  access log. The loader hands config to the frame after a `ready` handshake.
- **Contacts are `users` rows with `role = customer`.** No new contact table:
  `User` already carries `Phone`, `Company`, `Location` and schemaless
  `CustomFields`, and the Customer Detail screen already reads them.
- **Every widget ticket sets `Channel = TicketChannel.Widget`.** The constant has
  been waiting since Phase 6; automation, SLA and reporting then treat widget
  traffic as its own channel with no further work.
- **Skip "widget-to-widget communication"** (the last toggle in screenshot 3).
  No use case in Trackly.

---

## 5. Data model

### 5.1 `widget_configs`, reshaped

```sql
ALTER TABLE widget_configs
  DROP CONSTRAINT ix_widget_configs_workspace_id,     -- the UNIQUE index
  ADD COLUMN name                          TEXT    NOT NULL DEFAULT 'Support',
  ADD COLUMN tagline                       TEXT,
  ADD COLUMN greeting                      TEXT,     -- "Hi there!"
  ADD COLUMN public_token                  TEXT    NOT NULL,   -- short, public
  ADD COLUMN secret_key_encrypted          TEXT,               -- AES-256-GCM
  ADD COLUMN identity_verification_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN primary_color                 TEXT,     -- null = workspace branding
  ADD COLUMN team_id                       UUID REFERENCES teams(id),
  ADD COLUMN hide_launcher                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN launch_widget                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN show_widget_form              BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_close_button             BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_send_button              BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN require_email_verification    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN allowed_origins               TEXT,     -- newline-separated; empty = any
  ADD COLUMN is_active                     BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX ix_widget_configs_public_token ON widget_configs (public_token);
CREATE INDEX        ix_widget_configs_workspace_id ON widget_configs (workspace_id);
```

`embed_type`, `fields` and `theme` stay for now — `embed_type` still drives the
Integration tab's snippet flavour (floating / inline / link).

**Backfill:** the migration generates a `public_token` for the existing row and
names it after the workspace, so an install that already pasted the old snippet
keeps working (the loader continues to accept `data-workspace`, § 7.3).

`public_token`: 12 chars, `TokenUtils.GenerateShortToken`, URL-safe. Not a secret
— unguessability buys nothing when the token is in page source — but short
enough to read out loud, as MSG91's `"017a4"` is, so the alphabet drops `0`,
`1`, `i`, `l` and `o`.

There is deliberately **no `last_used_at` column**, though § 8.2's list screen
shows one: it is `MAX(widget_visitors.last_seen_at)` instead. Storing it would
mean a write on every public config read, which is the hottest path this
feature has.

`secret_key_encrypted`: AES-256-GCM at rest (invariant 3), returned in plaintext
**once** on create/regenerate and masked (`UHVV…zHZQ`) thereafter, exactly as
screenshot 3 shows.

### 5.2 `widget_visitors` — new

```sql
CREATE TABLE widget_visitors (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    widget_id          UUID NOT NULL REFERENCES widget_configs(id) ON DELETE CASCADE,
    visitor_token_hash TEXT NOT NULL,          -- SHA-256, invariant 4
    user_id            UUID REFERENCES users(id),   -- the contact, once known
    external_id        TEXT,                   -- the host app's unique_id
    is_verified        BOOLEAN NOT NULL DEFAULT false,
    variables          JSONB NOT NULL DEFAULT '{}',
    name               TEXT,                   -- claimed, never a contact record
    email              TEXT,
    phone              TEXT,
    created_at         TIMESTAMPTZ DEFAULT now(),
    last_seen_at       TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ix_widget_visitors_token ON widget_visitors (visitor_token_hash);
CREATE INDEX ix_widget_visitors_widget_external ON widget_visitors (widget_id, external_id);
CREATE INDEX ix_widget_visitors_user ON widget_visitors (workspace_id, user_id);
```

`workspace_id` is denormalised from `widget_id` on purpose: invariant 1 says
every query filters by it, and a visitor lookup that had to join to get there
would be the one query that quietly does not.

**`name` / `email` / `phone` were added in phase 2** — the original sketch had
nowhere to put what the details form collects. They are deliberately *not*
written to a `users` row: until `is_verified` they are claims, and a claim in
the contact table is indistinguishable from a fact. They are what fills a
ticket's `guest_name` / `guest_email`, exactly as the guest form's would.

`visitor_token_hash` is the SHA-256 of a **server-issued** token, not of a
client-chosen id. § 6.2 lists a `visitorId` in the session body; that would be
worth nothing as a credential, since anyone could send someone else's. The frame
stores what the server minted and returns it in `X-Trackly-Visitor`.

### 5.3 `widget_conversation_reads` — new

```sql
CREATE TABLE widget_conversation_reads (
    visitor_id   UUID NOT NULL REFERENCES widget_visitors(id) ON DELETE CASCADE,
    ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (visitor_id, ticket_id)
);
```

Per **visitor**, not per ticket: the same verified contact on a laptop and a
phone carries its own unread count on each. `unreadCount` for a row is then
`COUNT(comments WHERE !is_internal AND author IS agent AND created_at > last_read_at)`
— derived, so nothing can drift out of step with the thread it describes.

"Author is agent" is `role != customer`, decided when phase 3 landed. `author_id
IS NOT NULL` looks equivalent and is not: a customer replying through the portal
has an author row too, and that reading would count someone's own message as
unread on their own thread. A null author is a guest or an inbound email, never
an agent.

### 5.4 `tickets` — one column

```sql
ALTER TABLE tickets ADD COLUMN widget_visitor_id UUID REFERENCES widget_visitors(id) ON DELETE SET NULL;
CREATE INDEX ix_tickets_widget_visitor ON tickets (widget_visitor_id) WHERE widget_visitor_id IS NOT NULL;
```

This is what makes the trust rule enforceable: the unverified half of § 3.3 is
`WHERE widget_visitor_id = @me`, not `WHERE guest_email = @claimed`.

`ON DELETE SET NULL` is the delete path for the screen's **Delete Widget**
button, decided when phase 1 landed. The widget cascades to its visitors and
each of their tickets stays in the queue as an ordinary ticket that nobody can
claim. `RESTRICT` would make a widget undeletable the moment anyone used it;
`CASCADE` would delete real support history to tidy up a config row.

---

## 6. API

### 6.1 Admin (`Admin` policy, workspace-scoped)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/widgets` | List. Never returns secrets |
| POST | `/api/admin/widgets` | Create. Returns the secret **once** |
| GET | `/api/admin/widgets/{id}` | Detail + generated snippet |
| PUT | `/api/admin/widgets/{id}` | Update |
| DELETE | `/api/admin/widgets/{id}` | The "Delete Widget" action |
| POST | `/api/admin/widgets/{id}/secret` | Regenerate. Returns the new secret once |
| POST | `/api/admin/widgets/{id}/verify-jwt` | The "Verify JWT" debug link — takes a JWT, says whether it validates and what claims it carries |

`GET/PUT /api/admin/widget` (singular) stays as a thin shim over the first widget
for one release so the React screen does not break mid-migration, then goes.

### 6.2 Public (anonymous, rate-limited with the existing `"auth"` policy)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/widget/{token}/config` | Branding + launch defaults + which identity fields to ask for. `Origin`-checked (§ 9.2). `private, max-age=60` + `Vary: Origin` — a shared cache keyed on the URL alone would hand one site another site's answer |
| POST | `/api/public/widget/{token}/session` | Optional `unique_id`/`name`/`mail`/`number`/`variables`, optional signed `token`. Mints and returns the visitor token, or resumes the one in `X-Trackly-Visitor` |
| PATCH | `/api/public/widget/{token}/session` | The details form's Submit — same upsert, mid-session |
| POST | `/api/public/widget/{token}/session/verify-email` | Emails a six-digit code. **Added in phase 2** |
| POST | `/api/public/widget/{token}/session/verify-email/confirm` | Confirms it, which is the *only* other way to reach verified. **Added in phase 2** |
| GET | `/api/public/widget/{token}/conversations` | Scoped by the trust rule. Open threads always; resolved/closed only from the last 30 days. Each row carries `unreadCount`, the last sender's name and a message preview |
| POST | `/api/public/widget/{token}/conversations` | Creates a ticket, `Channel = widget`. Called by the **first send**, not by opening the new-conversation view |
| GET | `/api/public/widget/{token}/conversations/{id}` | Thread. `is_internal` comments excluded (invariant 5) |
| POST | `/api/public/widget/{token}/conversations/{id}/messages` | Reply |
| POST | `/api/public/widget/{token}/conversations/{id}/read` | Read receipt — stamps `last_read_at`, clearing the badge |
| POST | `/api/public/widget/{token}/conversations/{id}/attachments` | Existing `AttachmentService` limits |
| GET | `/api/public/widget/{token}/conversations/{id}/attachments/{attachmentId}` | **Added in phase 3** — the table above could upload a file and never show one back, including the agent's. Scoped like everything else here, and a file on an internal note is a 404 |

Real-time is a second SignalR hub, **`/hubs/widget`**, joined with
`?widget={publicToken}&visitorToken=…` — the same two credentials the REST
surface uses. One group per **visitor row**, so two devices are two groups. It
carries `conversation` with nothing but a `conversationId`: the panel re-fetches
through the endpoints above, which is where the trust rule and the private-note
filter already live, so nothing can leak down the socket that could not leak over
HTTP. `Origin` is not re-checked on the handshake — the visitor token was issued
over an origin-checked POST and is the thing being trusted.

Every one of these authenticates by the visitor token in a header, resolves the
workspace from `{token}` (never from a client-supplied slug), and is written so
that dropping the visitor-token filter fails a test rather than leaking.

---

## 7. The loader script

### 7.1 Public contract

```html
<script type="text/javascript" src="https://support.acme.com/widget.js"></script>
<script type="text/javascript">
  var tracklyConfig = {
    widgetToken: "a1b2c3d4e5f6",
    // variables: { plan: "pro", account_id: "8842" },  // free-form, stored on the contact
    hide_launcher: false,
    show_widget_form: true,
    show_close_button: true,
    launch_widget: false,
    show_send_button: true,
    // unique_id: "...",  name: "...",  mail: "...",  number: "...",
    // token: "<JWT signed with the widget secret>",    // required when identity verification is on
    // theme: "light",   // accepted and ignored — the panel is always light (§ 4.1)
  };
  initChatWidget(tracklyConfig, 0);
</script>
```

Also exposed: `openChatWidget()`, `closeChatWidget()`, `identifyChatWidget(obj)`
— the first two are what makes `hide_launcher: true` usable, since the host page
then opens the panel from its own "Live Chat" button (screenshot 3 shows exactly
that affordance under the Hide Launcher checkbox).

The second argument to `initChatWidget` is the widget index, for pages embedding
more than one. Trackly accepts it and, for now, supports index `0`.

### 7.2 What it does

1. Reads or mints a `visitorId` (UUID) in `localStorage`, keyed per widget token.
2. `GET …/config` → brand colour, greeting, tagline, launch defaults.
3. Injects the launcher (brand colour, **not** a hardcoded indigo) unless
   `hide_launcher`.
4. Creates the iframe at `/widget/{token}` — hidden on load so it can report
   unread counts (see below), visible immediately when `launch_widget` is true.
5. Handshake: frame posts `ready`, loader replies with the merged config and
   identity payload, frame acknowledges.
6. Ongoing messages: `resize`, `open`, `close`, `expand`/`collapse` (the ⤢
   control — the frame goes full-viewport and the launcher hides), `unread`,
   `identify`.

`unread` carries a **count**, and the loader renders it as the red badge on the
launcher (§ 8.1). It never opens the panel by itself. That means the frame has to
be alive while the panel is closed to hear about a reply: the loader creates the
iframe hidden on load rather than on first open, unless `hide_launcher` is set
and no conversation exists yet. One `resize`-free hidden frame is cheaper than a
second polling channel in the loader.

Both sides validate `event.origin` against the expected origin and ignore
anything else — the widget lives on a page the operator's customer controls.

### 7.3 Back-compatibility

The current `data-workspace` / `data-embed` / `data-theme` / `data-user-name` /
`data-user-email` attribute form keeps working: on load, if no
`initChatWidget` call arrives and the script tag carries `data-workspace`, the
loader resolves that workspace's first active widget and self-initialises. Old
snippets keep working; the Integration tab only ever generates the new form.

**Until phase 4 lands, the Integration tab keeps generating the `data-*` form**,
because that is still the only form `widget.js` understands — generating the
§ 7.1 snippet earlier would hand admins something inert. It already emits
`data-widget="{public_token}"` alongside `data-workspace`, which the current
loader ignores and the phase-4 loader reads, so a snippet pasted before the
rewrite addresses the right widget after it.

---

## 8. Screens

### 8.1 Customer-facing — new Angular route `/widget/:token`

In `projects/guest` (workspace brand, always light per invariant 6 and § 4.1(1)),
four views inside **one panel** — the frame never navigates, it swaps views, so
the launcher position and any in-progress draft survive.

**The panel chrome is constant and its three slots change per view.** Left slot
is navigation, the title block is the view's identity, the right slot is the
window controls.

| View | Left slot | Title block | Right slot |
|---|---|---|---|
| Home | — | `Hello {firstName}` + tagline underneath | **✕** close |
| New conversation | **‹** back | `Conversation` | ⤢ full screen · — minimise |
| Thread | **‹** back | the agent's name (`Abhishek`) | ⤢ full screen · — minimise |

**No ☰ menu.** The reference puts one in every view because that product routes
between a bot and a human; Trackly sends straight to an agent, so the menu has
nothing left to hold. The left slot becomes a plain back chevron — the thing the
☰ was actually being used for.

The **✕ on home, — on a thread** split is deliberate in the reference and worth
copying: closing from home discards nothing, whereas a thread minimises so the
visitor can come back to it. `show_close_button: false` hides the ✕ only.

- **Home** — brand-coloured header with greeting + tagline, then:
  - **Continue Conversations** — a card list of open threads. Each row: avatar
    initial, `{last sender}: {last message}` truncated to one line, an **unread
    count pill** in the brand colour when the agent has replied since the visitor
    last opened it, and a `›` chevron. The row gains a brand-coloured border
    while it has unread messages.
  - **Talk to our experts** — a full-width **Send us a message** button.
  - **Closed conversations** — a collapsed section below, expanded on tap.
    Resolved and closed threads from the **last 30 days**; older ones drop off
    entirely. Reopening one is a normal reply, which is already how the guest
    view behaves.
  - **FAQs ›** in the header when the workspace has published KB articles.
  - Empty state: neither heading, just the button.
- **Details form** — Name (required) / Email / Phone with country code, **Skip**
  and **Submit**. Shown when `show_widget_form` is on and the host page did not
  identify the visitor, and **re-asked at the start of every new conversation** —
  Skip applies to that conversation only. Details already known (from an earlier
  Submit, or from the host page) pre-fill the fields rather than suppressing the
  form.
- **New conversation** — centred illustration + **What can I help with?** over an
  empty composer. This is the empty state of a thread that does not exist yet;
  the ticket is created by the first send, not by opening the view.
- **Thread** — visitor messages right-aligned in the brand colour, agent messages
  left-aligned on a neutral surface with `{Agent name} • {relative time}`
  underneath. Composer with emoji and attachment affordances; send button
  disabled until there is text. `show_send_button: false` hides the button and
  leaves Enter-to-send.

**Navigation is a push.** Home → thread slides forward; the back chevron returns.
There is no separate list screen: home *is* the list.

**⤢ goes full screen** — the frame takes the whole viewport of the host page
(fixed, inset 0), not a larger docked panel. That is a loader-side change, since
the iframe's size is the loader's to set: the frame posts `expand` / `collapse`
and the loader swaps the style. The launcher hides while expanded.

**Relative time, refreshed live** — "3h ago", "Just now". Absolute timestamp on
hover/long-press.

Four states each — loading, empty (*which* empty: never raised anything vs. all
threads closed), error with retry, data.

#### Unread behaviour (confirmed against the reference)

1. Agent replies while the panel is **closed** → the launcher keeps its icon and
   gains a **red count badge**. It does **not** auto-open and does not toast.
   `launch_widget` governs first load only, never an incoming reply.
2. Opening the panel → home shows the same count as a pill on that conversation's
   row, and the row is outlined.
3. Opening the thread clears both, and posts a read receipt so the count does not
   return on the next poll.

That makes unread a **per-conversation** count summed for the launcher, not a
single boolean — `GET …/conversations` returns `unreadCount` per row, and the
frame reports the total to the loader over `postMessage` (§ 7.2, `unread`).

Read state lives on `widget_visitors`, not on the ticket: two devices signed in
as the same verified contact each track their own. A
`widget_conversation_reads (visitor_id, ticket_id, last_read_at)` row is the
smallest thing that does it.

#### Out of scope (noted because the screenshots show it)

The reference composer reads *"Message AI Assistant…"* and its empty state is a
bot avatar — that product answers first with a bot and hands off to a human.
Trackly has `AiService` and could do the same, but an AI first responder is a
product decision well beyond this plan. **Phase 5 ships a human-only widget**;
the composer placeholder is "Message us…". If bot-first is wanted later, it
attaches at the thread's first send, and § 3.3's trust rule is unaffected.

### 8.2 Admin — replacing the `ComingSoon` at `/admin/widget`

A list screen (name, token, status, last used, **New widget**), then the two-tab
editor from the screenshots:

- **Configuration** — Name, Tagline, Greeting, Assign Team, Widget Theme
  (colour), Launch Options (Hide Launcher / Default Launch Widget / Enable form
  to collect user data), Identity Verification (enable + masked secret with copy,
  Regenerate Secret Key, Verify JWT), Allowed domains, Require email
  verification, Update, Delete Widget.
- **Branding** — the block absorbed from the dropped `/admin/settings/branding`
  screen (§ 4.2): logo upload, footer text, Hide "Powered by Trackly", page title
  and welcome text, and the workspace's default primary colour. It writes
  `workspace_branding`, so it sits under its own heading with help text saying
  plainly that these apply **everywhere** — the login page, the portal, the
  knowledge base, and the header of every email Trackly sends — while Widget
  Theme above it overrides the colour for this widget alone.
- **Integration** — Web / Mobile SDK tabs, the generated snippet in a scrollable
  code block with copy, "Know more about variables" into the admin guide, and the
  **live preview panel on the right** that both screenshots show — it is the
  thing that makes a colour picker legible.

Built from the `trackly-ui` design system (no interpolated Tailwind classes), new
i18n keys via `trackly-i18n`.

---

## 9. Security checklist

Mapped to the invariants, because most of this surface is anonymous.

1. **Workspace (inv. 1)** — resolved from `public_token` server-side. No public
   endpoint accepts a workspace slug.
2. **Origin allowlist** — `allowed_origins` is checked on `/config` and
   `/session`. Note the limit honestly: `frame-ancestors` cannot be set here
   because nginx serves `/widget/:token` as a static SPA route and does not know
   the allowlist (see the deliberate no-`X-Frame-Options` comment at
   `default.conf.template:51`). An unlisted site can therefore still *render* the
   frame; it just cannot obtain config or a session, so the widget is inert.
   Serving the frame document from the API with a per-widget CSP header is the
   follow-up if that is not enough.
3. **Secrets (inv. 3)** — `secret_key_encrypted` is AES-256-GCM. Plaintext
   crosses the wire once, on create and regenerate, and is never logged.
4. **Tokens (inv. 4)** — `visitor_token_hash` is SHA-256. The raw token lives in
   the frame's `localStorage` only.
5. **Private notes (inv. 5)** — the thread projection reuses the guest-view
   filter (`!c.IsInternal`) and its attachment rule. A test asserts an internal
   note never appears in a widget response.
6. **Branding (inv. 6)** — the widget's colour if set, else the workspace's;
   logo and "Powered by Trackly" from `workspace_branding`; **always light**
   (§ 4.1). Never the Trackly palette, never a dark panel.
7. **Trust rule (§ 3.3)** — unverified visitors are filtered by
   `widget_visitor_id`, verified ones by `requester_id`. The two paths are
   separate methods so neither can be reached by accident.
8. **JWT** — HS256 against the decrypted secret, `exp` required, clock skew 60s,
   `unique_id` claim must match the config's. Reject `alg: none` explicitly.
9. **Contact upsert** — never touches a row whose role is not `customer`, and an
   *unverified* identity never merges into an existing contact: it creates or
   reuses a visitor record and leaves `user_id` null until verified.
10. **Rate limits** — the existing `"auth"` policy on session, conversation
    create, message post and attachment upload.

---

## 10. Phases

Each is independently shippable and leaves the existing widget working.

| # | Scope | Done when |
|---|---|---|
| 1 ✅ | Reshaped `widget_configs` + `widget_visitors` + `tickets.widget_visitor_id`, EF migration with backfill, admin CRUD, secret encrypt/regenerate/verify | An admin can create two widgets over the API and each has its own token; the old snippet still renders |
| 2 ✅ | Public config + session endpoints, JWT verification, contact-upsert service, ticket creation with `Channel = widget` and `RequesterId` | A widget ticket appears on the Customer Detail screen's "previous tickets" with no UI change |
| 3 ✅ | Conversation list + thread + reply + attachments, trust rule, `widget_conversation_reads` + `unreadCount` + read receipt, SignalR per-visitor group with polling fallback | Two browsers with different visitor tokens cannot see each other's conversations — asserted by test |
| 4 | `/widget.js` rewritten: `initChatWidget`, open/close/identify, branded launcher, postMessage handshake, back-compat path | The snippet in § 7.1 works on a plain HTML page |
| 5 | Angular customer surface `/widget/:token` (home, details form, thread, closed section) | Four states each, brand-coloured, light |
| 6 | Angular admin `/admin/widget` list + Configuration/Branding/Integration tabs with live preview; `/admin/settings/branding` route and nav entry removed (§ 4.2) | React `WidgetPage.tsx` is no longer reachable and branding is editable in exactly one place |
| 7 | Docs | § 11 |

Phase 3 shipped with `scripts/verify-widget-phase3.ps1` — 62 assertions. The
done-when is taken apart directly: two browsers on one widget, **both claiming
the same email address**, each see exactly their own conversation and get a 404
on the other's thread, reply, read receipt and attachment. The verified half is
checked too — a signed visitor sees a ticket an agent logged for that contact
over the phone, which never touched a widget at all.

Three things the phase settled that the plan had not:

- **A read marker never moves backwards.** Two tabs posting receipts out of order
  would otherwise resurrect a badge one of them had already cleared. The stamp is
  `if (at > row.LastReadAt)`, not an assignment.
- **The real-time push sits ahead of the notification settings gate.** Every reply
  path already funnels through `NotificationService.OnReplyAsync`, which is why
  the hook lives there — but *above* `NotifyCustomerOnReply`. An open panel is a
  live screen, not an email preference, and an admin who turned reply emails off
  did not ask for the widget to stop updating.
- **"Agent" is `role != customer`, not `AuthorId != null`.** A customer replying
  through the portal has an author row too, so the obvious test would have
  counted a customer's own message as unread on their own thread.

`Trackly.Modules` cannot see the hub, which lives in `Trackly.Api`, so the push
goes through `IWidgetRealtime` in `Trackly.Core.Interfaces` with a no-op default
registered in the infrastructure. That default is what makes the fallback honest:
a host that never maps the hub still runs, and the panel still polls.

Phase 2 shipped with `scripts/verify-widget-phase2.ps1` — 52 assertions, most of
them about the trust rule refusing to bend. Four decisions it forced:

- **Email verification was built, not deferred.** `require_email_verification`
  was going to be a toggle with nothing behind it: a widget whose host page sends
  no signature has no other route to verified, so turning the switch on would
  have made the widget unusable and looked like a Trackly bug. The two endpoints
  above reuse `EmailToken` and the existing `guest_otp` template.
- **An unverified visitor still raises tickets** — as a guest, with their claimed
  details in `guest_name` / `guest_email` and `requester_id` null. Only a proven
  identity becomes a requester. That is § 3.3 at the one point where it is
  observable in the database.
- **A verified visitor cannot be downgraded.** A later unsigned payload on the
  same visitor token is ignored rather than applied. Without that, a host page
  that forgets the token on one route would silently unlink the contact — and a
  page that sent a *different* address would repoint it.
- **The confirmation email only goes to a proven address.** Sending "we got your
  request" to whatever was typed would make every embed on the internet a way to
  post a Trackly-branded email to a stranger's inbox. The panel is the receipt.

One binding bug worth remembering: `unique_id` needs an explicit
`[JsonPropertyName]`. The serializer's camelCase default looks for `uniqueId`,
binds nothing, and an unmatched claim reads as *"the page named nobody"* rather
than as an error — so a signature/claim mismatch would have gone unchecked. It
was caught only because a test asserted the mismatch is rejected.

Phase 1 shipped with `scripts/verify-widget-phase1.ps1` — 43 assertions covering
multi-widget creation, secret masking, every way a JWT can be wrong (wrong key,
regenerated-away key, expired, no `exp`, `alg: none`, no `unique_id`, another
widget's token), and the back-compatibility clause. The migration's backfill was
exercised by rolling the database back to `InitialCreate`, inserting a
pre-reshape row and migrating forward: it gains a 12-char token, the workspace's
name, and `is_active` / `show_widget_form` / `show_close_button` /
`show_send_button` all **true**, so a live embed does not go dark on upgrade.

## 11. Docs to update as phases land

- **`docs/trackly-plan.md`** § Embeddable Widget & Integration Options — new
  schema, the endpoint table, and the trust rule (§ 3.3), which belongs beside
  the invariants rather than in a working file. Its **§ Branding** section needs
  the § 4.2 split recorded too: the record stays workspace-level, the screen
  moves, and the widget may override the colour.
- **`docs/admin-guide.md`** — § 11 gets multiple widgets, the Configuration /
  Branding / Integration tabs, what identity verification is for and how a
  developer signs the JWT, and allowed domains. **§ 10 (branding) must be
  rewritten to point at the widget screen**, and the "Admin ▾" nav table near the
  end of the guide loses its Branding row — an admin following the current text
  would look for a screen that no longer exists.
- **`docs/go-live.md`** — the new public endpoints that must be reachable over
  HTTPS, the secret-key rotation story, and the `frame-ancestors` caveat in
  § 9.2.

---

## 12. Questions

### 12.1 Answered by the second screenshot set

- **Agent replies while closed** → red count badge on the launcher, no auto-open,
  no toast. Cleared by opening the thread. → § 8.1 *Unread behaviour*.
- **List ↔ thread** → a push within one panel; home *is* the list ("Continue
  Conversations"), so there is no separate list view. → § 8.1.
- **Panel chrome** → ☰ menu on the left throughout; ✕ on home, ⤢ expand and —
  minimise on a thread. → § 8.1 table.

### 12.2 Settled in review

- **No ☰ menu.** The reference needs one to route between a bot and a human;
  Trackly sends straight to an agent. Left slot is a back chevron. → § 8.1.
- **The details form is re-asked per conversation**, not once per visitor; Skip
  is scoped to the conversation it was skipped on. → § 8.1.
- **⤢ is full screen**, not a bigger docked panel — a loader-side style swap
  driven by an `expand`/`collapse` message. → § 7.2, § 8.1.
- **Closed conversations get a collapsed section**, last 30 days, older ones drop
  off. → § 8.1.
- **The row preview uses the real sender's name.** The reference's literal
  `Sender:` label is a gap in that product, not a pattern: it renders
  `Sender: HI` for a message whose own thread attributes it to *Abhishek Raheja*.
  Trackly renders `Abhishek: HI`, and `You: …` when the visitor spoke last.

### 12.3 Still open

Nothing. § 4 is closed — theme is colour-only and always light, threads are
tickets, the widget does not send an OTP, and branding merges at the screen while
staying workspace-level in the database. Phase 1 can start.
