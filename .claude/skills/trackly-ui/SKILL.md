---
name: trackly-ui
description: Build or restyle any Trackly screen or component in the Angular frontend — pages, cards, tables, forms, dialogs, charts, the app shell, admin settings, customer-facing branded surfaces. Use whenever adding UI, choosing colours/type/spacing, wiring dark mode, adding a route or guard, fetching data for a screen, or deciding whether a surface is Trackly-branded or workspace-branded. Carries the full design system: tokens, layout shell, component catalogue and page recipes.
---

# Trackly UI

**Angular 22 + TypeScript + Tailwind v4**, standalone components, signals
throughout, zoneless change detection. Lives in `frontend-angular/`.

> **Migration in progress.** `frontend/` is the retiring React + MUI app.
> Screens are being ported one at a time; routes not yet ported render
> `ComingSoon`, which names the React file to port. Read from `frontend/` for
> behaviour, never copy its MUI markup. When a screen lands, delete the React
> one in the same change.

Do **not** introduce Angular Material, PrimeNG, shadcn, or a second styling
system. The design system is a CSS token layer plus thin Angular wrappers, and
it is complete enough that a page should contain almost no bespoke styling.

---

## Read this first, then the reference you need

| Doing | Read |
|---|---|
| Picking a colour, size, spacing, shadow, animation | `references/tokens.md` |
| Building the shell, sidebar, top bar, or a new page's skeleton | `references/layout.md` |
| Building or restyling any component | `references/components.md` |
| Composing a whole page, choosing icons, handling states | `references/patterns.md` |

Don't guess a value. If it isn't in `tokens.md`, it doesn't exist yet — add it
there (i.e. to `src/styles.scss`) first.

---

## The rule that matters most: which brand is this surface?

Trackly is multi-tenant. Every screen belongs to one of two palettes, and mixing
them is the fastest way to break the product.

| | **Trackly-owned** | **Workspace-branded** |
|---|---|---|
| Screens | dashboard, tickets, admin, login/verify, onboarding | `/submit`, `/kb`, `/chat`, `/csat`, guest ticket view, `/portal/*`, `/invite`, widget, notification emails |
| Colour source | the token layer (indigo `#4F46E5`) | `branding.primaryColor`, fetched per workspace |
| Dark mode | **yes** — must work in both schemes | **no** — always light; the palette is the customer's |
| Wrapper | routed under `Shell` | a branded frame, outside the shell |

This is **invariant 6** in `CLAUDE.md`. Customer surfaces still use Trackly's
typography, spacing, radius and motion — those are brand-neutral. Only colour
differs, and a branded route calls `ThemeService.forceLight()` on entry.

---

## Where everything lives

```
frontend-angular/src/
├── styles.scss              tokens (:root / .dark) + the component CSS layer
├── tailwind.css             @theme inline — maps tokens onto utilities
└── app/
    ├── core/                framework, no UI
    │   ├── api/             ApiService · ApiError · interceptors · *.api.ts
    │   ├── auth/            SessionStore · guards · models
    │   ├── theme/           ThemeService (dark mode, forceLight)
    │   └── format.ts        tone maps + timeAgo/initials/avatarColor
    ├── ui/                  the design system — import from 'app/ui'
    ├── shell/               Shell · nav.ts · CommandPalette
    └── features/            one folder per screen
```

---

## Six rules that catch most mistakes

1. **Never interpolate a Tailwind class.** Tailwind v4 only emits classes it can
   find as literal strings. `'bg-' + tone` compiles to *nothing* — a silent
   failure with no error. Use a static lookup (`TINT[tone]`) or a design-system
   class (`.badge-warning`). This is the single most common bug in this codebase.
2. **Semantic tokens, never raw colour.** `bg-card`, `text-muted-foreground`,
   `border-border`. Literal hex only exists in `styles.scss` and the avatar
   palette in `format.ts`.
3. **Coloured labels go through `tk-badge` + a tone map.** Look the state up in
   `STATUS_TONE` / `PRIORITY_TONE` — never pick a tone by eye at the call site.
4. **Filter state lives in the URL.** `?view=open&q=login&page=2`, bound to
   `input()`s by `withComponentInputBinding()`. Shareable, Back works, and the
   resource params double as the cache key.
5. **Four states or it isn't done** — loading (skeleton, same height as the real
   content), empty (which kind?), error (with retry), data.
6. **Private notes are enforced by the API, never by styling.** Invariant 5.

---

## Angular conventions

Every component: **standalone**, `ChangeDetectionStrategy.OnPush`, signal-based.
There is no zone.js — `provideZonelessChangeDetection()` is on, so anything that
mutates outside a signal will not repaint.

```ts
@Component({
  selector: 'tk-ticket-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Card, Badge, Button],
  template: `…`,          // inline under ~150 lines, else templateUrl
})
export class TicketList {
  readonly view = input('');                      // ← query param, auto-bound
  private readonly api = inject(TicketsApi);

  protected readonly tickets = resource({
    params: () => ({ view: this.view() }),
    loader: ({ params }) => this.api.list({ status: params.view || undefined }),
  });

  protected readonly rows = computed(() => this.tickets.value()?.items ?? []);
}
```

- `input()` / `model()` / `output()` — never `@Input()`/`@Output()`
- `resource()` for reads; it gives `value()`, `isLoading()`, `error()`, `reload()`
- `computed()` for derived state; `effect()` only for syncing to the outside world
- `@if` / `@for` / `@switch` — never `*ngIf` / `*ngFor`
- `protected` for template members, `private` for everything else
- Prefer `host: {}` in the decorator over `@HostBinding`

---

## Data, always

Never inject `HttpClient` in a component. A typed `*.api.ts` in `core/api/`
wraps `ApiService`, which returns promises and throws `ApiError`.

```ts
try {
  await this.api.update(id, body);
  this.toast.success('Ticket updated');
} catch (err) {
  if (err instanceof ApiError && err.status === 403) { … }
  this.error.set(errorMessage(err));
}
```

Branch on `err.status`, never on the message text — the copy will change, the
code will not.

**Toast vs alert:** a toast is for something that already succeeded and whose
surface is gone ("Invitation sent"). Anything the user must act on — a
validation failure, a save error — goes in a `tk-alert` next to the thing that
failed. A toast disappears in four seconds; it can never hold the only copy of
an error.

---

## Before you finish

- `npx ng build` from `frontend-angular/` exits 0
- viewed in **both** colour modes if the surface is Trackly-owned
- no horizontal page scroll at 380px; wide tables scroll inside their card
- keyboard reaches and operates everything, with a visible focus ring
- icon-only buttons have `aria-label`
- no interpolated Tailwind classes anywhere in the diff
- docs updated in the same change when the rule applies (`patterns.md` § 11)
