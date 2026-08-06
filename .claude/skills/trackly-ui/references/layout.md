# Layout

The shell every Trackly screen lives in, and the templates that fill it.

---

## 1. The shell

```
┌──────────────┬────────────────────────────────────────────────┐
│              │  TopBar                             64px       │
│  Sidebar     ├────────────────────────────────────────────────┤
│  280px       │                                                │
│  glass       │   PageHeader                                   │
│  permanent   │                                                │
│  ≥ lg        │   <Stack spacing={3}>                          │
│              │     section                                    │
│  ┌────────┐  │     section                                    │
│  │AI card │  │   </Stack>                                     │
│  └────────┘  │                          max-width 1600        │
└──────────────┴────────────────────────────────────────────────┘
```

`Shell` (`src/app/shell/`) is a **routed** component, not a wrapper around the
root. Full-screen surfaces — login, the guest ticket view, the customer submit
form — are siblings of it in the route tree, so they render without any chrome.

```html
<div class="flex h-screen overflow-hidden bg-background text-foreground">
  <aside class="glass fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col
                border-r border-sidebar-border transition-transform duration-200
                lg:static lg:translate-x-0"
         [class.-translate-x-full]="!mobileOpen()"> … </aside>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <header class="glass sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3
                   border-b border-border px-4 md:px-6"> … </header>

    <!-- The ONLY scrolling pane. -->
    <main class="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div class="mx-auto w-full max-w-[1600px]">
        <router-outlet />
      </div>
    </main>
  </div>
</div>
```

Three classes here are load-bearing:

- **`min-w-0`** on the content column — without it a wide table pushes the flex
  container past the viewport and the whole page scrolls sideways.
- **`min-h-0`** on the column and `<main>` — a flex child defaults to
  `min-height: auto`, which refuses to shrink, so the page scrolls instead of
  the pane and the header scrolls away with it.
- **`overflow-hidden`** on the outer wrapper — it pins the shell to the viewport
  so only `<main>` ever moves.

Active state is computed from the URL (a `toSignal` over `NavigationEnd`), never
set imperatively on click. Otherwise Back, a deep link and a command-palette jump
each need their own highlight handling and one of them always drifts.

---

## 2. Sidebar

`280px`, glass background, `borderRight: 1px solid divider`, full height,
`position: sticky` at `top: 0`. Three stacked regions.

### 2.1 Brand block — 64px, matches the topbar

```html
<div class="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
  <div class="brand-gradient grid size-9 shrink-0 place-items-center rounded-xl
              text-white shadow-[var(--shadow-lift)]">
    <tk-icon name="life-buoy" [size]="18" />
  </div>
  <div class="min-w-0 leading-tight">
    <p class="font-display font-extrabold tracking-tight">Trackly</p>
    <p class="truncate text-meta text-muted-foreground">{{ workspaceName() }}</p>
  </div>
</div>
```

`h-16` here must equal the top bar's `h-16`, or the two borders don't line up
across the seam and the whole header reads as broken.

### 2.2 Nav — scrollable, grouped

The nav is **data**, in `src/app/shell/nav.ts` — the sidebar and the command
palette both render from it, so a new destination is searchable the moment it is
added, with nothing else to register.

| Group | Items |
|---|---|
| **Overview** | Dashboard |
| **Tickets** | All tickets · Assigned to me · Open · Pending · Resolved · Closed |
| **Workspace** | Live chat · Problems · Knowledge base · Canned responses |
| **Admin** *(admins only)* | Analytics · Announcements · Members · Teams · SLA policies · Automation · AI copilot · Messaging · Widget · Email · Branding · SSO · Domains |

The **Tickets** group is the important shape: status filters are first-class
navigation with live counts, not options buried in a dropdown inside the list.
Each is the same `/dashboard/tickets` route with a different `?view=`, so the
sidebar and the list's own filter bar are the *same state*, not two copies.

> An **Unassigned** view belongs in that group too, but `GET /api/tickets` has
> no way to express it — `assigneeId` only matches a specific agent. The row is
> deliberately absent rather than silently showing the wrong tickets; it lands
> with the API change.

Admin has thirteen destinations, so its group is collapsible. It opens
automatically while an `/admin` route is active and stays out of the way
otherwise:

```ts
private readonly adminToggled = signal<boolean | null>(null);
protected readonly adminOpen = computed(
  () => this.adminToggled() ?? this.url().startsWith('/admin'),
);
```

The `null` sentinel is the point: "the user hasn't expressed a preference, so
follow the route". A plain boolean would either ignore the route or fight the
user's click.

### 2.3 NavItem anatomy

```
┌─┬────────────────────────────────────────┐
│▍│  ●  Open                          72   │   ← 4px bar | dot/icon | label | count
└─┴────────────────────────────────────────┘
   40px tall · radius 12 · px 1.5 · gap 1.5
```

| State | Class |
|---|---|
| rest | `.nav-row .nav-idle` |
| hover | `.nav-idle:hover` → `bg-sidebar-accent` |
| active | `.nav-row .nav-active` |

All three live in `styles.scss`. The active background is a horizontal **fade**,
not a flat fill — that gradient is what makes the rail read as a rail:

```css
.nav-active {
  color: rgb(var(--primary));
  background: linear-gradient(90deg, rgb(var(--primary) / 0.14), rgb(var(--primary) / 0.02));
}
.nav-active::before {          /* the 4px bar */
  content: '';
  position: absolute;
  left: 0; top: 6px; bottom: 6px;
  width: 4px; border-radius: 999px;
  background: rgb(var(--primary));
}
```

Because `--primary` flips with the scheme, one rule covers both — no `mode`
branch, no dark-mode override.

Markup:

```html
<a class="nav-row"
   [class.nav-active]="isActive(item)"
   [class.nav-idle]="!isActive(item)"
   [routerLink]="item.route"
   [queryParams]="item.params ?? null"
   [attr.aria-current]="isActive(item) ? 'page' : null">
```

`aria-current="page"` is not optional — the gradient is invisible to a screen
reader.

Saved views render a **status dot** instead of an icon, so the colour reads as
"this is a state" rather than "this is a place". Pick the dot class from a
static map (`dotClass(item)`), never by interpolating `bg-${tone}`.

Trailing count uses `.count-pill`; the leading status dot is an 8px circle. Both
are in `styles.scss`.

### 2.4 Footer — profile

Avatar + name + role, opening a menu upward (theme toggle, sign out). Pinned
below the scrolling nav with `border-t`.

An **AI copilot promo panel** can sit above it — a `.brand-gradient` card. Render
it only when the copilot is actually configured (`getAiAvailability().available`).
An advert for a disabled feature is worse than empty space.

### 2.5 Responsive

| Breakpoint | Behaviour |
|---|---|
| `≥ lg` | `lg:static lg:translate-x-0` — part of the flex row, always visible |
| `< lg` | `fixed` + `-translate-x-full`, slid in by the top bar's menu button, with a backdrop; closes on navigate |

One `<aside>` with classes toggled, **not** two components. Duplicating the nav
markup for mobile is how the two copies drift apart.

---

## 3. Top bar

`h-16`, `.glass`, `sticky top-0 z-30`, `border-b border-border`. Left to right:

| Slot | Notes |
|---|---|
| Menu button | `< lg` only, wrapped in `<span class="lg:hidden">` |
| **Search / ⌘K trigger** | `max-w-md`, `bg-muted`, `rounded-xl`, icon + placeholder + `<tk-kbd>⌘K</tk-kbd>`. A **button**, not an input — it opens the command palette, which searches more than this page. |
| *spacer* (`ml-auto`) | |
| Primary action | "New ticket"; label collapses `< sm`, icon stays |
| Notifications | icon button + unread dot + dropdown |
| Colour mode | `≥ lg` only — also in the profile menu |

**Overflow must stay visible here.** The dropdowns open downward with
`position: absolute`; any overflow container on this row (including
`overflow-x-auto`, which promotes `overflow-y` to `auto`) clips them *inside*
the bar instead of letting them overlay the page.

The top bar is Trackly chrome. Customer surfaces replace it with the
workspace-branded header — see § 6.

---

## 4. Page templates

### 4.1 PageHeader — every page starts with one

```html
<tk-page-header title="Tickets" [subtitle]="summary()">
  <a tkButton page-actions routerLink="/dashboard/tickets/new">
    <tk-icon name="plus" [size]="16" />
    New ticket
  </a>
</tk-page-header>
```

