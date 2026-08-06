# Tokens

Every value a Trackly screen may use. If a number is not on this page, it does
not go in a component — add it to the token layer instead of inventing a one-off.

Two files own the whole system:

| File | Owns |
|---|---|
| `frontend-angular/src/styles.scss` | the token values (`:root` and `.dark`) **and** the component CSS layer (`.btn`, `.card`, `.badge`, …) |
| `frontend-angular/src/tailwind.css` | `@theme inline` — maps those tokens onto Tailwind utilities, plus the `.dark` variant |

Colours are stored as **space-separated RGB channels** (`--primary: 79 70 229`),
not hex. That is what makes `bg-primary/12` work: Tailwind composes
`rgb(var(--primary) / 0.12)`. A hex token would break every opacity utility in
the codebase.

`@theme inline` matters too — it makes utilities reference the CSS variables
rather than snapshot their values, which is why flipping one class on `<html>`
re-themes the entire app with no rebuild and no duplicated CSS.

---

## 1. Colour

### 1.1 Brand ramp

| Token | Light | Dark | Use |
|---|---|---|---|
| `primary.main` | `#4F46E5` | `#A5B4FC` | Trackly actions, active nav, focus ring |
| `primary.dark` | `#4338CA` | `#4F46E5` | hover on contained buttons |
| `secondary.main` | `#7C3AED` | `#C4B5FD` | avatars, gradient partner |
| gradient | `linear-gradient(135deg, #4F46E5, #A78BFA)` | same | logo mark, AI panels, hero chips |

The gradient is intentionally identical in both schemes — it is a brand asset,
not a surface.

### 1.2 Surfaces

| Purpose | Light | Dark | Utility |
|---|---|---|---|
| Page background | `#F8FAFC` | `#101013` | `bg-background` |
| Card / panel | `#FFFFFF` | `#1B1B1F` | `bg-card` |
| Inset fill (search bars, composers, inputs) | `#F1F5F9` | `#252529` | `bg-muted` |
| Hover / selected | `#EEF2FF` | `#2C2C34` | `bg-accent` |
| Sidebar | `#FFFFFF` + `.glass` | `#18181B` + `.glass` | `bg-sidebar` |
| Border | `#E2E8F0` | `#303035` | `border-border` |
| Text primary | `#0F172A` | `#F4F4F5` | `text-foreground` |
| Text secondary | `#64748B` | `#A1A1AA` | `text-muted-foreground` |

**Dark greys are zinc, not slate.** The source prototype used slate
(`#0F172A` / `slate-800`); Trackly moved to zinc deliberately so the chrome does
not read as blue. Do not revert this — it is a later decision than the prototype.

### 1.3 Tone scale — the status/priority/severity system

**Six tones** drive every coloured chip, dot, meter and badge:

`primary · info · success · warning · danger · neutral`

Each has two tokens. The base colour is used solid — dots, meter fills, icons.
The `-ink` variant is the **readable foreground on a soft tint of itself**:

| Tone | Base (light → dark) | Ink (light → dark) |
|---|---|---|
| `primary` | `#4F46E5` → `#A5B4FC` | `#4338CA` → `#A5B4FC` |
| `info` | `#3B82F6` → `#60A5FA` | `#2563EB` → `#93C5FD` |
| `success` | `#10B981` → `#34D399` | `#059669` → `#6EE7B7` |
| `warning` | `#F59E0B` → `#FBBF24` | `#B45309` → `#FCD34D` |
| `danger` | `#EF4444` → `#F87171` | `#DC2626` → `#FCA5A5` |
| `neutral` | `#64748B` → `#94A3B8` | `#475569` → `#CBD5E1` |

The split exists because `--warning` (`#F59E0B`) on a `warning/14` tint measures
about 2:1 — unreadable. `--warning-ink` (`#B45309`) passes. In dark mode both
lighten, so the same `.badge-warning` rule works in both schemes with no
override. **This is why badge colours must never be written by hand.**

### 1.4 Semantic → tone mapping

Never pick a tone by eye. Look it up:

| Domain | Value | Tone |
|---|---|---|
| **Status** | open | `info` |
| | pending | `warning` |
| | resolved | `success` |
| | closed | `neutral` |
| **Priority** | low | `neutral` |
| | medium | `info` |
| | high | `warning` |
| | urgent | `danger` |
| **SLA** | on track | `success` |
| | due < 1h | `warning` |
| | overdue | `danger` |
| **Role** | admin | `primary` |
| | agent | `info` |
| | customer | `neutral` |
| **Delta** | improvement | `success` |
| | regression | `danger` |

