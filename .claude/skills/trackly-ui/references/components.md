# Component catalogue

Everything in `frontend-angular/src/app/ui/`. Import from the barrel, never from
a component's own path:

```ts
import { Button, Card, Badge, Icon } from '../../ui';
```

All standalone, all `OnPush`, all signal-based. Add new controls under
`src/app/ui/<name>/` and export them from `ui/index.ts`.

---

## The catalogue

| Component | Selector | Key API |
|---|---|---|
| `Icon` | `tk-icon` | `name` (required), `size` (18), `strokeWidth` |
| `Button` | `button[tkButton]`, `a[tkButton]` | `variant`, `size`, `iconOnly` |
| `Card` | `tk-card` | `heading`, `subheading`, `dense`, `flush`, `interactive`; `[card-actions]`, `[card-footer]` slots |
| `Badge` | `tk-badge` | `tone`, `dot` |
| `Avatar` | `tk-avatar` | `name`, `imageUrl`, `size`, `round`, `fallback` |
| `InputDirective` | `input[tkInput]`, `textarea[tkInput]`, `select[tkInput]` | `inputSize`, `inset` |
| `LabelDirective` | `label[tkLabel]` | — |
| `SkeletonDirective` | `[tkSkeleton]` | size it with utilities |
| `Spinner` | `tk-spinner` | `size` |
| `Kbd` | `tk-kbd` | — |
| `Alert` | `tk-alert` | `tone`, `heading` |
| `EmptyState` | `tk-empty-state` | `icon`, `heading` (required), `description` |
| `ToastService` / `Toaster` | `tk-toaster` | `success/error/warning/info/show/dismiss` |
| `Modal` | `tk-modal` | `[(open)]`, `heading`, `size`, `persistent`; `[modal-footer]` |
| `Drawer` | `tk-drawer` | `[(open)]`, `heading`, `persistent`; `[drawer-footer]` |
| `Dropdown` | `tk-dropdown` | `align`; `[dropdown-trigger]` + `[dropdown-menu]` |
| `PageHeader` | `tk-page-header` | `title` (required), `subtitle`; `[page-actions]` |
| `StatCard` | `tk-stat-card` | `label`, `value`, `icon`, `tone`, `delta`, `invert`, `clickable` |
| `TableDirective` | `table[tkTable]` | `hover` |
| `Pagination` | `tk-pagination` | `[(page)]`, `total`, `pageSize` |
| `Donut` | `tk-donut` | `segments`, `size`, `centerLabel` |
| `Bars` | `tk-bars` | `data`, `seriesNames` |
| `Meter` | `tk-meter` | `label`, `value`, `percent`, `series` |

---

## Icons

`Icon` is a hand-picked inline-SVG subset of Lucide. `lucide-angular` is
deliberately **not** used — it declares peer support only to Angular 21 and this
workspace is on 22.

Adding an icon means adding a `@case` to `ui/icon/icon.ts` and a name to the
`IconName` union. Copy the 24×24 path data straight from lucide.dev.

```html
<tk-icon name="ticket" [size]="18" />
<tk-icon name="sparkles" [size]="16" class="text-primary" />
```

Sizes: **16** inline with body text · **18** nav and buttons · **20** icon
buttons · **28** empty states. Strokes are `currentColor`, so tint with a text
utility.

---

## Buttons

An attribute selector, so it stays a real `<button>`/`<a>` — `type`, `disabled`,
`href`, focus order and form submission all keep working.

```html
<button tkButton (click)="save()">Save</button>
<button tkButton variant="outline" size="sm">Filter</button>
<button tkButton variant="danger" (click)="remove()">Delete</button>
<a tkButton variant="ghost" routerLink="/dashboard">Back</a>

<!-- Icon-only ALWAYS needs a label. A tooltip is not a label. -->
<button tkButton variant="ghost" iconOnly aria-label="Refresh" (click)="reload()">
  <tk-icon name="refresh-cw" [size]="20" />
</button>
```

**Visibility gotcha.** `styles.scss` loads after Tailwind, so `.btn`'s
`display: inline-flex` beats `lg:hidden` on the same element. Put the visibility
utility on a wrapper:

```html
<span class="lg:hidden">
  <button tkButton variant="ghost" iconOnly aria-label="Menu">…</button>
</span>
```

---

## Cards

