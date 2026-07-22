---
name: trackly-ui
description: Build or restyle any Trackly React screen or component — pages, panes, cards, forms, dialogs, admin settings, customer-facing branded surfaces. Use whenever adding UI, choosing colours/spacing, wiring dark mode, or deciding whether a surface is Trackly-branded or workspace-branded. Covers the MUI theme tokens, the two-palette rule, and copy-paste recipes from the real codebase.
---

# Trackly UI

**React 18 + TypeScript + Vite + Material UI v9**, with TanStack Query for data,
React Router v6, React Hook Form + Zod for forms, Zustand for auth state. Do
**not** introduce Tailwind, shadcn, styled-components, or a second UI kit — that
was decided explicitly after a design review (see `docs/trackly-plan.md`).

## The rule that matters most: which brand is this surface?

Trackly is multi-tenant. Every screen belongs to one of two palettes, and mixing
them is the easiest way to break the product.

| | **Trackly-owned** | **Workspace-branded** |
|---|---|---|
| Screens | agent workspace, dashboard, admin settings, login/signup/verify, onboarding | `/submit`, guest ticket view, customer portal, widget, notification emails |
| Colour source | the MUI theme (indigo `#4F46E5`) | `branding.primaryColor` fetched per workspace |
| Dark mode | **yes** — must work in both schemes | **no** — always light; the palette is the customer's brand |
| Wrapper | `<AppShell>` | `<BrandedFrame>` (arrives in Phase 3) |

This is **invariant 6** in `CLAUDE.md`. If you're about to hardcode indigo on a
page a customer sees, stop.

## Design tokens

All tokens live in `frontend/src/theme.ts`. Import them; never re-declare hex.

```ts
import { brand, shadows, glass } from '../theme'
```

| Token | Value | Use for |
|---|---|---|
| `primary` | `#4F46E5` indigo | Trackly actions, active nav, focus |
| `success` / `warning` / `error` / `info` | `#10B981` / `#F59E0B` / `#EF4444` / `#3B82F6` | status chips, SLA states |
| `shadows.soft` | subtle two-layer | resting cards |
| `shadows.lift` | indigo-tinted glow | hover, primary buttons |
| `glass.light` / `glass.dark` | blur(16px) saturate(160%) | app bar, rail |
| radius | `14px` base, `18px` cards | `borderRadius: '18px'` on panels |
| font | Inter (loaded in `index.html`) | everything |

## Dark-mode-safe styling

The theme uses MUI `colorSchemes` with `cssVariables.colorSchemeSelector: 'class'`,
so **semantic palette keys switch automatically**. Hardcoded hex does not.

```tsx
// ✅ inverts correctly
sx={{ bgcolor: 'background.paper', color: 'text.primary', borderColor: 'divider' }}

// ❌ white card that stays white in dark mode
sx={{ bgcolor: '#fff', color: '#334155', border: '1px solid #E2E8F0' }}
```

| Hardcoded | Token |
|---|---|
| `#fff` | `background.paper` |
| `#F8FAFC`, `#F1F5F9` | `surfaceMuted` (custom token) or `background.default` |
| `#E2E8F0` | `divider` |
| `#0F172A`, `#334155` | `text.primary` |
| `#64748B`, `#94A3B8` | `text.secondary` |
| `#EFF6FF` (active nav) | `action.selected` |

**Gotcha:** `border: '1px solid'` with no colour falls back to `currentColor` and
inherits the text colour — always pair it with `borderColor: 'divider'`.

Two deliberate exceptions to the token rule, both in Phase 2 code:
- the agent workspace **icon rail** is hardcoded `#0F172A` — it is chrome, dark in
  both schemes by design;
- **status/priority chips** use fixed pastel pairs from `lib/format.ts` so a
  ticket state reads identically everywhere.

## Component recipes

### Trackly-owned page

```tsx
import { Typography } from '@mui/material'
import { AppShell } from '../components/AppShell'

export function ThingPage() {
  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Thing</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>What this page is for.</Typography>
      {/* content */}
    </AppShell>
  )
}
```

`AppShell` supplies the glass app bar, role-aware nav, colour-mode toggle, avatar
and sign-out.

### Card / panel

```tsx
<Paper variant="outlined" sx={{ borderRadius: '18px', p: 3, boxShadow: shadows.soft }}>
```

### KPI tile

```tsx
<StatCard label="Open" value={count} icon="📂" tone="info" onClick={() => navigate('/dashboard/tickets')} />
```

### Status / priority chip

```tsx
const chip = STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open
<Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg }} />
```

### Data fetching

Always TanStack Query against a typed function in `src/api/`. Never call `fetch`
directly from a component.

```tsx
const { data, isPending } = useQuery({ queryKey: ['tickets', filters], queryFn: () => listTickets(filters) })
const save = useMutation({
  mutationFn: () => updateTicket(id, body),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ticket', id] }),
  onError: (e: Error) => setError(e.message),
})
```

`src/api/client.ts` throws `ApiError` with `.status` — branch on it for 409/403
rather than matching message text.

### Private notes

In the agent conversation pane, internal notes render amber with a dashed border
(`rgba(245,158,11,.12)` tint, `borderColor: 'warning.main'`) and a 🔒 prefix. The
API already filters them for customers — the styling is a second signal for
agents, never the enforcement.

## MUI v9 gotchas that will bite you

1. **System props are gone from `Stack`/`Box`.** `alignItems="center"` is a type
   error — move it into `sx`: `sx={{ alignItems: 'center' }}`.
2. **No `containedPrimary` style-override key.** Use the `variants` array
   (`props: { variant: 'contained', color: 'primary' }`) — see `theme.ts`.
3. **`slotProps`, not `componentsProps`**, for `Dialog`/`TextField` internals.
4. Adding a custom palette key needs a module augmentation — see the
   `declare module '@mui/material/styles'` block at the bottom of `theme.ts`.

## Before you finish

- `npx tsc -b` from `frontend/` must exit 0.
- View the screen in **both** colour modes if it's Trackly-owned.
- Check the page doesn't scroll horizontally at ~380px wide.
- Nav items and dialogs need keyboard focus and an accessible name.