These maps live in `src/app/core/format.ts` as `STATUS_TONE`, `PRIORITY_TONE`,
`ROLE_TONE`, read through `toneFor(map, key)` — which falls back to a neutral
chip carrying the raw value, so an unrecognised status renders visibly instead
of disappearing. Adding a status means adding one row there, nothing else.

### 1.5 Chart series

Charts get their own ordered ramp so a series keeps its colour across screens:

| Slot | Light | Dark | Conventional meaning |
|---|---|---|---|
| 1 | `#4F46E5` | `#818CF8` | created / total / primary series |
| 2 | `#10B981` | `#34D399` | resolved / success |
| 3 | `#F59E0B` | `#FBBF24` | pending / at-risk |
| 4 | `#3B82F6` | `#60A5FA` | open / informational |
| 5 | `#94A3B8` | `#71717A` | closed / inactive |

Read them in a template as `rgb(var(--chart-3))`. The track (the unfilled part
of a meter or donut) is `bg-muted` / `text-muted`.

---

## 2. Typography

Inter, loaded in `index.html`. Nine steps — **no other font sizes exist**.

| Name | Utility | px | Weight | Use |
|---|---|---|---|---|
| display | `text-display` | 30 | 800 | report figures, big KPI numbers |
| page title | `text-page` | 24 | 800 | one per page, in `tk-page-header` |
| section | `text-section` | 20 | 700 | ticket subject, dialog title |
| card title | `text-card-title` | 16 | 700 | panel headings (`.card-title`) |
| body | `text-body` | 14 | 400 | default text, table cells, inputs |
| meta | `text-meta` | 12 | 400 | timestamps, helper text, counts |
| label | `text-label` | 11 | 700 | uppercase section + table headers |
| micro | `text-micro` | 10 | 600 | kbd hints, count pills |

Headings add `font-display` (which only sets `letter-spacing: -0.02em`; the face
is the same Inter). Weight and case come from utilities: `font-extrabold`,
`uppercase tracking-[0.06em]`.

> The React app it replaces drifted to fifteen ad-hoc sizes (`13.5`, `14.5`,
> `16.5`, `26`…) and every screen ended up slightly different. Eight steps, and
> a raw `text-[15px]` in a diff is a bug.

Line heights: 1.2 display → 1.25 pageTitle → 1.3 sectionTitle → 1.4 cardTitle →
1.6 body → 1.5 meta. Long-form prose (KB articles, ticket descriptions) uses 1.7.

---

## 3. Spacing

Tailwind's 4px unit. `p-6` is 24px.

| Context | Utility | px |
|---|---|---|
| Page padding | `p-4 md:p-6` | 16 / 24 |
| Content max width | `max-w-[1600px] mx-auto` | — |
| Gap between page sections | `space-y-6` | 24 |
| Grid gap — KPI tiles | `gap-4` | 16 |
| Grid gap — panels | `gap-6` | 24 |
| Card padding — standard | `.card-body` | 20 |
| Card padding — compact | `tk-card dense` | 16 |
| Stack gap inside a card | `space-y-3` | 12 |
| Nav item padding | `.nav-row` | 12 / 10 |
| Table cell padding | `.table td` | 16 / 14 |
| Form field gap | `space-y-5` | 20 |

Two rules that keep pages from drifting:
1. A page body is one `<div class="space-y-6">` of sections. Nothing between them.
2. Inside a card, only `space-y-3` and `gap-4`. If you need more, it's two cards.

---

## 4. Radius

| Utility | px | Use |
|---|---|---|
| `rounded-md` | 8 | inner chips, dense controls (`--radius-chip`) |
| `rounded-lg` | 12 | buttons, inputs, nav items, menu items (`--radius-control`) |
| `rounded-xl` | 14 | list rows, menus, alerts (`--radius`) |
| `rounded-2xl` | 18 | cards, dialogs, command palette (`--radius-panel`) |
| `rounded-full` | 999 | chips, count pills, meters, round avatars |

Nothing in the product exceeds 18px except pills. Conversation bubbles use 13px
with the corner nearest the author squared to 4px — that asymmetry is what makes
them read as speech.

---

## 5. Elevation

