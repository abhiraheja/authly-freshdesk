# Patterns

How the components in `components.md` compose into real screens, plus the
cross-cutting rules (icons, states, copy) that keep pages consistent.

---

## 1. Icons — Lucide, not emoji

The React app renders 🎫 📂 ⏱ 🙋 🧩 ✨ 🔒 📎 ⚡ 🔍 ☀️ 🌙 as text. Emoji render
differently per OS, can't inherit `currentColor`, size inconsistently, and read
as decoration rather than UI. None of them survive the port.

`ui/icon/icon.ts` is a hand-picked inline-SVG subset of Lucide. The
`lucide-angular` package is **not** used: it declares peer support only to
Angular 21, and this workspace is on 22. Inlining also means perfect
tree-shaking and no runtime registry.

```html
<tk-icon name="ticket" [size]="18" />
<tk-icon name="sparkles" [size]="16" class="text-primary" />
```

Sizes: **16** inline with body text · **18** nav and buttons · **20** icon
buttons · **28** empty states.

To add an icon: copy the 24×24 path data from lucide.dev into a `@case` in
`icon.ts` and add the name to the `IconName` union. The union is the guard — a
typo is a compile error, not a blank space.

### Mapping

| Was | Now | Where |
|---|---|---|
| 🎫 | `Ticket` | tickets nav, KPI, empty state |
| 📂 | `FolderOpen` | open KPI |
| ⏱ | `Clock` | pending KPI |
| 🙋 | `UserX` | unassigned KPI |
| 🧩 | `Puzzle` | problems |
| ✅ | `CheckCircle2` | resolved, checklist done |
| ⬜ | `Circle` | checklist todo |
| ✨ | `Sparkles` | every AI affordance |
| 🔒 | `Lock` | internal note |
| 📎 | `Paperclip` | attachments |
| ⚡ | `Zap` | canned responses, automation |
| 🔍 | `Search` | search inputs, ⌘K |
| ☀️ / 🌙 | `Sun` / `Moon` | colour mode toggle |
| 💬 | `MessageSquare` | public reply, live chat |
| 🏠 | `LayoutDashboard` | dashboard |
| 📚 | `BookOpen` | knowledge base |
| 👥 | `Users` | members |
| 🎨 | `Palette` | branding |
| ◆ (logo) | `LifeBuoy` in the gradient tile | brand mark |
| 📬 | `Mail` | magic-link screens |
| 🚀 | `Rocket` | getting-started panel |

Channels: `Mail`, `MessageCircle` (WhatsApp), `Phone` (voice),
`MessagesSquare` (web chat), `Instagram`, `Facebook`, `Globe` (widget),
`Code` (API), `Edit3` (manual).

---

## 2. Page recipe — Overview (Dashboard, Analytics)

```
PageHeader                                    title + date-range control
KPI grid            2 / 3 / 6 columns         StatCard × 6, each with a delta
Chart row           2fr + 1fr                 GroupedBars | Donut
Panel row           1fr 1fr 1fr               MeterRow list | Timeline | leaderboard
Recent list         full width                Panel with clickable rows + "View all"
```

Six KPIs for the agent dashboard: Total · Open · Pending · Resolved today ·
Avg. resolution · CSAT. The last three don't exist in
`/api/dashboard/stats` yet — see § 6.

Keep the existing "Getting started" checklist, but only render it while
incomplete. A permanently half-finished checklist is noise; once every item is
done, the panel disappears and the row becomes 2-up.

---

## 3. Page recipe — Index (Tickets, Members, KB, …)

```
tk-page-header                title + live counts subtitle + primary action
filter bar (tk-card dense)    search · selects · Clear
bulk bar                      only when a selection exists
tk-card flush                 overflow-x wrapper → table[tkTable] → tk-pagination
```

`frontend-angular/src/app/features/tickets/ticket-list.ts` is the reference
implementation — copy its shape.

### Filter bar

One `<tk-card dense>` holding a `flex flex-wrap gap-2` row. Search grows
(`flex-1 min-w-[200px]`); selects are `tkInput inputSize="sm" class="w-auto"`.

**Every filter lives in the URL.** `?view=open&priority=high&page=2`, bound to
`input()`s by `withComponentInputBinding()`:

```ts
readonly view = input('');
readonly q = input('');

protected readonly tickets = resource({
  params: () => ({ view: this.view(), search: this.q() }),
  loader: ({ params }) => this.api.list({ … }),
});
```

Three things fall out for free: shareable links, working browser Back, and the
resource params doubling as the cache key.