Exactly one `<h1>` per page. The subtitle carries live numbers where they exist
— *"248 tickets · 18 SLA at risk"* — never a restatement of the title. If there
is nothing true and specific to say, leave it out.

### 4.2 Section rhythm

A page body is one `<div class="space-y-6">`. Every child is a section: a card, a
grid of cards, or a table card. No bare margins between them.

### 4.3 The four page shapes

| Shape | Used by | Structure |
|---|---|---|
| **Overview** | Dashboard, Analytics | KPI grid → chart row → panel row → recent list |
| **Index** | Tickets, Members, Teams, KB, Canned, Problems | filter bar → bulk bar → table card → pagination |
| **Record** | Ticket detail, Customer profile | 2-column at `xl`: main `2fr` + rail `1fr`; stacks below |
| **Settings** | the 13 admin pages | one `max-w-[720px]` column of form cards |

```html
<!-- Overview: KPI grid -->
<div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">…</div>

<!-- Record: main + rail -->
<div class="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
  <div class="space-y-5 xl:col-span-2">…</div>
  <div class="space-y-5">…</div>
</div>
```

Grid columns for the KPI row:

```ts
gridTemplateColumns: {
  xs: 'repeat(2, 1fr)',
  md: 'repeat(3, 1fr)',
  xl: 'repeat(6, 1fr)',
}
```

---

## 5. The ticket detail decision

The React app used a three-pane agent workspace (rail | list | conversation |
details) at `/dashboard/tickets/:id`, escaping the shell entirely.

**The Angular port takes the Index + Record shape instead** — a table at
`/dashboard/tickets`, a 2-column page at `/dashboard/tickets/:id` — because the
sidebar's saved views already do the filtering the list pane existed for, and a
280px sidebar plus a 300px list plus a 300px rail leaves too little for the
conversation itself.

If high-volume triage later proves this wrong, the three-pane can come back as a
"Focus" toggle on the list rather than as the default. Don't reintroduce it
silently on one screen — that is how a product ends up with two navigation
models.

---

## 6. Customer-facing shells — outside this system

Customer surfaces keep their own frame:

- workspace `primaryColor` header bar, workspace logo, `pageTitle`
- page background `#F6F4FA`, cards white with `#E9E4F5` border
- **always light** — no colour-mode toggle, no dark tokens
- "Powered by Trackly" footer unless `hidePoweredBy`
- max width 560 (forms) / 720 (portal lists)

Which surfaces: `/submit`, `/kb`, `/chat`, `/csat/:id`, `/tickets/:id` (guest),
`/invite/:token`, `/portal/*`, `/login?workspace=slug`, the widget, and every
notification email.

The tokens in `tokens.md` describe **Trackly's** palette. On a customer surface
the only colour that matters is `branding.primaryColor`. Typography, spacing,
radius and motion tokens still apply — they are brand-neutral.

---

## 7. Z-index

One ladder, used everywhere. Nothing in the app may invent a new level.

| Layer | Class |
|---|---|
| Sticky table header | `z-[1]` |
| Top bar | `z-30` |
| Menu/dropdown backdrop | `z-40` |
| Sidebar, open dropdown | `z-50` |
| Modal/drawer backdrop | `z-[60]` (`.overlay`) |
| Modal, drawer | `z-[61]` |
| Command palette | `z-[81]` — it can be opened *from* a modal |
| Toasts | `z-[90]` — must survive everything |

A literal `z-[9999]` in a diff means someone lost this argument with the stacking
context rather than winning it; find the real parent.

---

## 8. Responsive rules

| Rule | Why |
|---|---|
| No page scrolls horizontally at 380px | phones exist; tables scroll **inside** their card |
| Tables get `overflow-x-auto` on a wrapper **and** `min-w-[…]` on the `<table>` | both are needed; either alone still scrolls the page |
| The Record rail stacks **below** the main column under `xl` | reading order stays sensible |
| KPI grid is 2-up on `xs` | five 1-up tiles is a scroll marathon |
| Top-bar search collapses to an icon `< sm` | the ⌘K hint is meaningless on touch |
| Sidebar slides in `< lg` | 280px of a 1024px screen is too much |
| Row actions are always visible under `@media (hover: none)` | there is no hover on a phone, so a hover-reveal action is unreachable |