| Token | Value | Use |
|---|---|---|
| `--shadow-soft` | `0 1px 2px rgb(15 23 42/.04), 0 8px 24px rgb(15 23 42/.06)` | every resting card |
| `--shadow-lift` | `0 10px 40px -8px rgb(79 70 229/.25)` | hover, primary buttons |
| `--shadow-menu` | `0 12px 32px -8px rgb(15 23 42/.16)` | menus, dialogs, drawers |
| `.glass` | `blur(16px) saturate(160%)` over the surface at 72% / 66% | sidebar, top bar |

Cards carry **both** a `1px` border and `--shadow-soft`: the border carries the
structure, the shadow carries the depth. `.card` already does this — don't add
elevation on top.

All three shadows have dark-mode values that swap the indigo/slate tint for pure
black at higher alpha. In dark mode `--shadow-soft` is nearly invisible by
design and the border does the work; do not compensate by darkening it further.

---

## 6. Motion

| Token | Value |
|---|---|
| `--motion-fast` | `150ms` |
| `--motion-base` | `200ms` |
| `--motion-slow` | `400ms` |
| `--motion-ease` | `cubic-bezier(.4, 0, .2, 1)` |

Four motions, and only four:

| Name | Spec | Applies to |
|---|---|---|
| **float-in** | `opacity 0→1`, `translateY(8px)→0`, slow | overlays, page/section mount |
| **shimmer** | overlay `translateX(-100%→100%)`, `1.4s` infinite | skeletons |
| **lift** | `translateY(-2px)` + `--shadow-lift`, base | hover on clickable cards |
| **press** | `scale(.97)`, fast | `:active` on buttons |

`float-in` is the `.animate-float-in` class; `shimmer` is baked into
`.skeleton`; `lift` is `.card-interactive`; `press` is on `.btn:active`. You
should never hand-write any of the four.

**Reduced motion is not optional.** `styles.scss` collapses every animation and
transition duration under `prefers-reduced-motion: reduce`.

---

## 7. Layout constants

| Constant | Value | Where |
|---|---|---|
| Sidebar width | `280px` | `w-[280px]`, permanent ≥ `lg`, slide-in below |
| Top bar height | `64px` | `h-16` — brand block matches it exactly |
| Content max width | `1600px` | `max-w-[1600px]` inside the scrolling `<main>` |

---

## 8. Dark-mode and Tailwind safety

### 8.1 The failure that has no error message

Tailwind v4 emits only the classes it can find as **literal strings** in the
source. A class built at runtime produces no CSS at all — no warning, no build
error, just an unstyled element.

```ts
// ❌ compiles to nothing
protected classes = computed(() => `bg-${this.tone()}/10 text-${this.tone()}-ink`);

// ✅ static lookup
const TINT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary-ink',
  danger:  'bg-danger/12 text-danger-ink',
  // …
};

// ✅ or a design-system class, defined in styles.scss
protected classes = computed(() => `alert alert-${this.tone()}`);
```

The second form works because `.alert-danger` is real CSS in `styles.scss`, not
a Tailwind utility — Tailwind never needs to see it. Prefer it whenever a
component has more than a colour varying by tone.

### 8.2 Semantic utilities, never raw colour

Dark mode is one class on `<html>`. Token-backed utilities follow it; literal
colours do not.

| Never write | Write instead |
|---|---|
| `bg-white` | `bg-card` |
| `bg-slate-50`, `bg-[#F1F5F9]` | `bg-muted` |
| `border-slate-200` | `border-border` |
| `text-slate-900` | `text-foreground` |
| `text-slate-500` | `text-muted-foreground` |
| `bg-indigo-50` (active nav) | `bg-accent` or `.nav-active` |
| a hand-written status chip | `<tk-badge [tone]="…">` |

Opacity variants are how you get a tint: `bg-primary/10`, `border-danger/30`,
`ring-ring/50`. They only work because the tokens are RGB channels.

### 8.3 The deliberate exceptions

Three things are fixed in both schemes, on purpose:

1. **The brand gradient** (`.brand-gradient`) — it is a brand asset, not a surface.
2. **Avatar colours** (`avatarColor()` in `core/format.ts`) — an avatar's colour
   is part of how a person is recognised at a glance; shifting it with the theme
   would break that.
3. **Customer-facing surfaces** don't participate at all. They are always light
   and wear `branding.primaryColor`; a branded route calls
   `ThemeService.forceLight()` on entry and disposes it on exit.

---