Two details that are easy to get wrong:
- **Debounce the search box** and write it with `replaceUrl: true`, or every
  keystroke becomes a history entry.
- **Reset `page` on any other filter change.** Page 3 of the old filter is
  meaningless under the new one.

The sidebar's saved views and this bar are the same state — clicking "Open" in
the rail sets `?view=open`, and the bar reflects it with no extra wiring.

### Ticket table columns

| Column | Content | Hides below |
|---|---|---|
| — | selection checkbox | — |
| Ticket | channel icon · subject (bold, truncated) · `#id · channel` | — |
| Requester | avatar · name | `sm` |
| Category | text | `lg` |
| Priority | `PriorityChip` | — |
| Status | `StatusChip` | — |
| Assignee | avatar · name | `md` |
| SLA | `SlaBadge` | `lg` |
| Actions | view · assign · resolve · more | — |

---

## 4. Page recipe — Record (Ticket detail, Customer)

```
Back link
┌─ main (2fr) ─────────────────┐  ┌─ rail (1fr) ──────┐
│ TicketHeader Panel           │  │ Ticket information│
│ AiPanel — summary            │  │ SlaTimer          │
│ Conversation Panel + tabs    │  │ AI insights       │
│ Composer Panel               │  │ Requester         │
└──────────────────────────────┘  │ Actions           │
                                  └───────────────────┘
```

Tabs inside the conversation panel: **Conversation · Internal notes ·
Attachments (n)**. Splitting notes out of the main thread is a real improvement —
it makes "did the customer see this?" unambiguous — but it does **not** relax
invariant 5. The API still filters `is_internal` for every non-agent caller.

### Composer

1. `AiPanel` with the suggested reply and Insert / Rewrite — only when AI is on
2. Reply / Note toggle (`ToggleButtonGroup`, the Note side in `tone.amber`)
3. `TextField multiline minRows={3}` on `surfaceMuted`
4. Toolbar: attach · canned · AI · *spacer* · contained Send

The placeholder changes with the mode — `Reply to {name}… (visible to the
customer)` vs `Private note… (only agents and admins can see this)`. That one
line prevents the worst mistake in the product.

---

## 5. Page recipe — Settings (13 admin pages)

Single column, `maxWidth: 720`, `<Stack spacing={3}>` of `Panel`s. Each panel is
one concern with a title, one-line description, fields, and its own save button
with per-panel dirty state. No page-level "Save all".

Secrets (SMTP passwords, SSO client secrets, signing keys) render as
`••••••••` with a Replace button — never the decrypted value, not even
masked-but-selectable.

Settings that flip destructive behaviour (disable email ingestion, rotate a
signing secret, delete an SSO config) go through `ConfirmDialog`.

---

## 6. What needs backend work

Honest split, so a migration PR doesn't quietly turn into a feature PR.

**Pure UI — ships against today's API (all of this is already done):**
sidebar shell · command palette · toasts · Lucide icons · tone/badge system ·
type scale · table + pagination · empty states · skeletons · motion · the four
page shapes.

**UI + a small API change:**

| Feature | Needs | Status in the Angular app |
|---|---|---|
| Sidebar saved-view counts | `/api/dashboard/stats` already returns most of them | wired; `Shell.counts` is fed once a caller sets it |
| **Unassigned** saved view | `assigneeId=none` (or `unassigned=true`) on `GET /api/tickets` | row deliberately **omitted** from `nav.ts` |
| KPI deltas | previous-period figures on `stats` | `tk-stat-card` supports `[delta]`; nothing passes one |
| Weekly volume bars | `GET /api/dashboard/timeseries?days=7` | `tk-bars` ready, unused |
| Agent performance | `GET /api/dashboard/agents` | `tk-meter` ready, unused |
| Recent activity timeline | an audit/event feed endpoint | not built |
| Resolved today · avg resolution · CSAT | three fields on `stats` | not built |
| Notification menu contents | a notifications endpoint | menu renders "You're all caught up" |

The components exist and are unused **on purpose**. A `tk-bars` fed invented
numbers looks finished and is a lie; an absent chart is honest and takes ten
minutes to add once the endpoint lands.

**Not a redesign at all — new features.** Don't build the UI for these until the
feature is agreed: ticket merge, translation, sentiment/emotion, AI confidence
scores, similar-ticket lookup, customer profiles with company/phone/lifetime
value, departments, "Escalated" and "Waiting on customer" statuses, VIP tiers,
ticket drafts.

The reference prototype shows all of them with hard-coded data. Copying the
visual without the data produces a screen that lies.

---

## 7. State policy

Every data surface handles four states. Missing one is the most common review
finding.

