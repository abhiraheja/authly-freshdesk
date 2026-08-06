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

| Purpose | Light | Dark | MUI key |
|---|---|---|---|
| Page background | `#F8FAFC` | `#101013` | `background.default` |
| Card / panel | `#FFFFFF` | `#1B1B1F` | `background.paper` |
| Inset fill (search bars, thread bg, inputs) | `#F1F5F9` | `rgba(255,255,255,.045)` | `surfaceMuted` |
| Sidebar | `rgba(255,255,255,.72)` + blur | `rgba(24,24,27,.66)` + blur | `glass.light` / `glass.dark` |
| Border | `#E2E8F0` | `rgba(255,255,255,.09)` | `divider` |
| Text primary | `#0F172A` | `#F4F4F5` | `text.primary` |
| Text secondary | `#64748B` | `#A1A1AA` | `text.secondary` |

**Dark greys are zinc, not slate.** The source prototype used slate
(`#0F172A` / `slate-800`); Trackly moved to zinc deliberately so the chrome does
not read as blue. Do not revert this — it is a later decision than the prototype.

### 1.3 Tone scale — the status/priority/severity system

One tone table drives every coloured chip, dot, meter and badge in the product.
Each tone carries three values so it can be used as a **soft badge** (`bg`+`fg`),
a **dot or bar** (`solid`), or a **tinted icon chip** (`bg`+`fg`).

Crucially the `fg` differs per colour scheme — this is the fix for the old
`STATUS_CHIP` map, whose fixed pastel hexes were illegible in dark mode.

```ts
// theme.ts — light
tone: {
  indigo: { bg: 'rgba(79,70,229,.10)',   fg: '#4338CA', solid: '#4F46E5' },
  blue:   { bg: 'rgba(59,130,246,.12)',  fg: '#2563EB', solid: '#3B82F6' },
  amber:  { bg: 'rgba(245,158,11,.14)',  fg: '#B45309', solid: '#F59E0B' },
  green:  { bg: 'rgba(16,185,129,.14)',  fg: '#059669', solid: '#10B981' },
  red:    { bg: 'rgba(239,68,68,.12)',   fg: '#DC2626', solid: '#EF4444' },
  slate:  { bg: 'rgba(100,116,139,.14)', fg: '#475569', solid: '#64748B' },
  violet: { bg: 'rgba(124,58,237,.12)',  fg: '#6D28D9', solid: '#7C3AED' },
}

// theme.ts — dark
tone: {
  indigo: { bg: 'rgba(129,140,248,.16)', fg: '#A5B4FC', solid: '#818CF8' },
  blue:   { bg: 'rgba(96,165,250,.18)',  fg: '#93C5FD', solid: '#60A5FA' },
  amber:  { bg: 'rgba(251,191,36,.18)',  fg: '#FCD34D', solid: '#FBBF24' },
  green:  { bg: 'rgba(52,211,153,.18)',  fg: '#6EE7B7', solid: '#34D399' },
  red:    { bg: 'rgba(248,113,113,.18)', fg: '#FCA5A5', solid: '#F87171' },
  slate:  { bg: 'rgba(148,163,184,.16)', fg: '#CBD5E1', solid: '#94A3B8' },
  violet: { bg: 'rgba(167,139,250,.18)', fg: '#C4B5FD', solid: '#A78BFA' },
}
```

### 1.4 Semantic → tone mapping

Never pick a tone by eye. Look it up:

| Domain | Value | Tone |
|---|---|---|
| **Status** | open | `blue` |
| | pending | `amber` |
| | resolved | `green` |
| | closed | `slate` |
| **Priority** | low | `slate` |
| | medium | `blue` |
| | high | `amber` |
| | urgent | `red` |
| **SLA** | on track | `green` |
| | due < 1h | `amber` |
| | overdue | `red` |
| **Role** | admin | `violet` |
| | agent | `indigo` |
| | customer | `slate` |
| **Delta** | improvement | `green` |
| | regression | `red` |

These maps live in `lib/format.ts` as `STATUS_TONE`, `PRIORITY_TONE`,
`ROLE_TONE`. Adding a status means adding one row there, nothing else.

### 1.5 Chart series