The one panel in the system. If a surface needs a different look, it is almost
always a card with different children.

```html
<tk-card heading="Members" subheading="14 people">
  <button tkButton variant="ghost" size="sm" card-actions>Invite</button>
  …body…
</tk-card>

<!-- flush: the body owns its padding — a table or a divided list -->
<tk-card flush>
  <div class="overflow-x-auto">
    <table tkTable hover class="min-w-[900px]">…</table>
  </div>
  <tk-pagination card-footer [(page)]="page" [total]="total()" />
</tk-card>
```

`interactive` adds hover-lift and a pointer cursor — pair it with a click
handler **and** a keyboard path, never just the click.

---

## Badges and the tone system

Six tones cover every coloured state: `primary · info · success · warning ·
danger · neutral`. Both the tint and its foreground come from tokens that flip
with the colour scheme, so a badge stays legible in dark mode with no override.

```ts
import { STATUS_TONE, PRIORITY_TONE, toneFor } from '../../core/format';

protected statusOf = (t: TicketSummary) => toneFor(STATUS_TONE, t.status);
```

```html
@let s = statusOf(ticket);
<tk-badge [tone]="s.tone" dot>{{ s.label }}</tk-badge>
```

`toneFor` falls back to a neutral chip carrying the raw value, so an unknown
status renders visibly rather than disappearing.

The `dot` matters: colour must never be the only signal. Every status chip
carries a dot **and** a label.

---

## Forms

```html
<label tkLabel for="email">Work email</label>
<input tkInput id="email" type="email" [(ngModel)]="email" name="email" />

<!-- inset: muted fill, no border — search bars, composers, filter rows -->
<input tkInput inset placeholder="Search…" [(ngModel)]="query" />
```

Every input needs a real label. A placeholder is not a label — it fails screen
readers and vanishes the moment someone types.

`.dropzone` in `styles.scss` styles a drag-and-drop file area; keep the hidden
`<input type="file">` inside a `<label>` so keyboard users can reach it.

---

## Feedback

```html
<!-- Inline, tied to the thing that failed. Never a toast for this. -->
<tk-alert tone="danger" heading="Couldn't load tickets">
  {{ errorText() }}
  <button type="button" class="ml-1 font-semibold underline" (click)="tickets.reload()">
    Try again
  </button>
</tk-alert>

<!-- Same height as the real content, so nothing jumps when data lands -->
<span tkSkeleton class="h-4 w-32"></span>
```

```ts
private readonly toast = inject(ToastService);
this.toast.success('Ticket assigned');
this.toast.error(errorMessage(err));
this.toast.info('Draft saved', { label: 'Undo', run: () => this.restore() });
```

`<tk-toaster />` is rendered **once**, in the shell. Never per page, or a toast
fired during a navigation dies with the outgoing route.

### Empty states — the three kinds

| Cause | Heading | Action |
|---|---|---|
| Nothing exists yet | "No tickets yet" | the create CTA |
| Filters match nothing | "No tickets match" | "Clear filters" |
| Request failed | "Couldn't load tickets" | "Try again" |

Showing a create CTA when the real cause is a filter sends people off to build a
duplicate of something they already have. Branch on `hasFilters()`.

---

## Overlays

```html
<tk-modal [(open)]="confirmOpen" heading="Delete 12 tickets?">
  <p>This cannot be undone.</p>
  <div modal-footer>
    <button tkButton variant="ghost" (click)="confirmOpen.set(false)">Cancel</button>
    <button tkButton variant="danger" (click)="remove()">Delete</button>
  </div>
</tk-modal>
```

The header is fixed and the **body** scrolls, so a tall form can never push its
own actions off-screen. `persistent` blocks Esc and backdrop dismissal — use it
only where losing input would be destructive.

### Never put a backtick inside an inline template