| State | Treatment |
|---|---|
| Loading | skeletons matching the real layout's height. Spinners only for full-page auth checks. |
| Empty | `EmptyState`, with copy that distinguishes "nothing yet" from "nothing matches". |
| Error | inline `<Alert severity="error">` with the `ApiError` message and a Retry that calls `refetch()`. |
| Partial | render what arrived; never blank the page because one secondary query failed. |

Branch on `ApiError.status`, not on message text:

```ts
if (err instanceof ApiError && err.status === 403) return <NoAccess />
```

---

## 8. Copy

| Rule | Yes | No |
|---|---|---|
| Sentence case everywhere | "New ticket" | "New Ticket" |
| Buttons are verbs | "Invite member" | "Submit" |
| Say what happened | "Ticket assigned to Aisha" | "Success!" |
| Errors say what to do | "That email is already a member. Change their role instead." | "Operation failed" |
| No Trackly branding on customer surfaces | "Sign in to Acme Support" | "Sign in to Trackly" |
| Numbers get units | "4h 12m" | "252" |

Empty-state descriptions are one sentence and explain the next action, not the
absence.

---

## 9. Accessibility

- Every icon-only button gets `aria-label`. `<Tooltip>` alone is not a label.
- Sidebar is `<nav aria-label="Main">`; the active item carries `aria-current="page"`.
- Command palette and dialogs trap focus and restore it on close.
- Tables: `<th scope="col">`; row-click rows also need a keyboard path — either
  a focusable link in the first cell or `tabIndex={0}` + Enter.
- Colour never carries meaning alone. Status chips have a dot **and** a label;
  SLA states say "Overdue 2h", not just red.
- Visible focus ring on every interactive element — never `outline: none`
  without a replacement.
- Verify contrast on `tone` chips in both schemes; they were chosen to pass
  4.5:1, but new tones must be checked.

---

## 10. Porting a screen from React

The framework is done. What remains is screen-by-screen migration, and each
screen is independently shippable.

**Shipped:** token layer · UI library · shell (sidebar, top bar, ⌘K palette) ·
core (api, session, guards, theme, tone maps) · login · dashboard · ticket list.

**Remaining:** every route in `app.routes.ts` still pointing at `ComingSoon` —
each carries a `from:` naming the React file to port.

### The recipe

1. **Read the React file for behaviour**, not for markup. What does it fetch,
   what can the user do, what are its edge cases? The MUI JSX is not a template
   to translate.
2. **Add the API methods** to a typed `core/api/*.api.ts` if they don't exist.
   Reuse the React `src/api/*.ts` types verbatim — they match the server.
3. **Pick the page shape** from `layout.md` § 4.3 and build it from `ui/`
   components. A ported page should contain almost no bespoke styling.
4. **Move filters into the URL.** Most React pages hold them in `useState`;
   in Angular they are `input()`s bound from query params.
5. **Cover all four states** (§ 7). The React page probably renders a bare
   spinner and no empty state — that gap is part of the port, not out of scope.
6. **Delete the React file and its route**, and drop the `ComingSoon` entry, in
   the same change. Two live implementations of one screen is worse than either.
7. `npx ng build` — then check the screen in both colour modes.

When `app.routes.ts` no longer imports `ComingSoon`, delete `frontend/`, the
legacy launch configs in `.vscode/launch.json`, and the `frontend: dev` task.

### Suggested order

Admin settings first — they are the simplest shape (a single column of form
cards) and there are thirteen of them, so the patterns get exercised hard and
cheaply. Then Index pages (members, teams, KB, canned, problems), then the
customer-facing branded surfaces, then ticket detail, then live chat (SignalR),
then analytics.

---

## 11. Definition of done

- `npx ng build` from `frontend-angular/` exits 0
- viewed in **both** colour modes if the surface is Trackly-owned
- no horizontal page scroll at 380px; wide tables scroll inside their card
- all four states (loading / empty / error / data) reachable and correct
- **no interpolated Tailwind class names anywhere in the diff** (§ tokens 8.1)
- no literal hex outside `styles.scss` and the avatar palette in `core/format.ts`
- no ad-hoc font sizes — the eight-step scale only
- component is standalone + `OnPush`; no `@Input()`, no `*ngIf`, no `NgModule`
- keyboard: tab through the whole screen, operate every control, visible focus
- icon-only buttons have `aria-label`; the active nav item has `aria-current`
- if the change adds a feature or setting, `docs/admin-guide.md` updated; if it
  adds config or a dependency, `docs/go-live.md` updated; if it deviates from
  the plan, `docs/trackly-plan.md` updated — in the same change