Charts get their own ordered ramp so a series keeps its colour across screens:

| Slot | Light | Dark | Conventional meaning |
|---|---|---|---|
| 1 | `#4F46E5` | `#818CF8` | created / total / primary series |
| 2 | `#10B981` | `#34D399` | resolved / success |
| 3 | `#F59E0B` | `#FBBF24` | pending / at-risk |
| 4 | `#3B82F6` | `#60A5FA` | open / informational |
| 5 | `#94A3B8` | `#71717A` | closed / inactive |

Chart track (the unfilled part of a meter or donut) is `surfaceMuted`.

---

## 2. Typography

Inter, loaded in `index.html`. Nine steps — **no other font sizes exist**.

| Name | MUI variant | px | Weight | Tracking | Use |
|---|---|---|---|---|---|
| display | `h3` | 30 | 800 | −0.02em | report figures, big KPI numbers |
| pageTitle | `h4` | 24 | 800 | −0.02em | one per page, top of `<PageHeader>` |
| sectionTitle | `h5` | 20 | 700 | −0.01em | ticket subject, dialog title |
| cardTitle | `h6` | 16 | 700 | — | panel headings |
| body | `body1` | 14 | 400 | — | default text, table cells, inputs |
| bodyStrong | `body1` + `fontWeight:600` | 14 | 600 | — | names, emphasised values |
| meta | `body2` | 12 | 400 | — | timestamps, helper text, counts |
| label | `overline` | 11 | 700 | +0.06em, uppercase | section labels, table headers |
| micro | `caption` | 10 | 600 | — | kbd hints, count pills |

Use the variant, not a raw `fontSize`. `variant="h4"` with `component="h1"` keeps
the heading semantics correct while using the page-title style.

> The pre-redesign code used fifteen ad-hoc sizes (`13.5`, `14.5`, `16.5`, `26`…).
> Any file you touch should lose them.

Line heights: 1.2 display → 1.25 pageTitle → 1.3 sectionTitle → 1.4 cardTitle →
1.6 body → 1.5 meta. Long-form prose (KB articles, ticket descriptions) uses 1.7.

---

## 3. Spacing

MUI's 8px unit. `sx={{ p: 3 }}` is 24px.

| Context | Value | px |
|---|---|---|
| Page padding | `px: { xs: 2, sm: 3, lg: 4 }` | 16 / 24 / 32 |
| Content max width | `1600` | — |
| Gap between page sections | `3` | 24 |
| Grid gap — KPI tiles | `2` | 16 |
| Grid gap — panels | `3` | 24 |
| Card padding — standard | `3` | 24 |
| Card padding — compact (list rows, rails) | `2.5` | 20 |
| Stack gap inside a card | `1.5` | 12 |
| Nav item padding | `px: 1.5, py: 1.25` | 12 / 10 |
| Table cell padding | `2` | 16 |
| Form field gap | `2.5` | 20 |

Two rules that keep pages from drifting:
1. A page is a vertical `<Stack spacing={3}>` of sections. Nothing between them.
2. Inside a card, only `1.5` and `2` gaps. If you need `2.5`, it's two cards.

---

## 4. Radius

| Token | px | Use |
|---|---|---|
| `sm` | 8 | inner chips, icon buttons, dense controls |
| `md` | 12 | buttons, inputs, nav items, menu items |
| `lg` | 14 | default (`shape.borderRadius`), list rows, small cards |
| `xl` | 18 | panels, dialogs, command palette, KPI tiles |
| pill | 999 | chips, count badges, avatars, meters |

Bubbles in a conversation thread use `13px` with the corner nearest the author
squared to `4px` — that asymmetry is what makes them read as speech.

---

## 5. Elevation

| Token | Value | Use |
|---|---|---|
| `shadows.soft` | `0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.06)` | every resting card |
| `shadows.lift` | `0 10px 40px -8px rgba(79,70,229,.25)` | hover, contained primary buttons |
| `glass.light` | `blur(16px) saturate(160%)` + `rgba(255,255,255,.72)` | sidebar, topbar |
| `glass.dark` | `blur(16px) saturate(160%)` + `rgba(24,24,27,.66)` | sidebar, topbar |

