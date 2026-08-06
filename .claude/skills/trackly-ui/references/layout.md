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

`AppShell` owns the sidebar + topbar and renders `children` into the content
column. It replaces the old top-nav-with-Admin-dropdown entirely.

```tsx
<Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
  <SidebarNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    <TopBar onMenu={() => setMobileOpen(true)} />
    <Box
      component="main"
      sx={{
        flex: 1,
        width: '100%',
        maxWidth: layout.contentMaxWidth,
        mx: 'auto',
        px: { xs: 2, sm: 3, lg: 4 },
        py: { xs: 2, sm: 3 },
      }}
    >
      {children}
    </Box>
  </Box>
</Box>
```

`minWidth: 0` on the content column is load-bearing — without it a wide table
pushes the flex container past the viewport and the whole page scrolls sideways.

---

## 2. Sidebar

`280px`, glass background, `borderRight: 1px solid divider`, full height,
`position: sticky` at `top: 0`. Three stacked regions.

### 2.1 Brand block — 64px, matches the topbar

```tsx
<Stack direction="row" spacing={1.5} sx={{
  height: layout.topbarHeight, alignItems: 'center', px: 2.5,
  borderBottom: '1px solid', borderColor: 'divider',
}}>
  <Box sx={{
    width: 36, height: 36, borderRadius: '12px',
    background: 'linear-gradient(135deg, #4F46E5, #A78BFA)',
    display: 'grid', placeItems: 'center', color: '#fff',
    boxShadow: shadows.lift,
  }}>
    <LifeBuoy size={18} />
  </Box>
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>
      Trackly
    </Typography>
    <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: .25 }}>
      {workspace.name}
    </Typography>
  </Box>
</Stack>
```

### 2.2 Nav — scrollable, grouped

Groups are separated by `24px`, each headed by a `variant="overline"` label at
`px: 1.5`. The groups are fixed:

| Group | Items |
|---|---|
| **Overview** | Dashboard |
| **Tickets** | All tickets · Inbox · Assigned to me · Open · Pending · Resolved · Closed |
| **Workspace** | Live chat · Problems · Knowledge base · Canned responses |
| **Admin** *(admins only)* | Analytics · Announcements · Members · Teams · SLA policies · Automation · AI copilot · Messaging · Widget · Email · Branding · SSO · Domains |

The **Tickets** group is the important change: status filters become
first-class navigation with live counts instead of a dropdown buried in the list
pane. Each maps to `/dashboard/tickets?view=<key>`.

Admin has thirteen items — render it inside a `<Collapse>` that is open when the
route starts with `/admin`, so it does not dominate the rail when collapsed.

### 2.3 NavItem anatomy

```
┌─┬────────────────────────────────────────┐
│▍│  ●  Open                          72   │   ← 4px bar | dot/icon | label | count
└─┴────────────────────────────────────────┘
   40px tall · radius 12 · px 1.5 · gap 1.5
```

| State | Style |
|---|---|
| rest | `color: text.secondary` |
| hover | `bgcolor: action.hover` |
| active | `color: primary.main`, left gradient, bar visible |

The active background is a horizontal fade, not a flat fill:

```ts
active: {
  background: (t) => t.palette.mode === 'dark'
    ? 'linear-gradient(90deg, rgba(129,140,248,.20), rgba(129,140,248,.02))'
    : 'linear-gradient(90deg, rgba(79,70,229,.14), rgba(79,70,229,.02))',
}
```

With `cssVariables` enabled, prefer defining both in the `tone` palette and
reading `palette.tone.indigo.bg` rather than branching on `mode`.

The 4px bar is an absolutely-positioned `<Box>` at `left: 0`, `top/bottom: 6px`,
`borderRadius: 999`, `bgcolor: primary.main`, `opacity: 0 → 1`.

Trailing count: `variant="caption"`, `bgcolor: tone.indigo.bg`,
`color: primary.main`, `px: 1`, `borderRadius: 999`. Leading status dot: 8px
circle in `tone[x].solid`.

### 2.4 Footer — AI copilot card

Gradient panel pinned to the bottom, `p: 2`:

```tsx
<Box sx={{
  m: 2, p: 2, borderRadius: '18px', position: 'relative', overflow: 'hidden',
  background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
  color: '#fff', boxShadow: shadows.lift,
}}>
  <Box sx={{
    position: 'absolute', right: -24, top: -24, width: 96, height: 96,
    borderRadius: '50%', bgcolor: 'rgba(255,255,255,.10)',
  }} />
  …
</Box>
```

Render it only when the AI copilot is actually configured
(`getAiAvailability().available`). An advert for a disabled feature is worse
than empty space.

### 2.5 Responsive

| Breakpoint | Behaviour |
|---|---|
| `≥ lg` (1200) | `<Drawer variant="permanent">`, always visible |
| `< lg` | `<Drawer variant="temporary">` + backdrop, opened by the topbar menu button, closes on navigate |

