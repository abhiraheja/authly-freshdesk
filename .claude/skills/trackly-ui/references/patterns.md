# Patterns

How the components in `components.md` compose into real screens, plus the
cross-cutting rules (icons, states, copy) that keep pages consistent.

---

## 1. Icons — Lucide, not emoji

The codebase currently renders 🎫 📂 ⏱ 🙋 🧩 ✨ 🔒 📎 ⚡ 🔍 ☀️ 🌙 as text. Emoji
render differently per OS, can't inherit `currentColor`, ignore `fontSize`
consistently, and read as decoration rather than UI.

```bash
npm i lucide-react
```

```tsx
import { Ticket, Sparkles, Lock } from 'lucide-react'

<Ticket size={18} />                              // inherits currentColor
<Sparkles size={16} color="var(--mui-palette-primary-main)" />
```

Sizes: **16** inline with body text, **18** in nav and buttons, **20** in icon
buttons, **28** in empty states.

`@mui/icons-material` is installed but unused — remove it from `package.json`
rather than mixing two icon sets.

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
PageHeader                    title + live counts subtitle + primary action
FilterBar (Panel, dense)      search · selects · "More filters"
BulkBar                       only when selection is non-empty
DataTable (Panel)             columns · skeleton · empty state
Pagination                    inside the table Panel footer
```

### FilterBar

One `Panel` with `p: 1.5`, a horizontal `Stack` with `flexWrap: 'wrap'` and
`gap: 1`. Search grows (`flex: 1, minWidth: 200`); selects are fixed-width
`size="small"`.

**Every filter lives in the URL.** `?view=open&priority=high&page=2`. Three
things fall out of that for free: shareable links, working browser back, and
`queryKey: ['tickets', params]` giving correct caching.

The sidebar's saved views and this bar are the same state — clicking "Open" in
the sidebar sets `?view=open`, and the bar reflects it.

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

Honest split, so a redesign PR doesn't quietly turn into a feature PR.

**Pure UI — ships with today's API:**
sidebar shell · command palette · toasts · Lucide icons · tone/badge system ·
type scale · DataTable + bulk select + pagination · empty states · skeletons ·
tabs · motion · Record layout · AiPanel restyle.

**UI + a small API change:**

| Feature | Needs |
|---|---|
| Sidebar saved-view counts | per-status counts on `/api/dashboard/stats` |
| KPI deltas | previous-period figures on the same endpoint |
| Weekly volume bars | `GET /api/dashboard/timeseries?days=7` |
| Status donut / priority meters | already derivable from `stats` |
| Agent performance | `GET /api/dashboard/agents` |
| Recent activity timeline | an audit/event feed endpoint |
| Resolved today · avg resolution · CSAT KPIs | three fields on `stats` |

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

## 10. Migration order

Each step is independently shippable and leaves the app working.

1. **Tokens** — extend `theme.ts` (tone, chart, typography, keyframes, motion,
   layout). Nothing visual changes yet.
2. **Chips** — `ToneChip` + the tone maps; replace `STATUS_CHIP` / `PRIORITY_CHIP`.
   Fixes dark mode immediately.
3. **Icons** — `lucide-react`, sweep the emoji, drop `@mui/icons-material`.
4. **Shell** — `SidebarNav` + `TopBar`, rewrite `AppShell`. Biggest visual jump.
5. **Primitives** — `Panel`, `PageHeader`, `EmptyState`, `SkeletonRows`,
   `ToastProvider`; adopt them in the admin pages first (simplest, 13 of them).
6. **Index** — `DataTable` + filter bar + bulk + pagination; tickets first, then
   members/teams/KB/canned.
7. **Record** — ticket detail as a 2-column page; resolve the three-pane question
   from `layout.md` § 5 here.
8. **Overview** — charts and the KPI row, behind whatever `stats` fields land.
9. **Command palette + notifications** — last, because they depend on the routes
   and data the earlier steps establish.

Customer-facing surfaces are untouched by steps 4–9. They pick up the
typography, spacing and motion tokens from step 1 and nothing else.

---

## 11. Definition of done

- `npx tsc -b` from `frontend/` exits 0
- viewed in **both** colour modes if the surface is Trackly-owned
- no horizontal page scroll at 380px; wide tables scroll inside their card
- all four states (loading / empty / error / data) reachable and correct
- no literal hex outside `theme.ts` and `lib/format.ts`
- no `fontSize` overrides — variants only
- keyboard: tab through the whole screen, operate every control, visible focus
- if the change adds a feature or setting, `docs/admin-guide.md` updated; if it
  adds config or a dependency, `docs/go-live.md` updated; if it deviates from
  the plan, `docs/trackly-plan.md` updated — in the same change