Cards are `<Paper variant="outlined">` **plus** an explicit `boxShadow` — the
outline carries the structure, the shadow carries the depth. Never use MUI's
numbered `elevation` prop.

In dark mode `shadows.soft` is nearly invisible by design; the `divider` border
does the work. Do not compensate by darkening the shadow.

---

## 6. Motion

| Token | Value |
|---|---|
| `motion.fast` | `150ms` |
| `motion.base` | `200ms` |
| `motion.slow` | `400ms` |
| `motion.ease` | `cubic-bezier(.4, 0, .2, 1)` |

Four motions, and only four:

| Name | Spec | Applies to |
|---|---|---|
| **floatIn** | `opacity 0→1`, `translateY(8px)→0`, slow, `both` | page/section mount |
| **shimmer** | overlay `translateX(-100%)→100%`, `1.4s` infinite | skeletons |
| **lift** | `translateY(-2px)` + `shadows.lift`, base | hover on clickable cards |
| **press** | `scale(.97)`, fast | `:active` on buttons |

Both keyframes are declared globally in `MuiCssBaseline` as
`trackly-float-in` and `trackly-shimmer`, so any `sx` can reference them.

**Reduced motion is not optional.** The same `MuiCssBaseline` block collapses all
animation and transition durations under `prefers-reduced-motion: reduce`.

---

## 7. Layout constants

```ts
export const layout = {
  sidebarWidth: 280,     // permanent ≥ lg, temporary Drawer below
  topbarHeight: 64,
  contentMaxWidth: 1600,
  railWidth: 64,         // agent workspace icon rail only
} as const
```

---

## 8. The theme.ts additions

Everything above compiles down to this. Append to the existing file — the brand,
`shadows` and `glass` exports stay as they are.

```ts
import type { CSSProperties } from 'react'

export const layout = {
  sidebarWidth: 280,
  topbarHeight: 64,
  contentMaxWidth: 1600,
  railWidth: 64,
} as const

export const motion = {
  fast: '150ms',
  base: '200ms',
  slow: '400ms',
  ease: 'cubic-bezier(.4, 0, .2, 1)',
} as const

// Reusable sx fragments so components don't re-declare the same animation.
export const floatIn = {
  animation: `trackly-float-in ${motion.slow} ${motion.ease} both`,
} satisfies CSSProperties

export const hoverLift = {
  transition: `box-shadow ${motion.base} ${motion.ease}, transform ${motion.base} ${motion.ease}`,
  '&:hover': { boxShadow: shadows.lift, transform: 'translateY(-2px)' },
}

const lightTone = {
  indigo: { bg: 'rgba(79,70,229,.10)',   fg: '#4338CA', solid: '#4F46E5' },
  blue:   { bg: 'rgba(59,130,246,.12)',  fg: '#2563EB', solid: '#3B82F6' },
  amber:  { bg: 'rgba(245,158,11,.14)',  fg: '#B45309', solid: '#F59E0B' },
  green:  { bg: 'rgba(16,185,129,.14)',  fg: '#059669', solid: '#10B981' },
  red:    { bg: 'rgba(239,68,68,.12)',   fg: '#DC2626', solid: '#EF4444' },
  slate:  { bg: 'rgba(100,116,139,.14)', fg: '#475569', solid: '#64748B' },
  violet: { bg: 'rgba(124,58,237,.12)',  fg: '#6D28D9', solid: '#7C3AED' },
}

const darkTone = {
  indigo: { bg: 'rgba(129,140,248,.16)', fg: '#A5B4FC', solid: '#818CF8' },
  blue:   { bg: 'rgba(96,165,250,.18)',  fg: '#93C5FD', solid: '#60A5FA' },
  amber:  { bg: 'rgba(251,191,36,.18)',  fg: '#FCD34D', solid: '#FBBF24' },
  green:  { bg: 'rgba(52,211,153,.18)',  fg: '#6EE7B7', solid: '#34D399' },
  red:    { bg: 'rgba(248,113,113,.18)', fg: '#FCA5A5', solid: '#F87171' },
  slate:  { bg: 'rgba(148,163,184,.16)', fg: '#CBD5E1', solid: '#94A3B8' },
  violet: { bg: 'rgba(167,139,250,.18)', fg: '#C4B5FD', solid: '#A78BFA' },
}

const lightChart = ['#4F46E5', '#10B981', '#F59E0B', '#3B82F6', '#94A3B8']
const darkChart  = ['#818CF8', '#34D399', '#FBBF24', '#60A5FA', '#71717A']
```