Templates are template literals. A backtick in an HTML comment — writing
`` `card-footer` `` to quote an attribute name — closes the string, and the rest
of the template is parsed as TypeScript. The errors that come back point at
random identifiers ("Cannot find name 'footer'", "Incorrect number of arguments
to @Component") and never at the comment, so the cause is genuinely hard to see.

Quote with "double quotes" in template comments. Save backticks for JSDoc above
the `@Component`, which is ordinary code.

### Never centre an animated panel with `transform`

`.modal` and `.palette` centre with `inset: 0; margin: auto` (or
`margin-inline: auto`), **not** `translate(-50%, -50%)`.

Both carry `.animate-float-in`, whose keyframes end on `transform: translateY(0)`
with `animation-fill-mode: both`. That final transform **replaces** a centring
one and leaves the panel sitting half its width to the right of centre — no
error, it just looks wrong, and only once the animation has finished so it's
easy to miss while developing.

If you add another animated overlay, centre it with auto margins and leave
`transform` to the animation. An element has one `transform`; two features
cannot both own it.

Modal vs drawer: a **drawer** when the user needs the page behind it for context
(editing a row while its list stays visible); a **modal** when the decision is
self-contained.

```html
<tk-dropdown align="end">
  <button tkButton variant="outline" dropdown-trigger>Options</button>
  <div dropdown-menu>
    <button class="menu-item">Edit</button>
    <div class="menu-sep"></div>
    <button class="menu-item text-danger">Delete</button>
  </div>
</tk-dropdown>
```

Closes on any click inside the menu, so items never need their own close call.
Use `align="end"` in the top bar or the menu will run off the right edge.

---

## Tables

Native `<table>` on purpose — semantics, `scope`, screen-reader table navigation
and text selection all keep working, which a div-grid throws away.

```html
<tk-card flush>
  <div class="overflow-x-auto">          <!-- scroll HERE, not the page -->
    <table tkTable hover class="min-w-[900px]">
      <thead>
        <tr><th scope="col">Ticket</th>…</tr>
      </thead>
      <tbody>
        @if (tickets.isLoading()) {
          @for (row of skeletonRows; track row) { … }
        } @else {
          @for (t of rows(); track t.id) {
            <tr class="cursor-pointer" (click)="open(t)">…</tr>
          } @empty {
            <tr><td colspan="7" class="p-0"><tk-empty-state … /></td></tr>
          }
        }
      </tbody>
    </table>
  </div>
  <tk-pagination card-footer … />
</tk-card>
```

Rules that matter:
- The wrapper scrolls and the table carries `min-w-[…]`. Without both, a wide
  table makes the whole **page** scroll sideways.
- A cell containing its own control calls `$event.stopPropagation()`, or clicking
  a checkbox also opens the row.
- Row actions use `.row-actions` (fades in on hover, always visible on touch —
  there is no hover on a phone).
- Keep `page` in the URL, not component state.

---

## Charts

Three primitives, no charting library, zero dependency weight. Colours come from
`--chart-1..5`, so a series keeps its slot across screens and flips in dark mode.

```html
<tk-donut [segments]="segments()" centerLabel="Total" />
<tk-bars [data]="weekly()" [seriesNames]="['Created', 'Resolved']" />
<tk-meter label="Critical" [value]="18" [percent]="22" [series]="3" />
```

The donut's trick: a circle of radius `15.9155` has a circumference of ~100, so
`stroke-dasharray="42 100"` is literally "42 percent" — exact at any size, no arc
maths.

The bar chart's legend belongs in the enclosing card's `[card-actions]` slot,
never underneath — a legend below competes with the axis labels for the same
scan line.

Reach for a real charting library only when a genuinely new chart type is
needed, and price the bundle first.

---

## Stat cards

```html
<tk-stat-card
  label="Open"
  icon="folder-open"
  tone="info"
  [value]="value('open')"
  [delta]="{ value: '+5%', direction: 'up' }"
/>

<!-- down is the improvement here -->
<tk-stat-card label="Avg. resolution" icon="timer" [value]="'4h 12m'" invert
              [delta]="{ value: '-8%', direction: 'down' }" />
```

The delta is coloured by whether the change is **good**, not by its sign — hence
`invert` for metrics where falling is better.

Pass `undefined` for a value that hasn't loaded; it renders `—`. Never render a
placeholder `0`: it reads as real data and people act on it.

---

## Adding a component

1. `src/app/ui/<name>/<name>.ts` — standalone, OnPush, signal inputs
2. Style with design-system classes from `styles.scss` where one fits; add a new
   class there rather than a component-scoped stylesheet, so it is reusable
3. Export from `ui/index.ts`
4. Add a row to the table at the top of this file

Never build tone-varying styles by interpolating class names. If a component
needs per-tone styling, either add `.thing-{tone}` classes to `styles.scss` or
use a static `Record<Tone, string>` lookup in the component.