Use one `<Drawer>` with the variant swapped by `useMediaQuery(theme.breakpoints.up('lg'))`
so the nav markup exists once.

---

## 3. TopBar

`64px`, glass, `position: sticky`, `borderBottom: 1px solid divider`,
`zIndex: appBar`. Left to right:

| Slot | Notes |
|---|---|
| Menu button | `< lg` only |
| **Search / ⌘K trigger** | `max-width: 420`, `bgcolor: surfaceMuted`, radius 12, search icon + placeholder + `<kbd>⌘K</kbd>`. It is a **button**, not an input — clicking opens the command palette. |
| *spacer* | |
| Primary action | contained "New ticket"; collapses to an icon button `< sm` |
| Notifications | icon button + unread dot + dropdown |
| Colour mode | existing `<ColorModeToggle>` |
| Profile | avatar + name + role + chevron → menu (Profile, Settings, Sign out) |

The topbar is Trackly chrome. On a customer's `/portal` it is replaced by the
workspace-branded header — see § 6.

---

## 4. Page templates

### 4.1 PageHeader — every page starts with one

```tsx
<Stack
  direction={{ xs: 'column', sm: 'row' }}
  spacing={2}
  sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 3 }}
>
  <Box>
    <Typography variant="h4" component="h1">{title}</Typography>
    {subtitle && (
      <Typography variant="body1" color="text.secondary" sx={{ mt: .5 }}>
        {subtitle}
      </Typography>
    )}
  </Box>
  {action}
</Stack>
```

The subtitle carries live numbers where they exist — *"248 total · 72 open · 18
SLA at risk"* — not a restatement of the title.

### 4.2 Section rhythm

A page body is one `<Stack spacing={3}>`. Every child is a section: a panel, a
grid of panels, or a table card. No bare margins between them.

### 4.3 The four page shapes

| Shape | Used by | Structure |
|---|---|---|
| **Overview** | Dashboard, Analytics | KPI grid → chart row → panel row → recent list |
| **Index** | Tickets, Members, Teams, KB, Canned, Problems | filter bar → bulk bar → table card → pagination |
| **Record** | Ticket detail, Customer profile | `xl` 2-column: main `2fr` + rail `1fr`; stacks below `xl` |
| **Settings** | the 13 admin pages | single `maxWidth: 720` column of form panels |

Grid columns for the KPI row:

```ts
gridTemplateColumns: {
  xs: 'repeat(2, 1fr)',
  md: 'repeat(3, 1fr)',
  xl: 'repeat(6, 1fr)',
}
```

Record layout:

```ts
display: 'grid',
gridTemplateColumns: { xs: '1fr', xl: '2fr 1fr' },
gap: 3,
alignItems: 'start',
```

---

## 5. The agent workspace

`/dashboard/tickets/:id` is the one screen that escapes the shell. It is a
full-viewport grid with no page padding:

```ts
gridTemplateColumns: { xs: '64px 1fr', lg: '64px 300px 1fr 300px' },
height: '100vh',
overflow: 'hidden',
```

**Open question — decide before building, don't drift into it.** The reference
design has no three-pane mode: it uses an Index page (table) plus a Record page
(2-column). Two coherent options:

- **A — Replace.** Tickets become a table; opening one goes to a Record page.
  Sidebar saved-views do the filtering. Matches the reference exactly, one fewer
  layout to maintain, better for scanning and bulk actions.
- **B — Keep as focus mode.** Table is the default list; the three-pane stays
  behind a "Focus" toggle for high-volume triage. More to maintain, but faster
  for an agent working a queue.

Whichever is chosen, the icon rail keeps `#18181B` in both schemes and the
sidebar collapses to that rail on this route — never show both.

---

## 6. Customer-facing shells — unchanged

`BrandedFrame` is **not** part of this redesign. Customer surfaces keep their own
shell:

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

| Layer | Value |
|---|---|
| Sticky table header | 1 |
| Sidebar (permanent) | `theme.zIndex.appBar - 1` |
| TopBar | `theme.zIndex.appBar` |
| Drawer (temporary) + backdrop | `theme.zIndex.drawer` |
| Menus, popovers | `theme.zIndex.modal - 1` |
| Command palette, dialogs | `theme.zIndex.modal` |
| Toasts | `theme.zIndex.snackbar` |

Use the theme values, never a literal `9999`.

---

## 8. Responsive rules

| Rule | Why |
|---|---|
| No page scrolls horizontally at 380px | phones exist; tables scroll **inside** their card |
| Tables get `overflow-x: auto` on a wrapper with `minWidth` on the `<table>` | keeps the page still |
| The Record rail stacks **below** the main column under `xl` | reading order stays sensible |
| KPI grid is 2-up on `xs` | six 1-up tiles is a scroll marathon |
| Topbar search collapses to an icon `< sm` | the ⌘K hint is meaningless on touch |
| Sidebar is a temporary Drawer `< lg` | 280px of 1024px is too much |