Inside `createTheme`:

```ts
colorSchemes: {
  light: { palette: { /* …existing… */ tone: lightTone, chart: lightChart } },
  dark:  { palette: { /* …existing… */ tone: darkTone,  chart: darkChart  } },
},

typography: {
  fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  h3: { fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.2 },
  h4: { fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.25 },
  h5: { fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.3 },
  h6: { fontSize: 16, fontWeight: 700, lineHeight: 1.4 },
  body1: { fontSize: 14, lineHeight: 1.6 },
  body2: { fontSize: 12, lineHeight: 1.5 },
  overline: {
    fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
    textTransform: 'uppercase', lineHeight: 2,
  },
  caption: { fontSize: 10, fontWeight: 600, lineHeight: 1.4 },
  button: { textTransform: 'none', fontWeight: 600, fontSize: 14 },
},

components: {
  MuiCssBaseline: {
    styleOverrides: {
      '*': { WebkitFontSmoothing: 'antialiased' },
      '::-webkit-scrollbar': { width: 10, height: 10 },
      '::-webkit-scrollbar-thumb': {
        background: 'rgba(100,116,139,.35)',
        borderRadius: 999,
        border: '2px solid transparent',
        backgroundClip: 'padding-box',
      },
      '@keyframes trackly-float-in': {
        from: { opacity: 0, transform: 'translateY(8px)' },
        to: { opacity: 1, transform: 'translateY(0)' },
      },
      '@keyframes trackly-shimmer': {
        to: { transform: 'translateX(100%)' },
      },
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 12,
        transition: `transform ${motion.fast} ${motion.ease}`,
        '&:active': { transform: 'scale(.97)' },
      },
      sizeLarge: { padding: '13px 16px' },
    },
    variants: [
      { props: { variant: 'contained', color: 'primary' }, style: { boxShadow: shadows.lift } },
    ],
  },
  MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
  MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
  MuiTooltip: { defaultProps: { arrow: true } },
},
```

Module augmentation at the bottom of the file:

```ts
interface ToneColor { bg: string; fg: string; solid: string }
type ToneName = 'indigo' | 'blue' | 'amber' | 'green' | 'red' | 'slate' | 'violet'
type TonePalette = Record<ToneName, ToneColor>

declare module '@mui/material/styles' {
  interface Palette {
    surfaceMuted: string
    tone: TonePalette
    chart: string[]
  }
  interface PaletteOptions {
    surfaceMuted?: string
    tone?: TonePalette
    chart?: string[]
  }
}
```

---

## 9. Dark-mode safety checklist

`cssVariables.colorSchemeSelector: 'class'` means **semantic keys switch, literal
hex does not**.

| Never write | Write instead |
|---|---|
| `bgcolor: '#fff'` | `bgcolor: 'background.paper'` |
| `bgcolor: '#F1F5F9'` | `bgcolor: 'surfaceMuted'` |
| `borderColor: '#E2E8F0'` | `borderColor: 'divider'` |
| `color: '#0F172A'` | `color: 'text.primary'` |
| `color: '#64748B'` | `color: 'text.secondary'` |
| `bgcolor: '#EEF2FF'` (active nav) | `bgcolor: 'action.selected'` |
| `sx={{ bgcolor: STATUS_CHIP[s].bg }}` | `<ToneChip tone={STATUS_TONE[s].tone} …>` |

`border: '1px solid'` with no colour resolves to `currentColor` and inherits the
text colour. **Always** pair it with `borderColor: 'divider'`.

### The two deliberate exceptions

1. **The agent workspace icon rail** is `#18181B` in both schemes — it is chrome,
   not content.
2. **The brand gradient** is fixed in both schemes.

Everything else must invert. Customer-facing surfaces don't participate at all —
they are always light and wear the workspace's colour (see `layout.md` § 6).
