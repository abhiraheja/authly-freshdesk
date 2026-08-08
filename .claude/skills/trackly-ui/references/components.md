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
| `Card` | `tk-card` | `heading`, `subheading`, `dense`, `flush`, `interactive`, `collapsible`, `[(collapsed)]`; `[card-actions]`, `[card-footer]` slots |
| `Badge` | `tk-badge` | `tone`, `dot` |
| `Avatar` | `tk-avatar` | `name`, `imageUrl`, `size`, `round`, `fallback` |
| `InputDirective` | `input[tkInput]`, `textarea[tkInput]`, `select[tkInput]` | `inputSize`, `inset` |
| `LabelDirective` | `label[tkLabel]` | — |
| `Field` | `tk-field` | `label` (required), `for`, `hint`, `error`, `required` |
| `Select` / `SelectOption` | `tk-select` / `tk-option` | `[(value)]`, `placeholder`, `inputId`, `ariaLabel`, `size`, `inset`, `auto`; option: `value`, `label`, `disabled` |
| `Combobox` | `tk-combobox` | `[(value)]`, `suggestions`, `inputId`, `inset` — free text with hints |
| `TagInput` | `tk-tag-input` | `[(value)]`, `suggestions`, `inputId`, `inset` |
| `Checkbox` | `tk-checkbox` | `[(checked)]`, `indeterminate`, `disabled`, `inputId`, `ariaLabel` |
| `Switch` | `tk-switch` | `[(checked)]`, `disabled`, `inputId`, `ariaLabel` |
| `RadioGroup` / `Radio` | `tk-radio-group` / `tk-radio` | `[(value)]`, `ariaLabel`, `disabled`; option: `value`, `label`, `hint` |
| `FilePicker` | `tk-file-picker` | `[(files)]`, `variant` (`dropzone`\|`inline`), `accept`, `maxBytes`, `multiple`, `disabled`, `label`, `hint`, `progress`, `error`, `(rejected)` |
| `AvatarUpload` | `tk-avatar-upload` | `name`, `imageUrl`, `size`, `accept`, `maxBytes`, `uploading`, `disabled`, `error`, `(selected)`, `(removed)` |
| `AttachmentList` | `tk-attachment-list` | `items` (`AttachmentItem[]`), `layout` (`chips`\|`rows`), `dark` — images render as thumbnails with a lightbox |
| `Tabs` | `tk-tabs` | `items`, `[(active)]` — presentational; caller renders the panel |
| `SkeletonDirective` | `[tkSkeleton]` | size it with utilities |
| `Spinner` | `tk-spinner` | `size` |
| `Kbd` | `tk-kbd` | — |
| `Alert` | `tk-alert` | `tone`, `heading` |
| `EmptyState` | `tk-empty-state` | `icon`, `heading` (required), `description` |
| `ToastService` / `Toaster` | `tk-toaster` | `success/error/warning/info/show/dismiss` |
| `Modal` | `tk-modal` | `[(open)]`, `heading`, `size`, `persistent`; `[modal-footer]` |
| `ConfirmService` / `ConfirmHost` | `tk-confirm-host` | `await confirm.ask({ heading, message, confirmLabel, tone })` → boolean |
| `Drawer` | `tk-drawer` | `[(open)]`, `heading`, `persistent`; `[drawer-footer]` |
| `Dropdown` | `tk-dropdown` | `align`; `[dropdown-trigger]` + `[dropdown-menu]` |
| `FloatingMenu` | `[tkFloating]` | `tkFloating` (anchor element), `align`, `matchWidth` — the only way to position a popup |
| `PageHeader` | `tk-page-header` | `title` (required), `subtitle`; `[page-actions]` |
| `Editor` | `tk-editor` | `[(value)]` (HTML), `placeholder`, `ariaLabel`, `rows`, `disabled`, `labels`; `[editor-tools]` slot |
| `RichTextView` | `tk-rich-text` | `value`, `format` ('html' \| 'text'), `dark` |
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

### Collapsible cards

`collapsible` turns the heading into a disclosure button. It needs a `heading`
— that is the thing you click — and `[(collapsed)]` is two-way so the owner can
remember the state.

```html
<tk-card
  heading="SLA timer"
  collapsible
  [collapsed]="prefs.isCollapsed('ticket.sla')"
  (collapsedChange)="prefs.setCollapsed('ticket.sla', $event)"
>…</tk-card>
```

Two things to know:

- **Collapsing hides the body with CSS, it does not remove it.** Projected
  content belongs to the *parent*, so an `@if` inside the card would still build
  every child and merely decline to show them — all of the cost and none of the
  honesty. Do not "optimise" this into a conditional block.
- **Collapse state is a personal preference**, not configuration. Put it in
  `UiPrefsStore` (localStorage), never on the workspace. What the workspace
  decides is which cards exist and in what order — that is admin configuration
  and lives in `ticket_options`.

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

`tk-field` wraps the whole trio so the spacing and help-text size can't drift
between screens. `for` must match the control's id.

```html
<tk-field [label]="'Container' | transloco" for="container" [error]="containerError()">
  <input tkInput id="container" [(ngModel)]="container" />
</tk-field>
```

### Never ship a raw `<select>`

A native select's option list is drawn by the operating system. No CSS reaches
it — not the palette, not the radius, not dark mode. The closed control looks
like Trackly and opens into a stark OS list. Use `tk-select`:

```html
<tk-select inset [(value)]="priority" [ariaLabel]="'Priority' | transloco">
  <tk-option value="" [label]="'All priorities' | transloco" />
  @for (option of priorityOptions(); track option.id) {
    <tk-option [value]="option.value" [label]="option.label" />
  }
</tk-select>
```

`label` is an input, not projected content, so the transloco pipe stays in the
template while the select still has the text as data. `auto` shrinks to fit
(filter bars); the default fills its row.

### Picking between the boolean controls

- **`tk-checkbox`** — the value is submitted later, with the rest of a form.
- **`tk-switch`** — the setting applies the moment it is flipped.
- **`tk-radio-group`** — exactly one of a small, visible set.

Mixing the first two up is the usual reason a settings page feels
unpredictable. All three wrap a real native input (clipped, never
`display: none`), so focus, the space key and screen-reader semantics come from
the browser rather than being re-implemented.

### Rich text: `tk-editor` writes it, `tk-rich-text` reads it

```html
<tk-editor
  [(value)]="body"
  [rows]="4"
  [labels]="editorLabels()"
  [placeholder]="placeholder()"
/>

<tk-rich-text [value]="comment.body" [format]="comment.bodyFormat" [dark]="onPrimary()" />
```

Four rules:

1. **Always pass `format`, never sniff the body.** `"<3 that fix"` is plain text
   that reads as markup. The API sends `bodyFormat` on every comment; branch on
   it. Getting this wrong shows a customer a broken tag instead of their words.
2. **The editor's output is not trusted.** The server sanitises again on write
   (`RichText` in `Trackly.Infrastructure.Text`) and that pass is the control.
   Client-side cleaning exists so a paste from Word *looks* like what will be
   stored — keep `projects/ui/src/lib/editor/rich-text.ts` in step with the
   server allowlist or formatting will survive the composer and vanish on save.
3. **Emptiness is `isEmptyHtml()`, not `.trim()`.** An emptied contenteditable
   serialises to `"<p><br></p>"`, which is truthy and is not a message.
4. **`labels` is passed in.** `@trackly/ui` has no locale of its own — a
   component library that injects the app's translation service stops being
   usable on its own. Build the map with a `computed()` that reads `lang()`.

Prose styling (`.rich-text`, `.editor-surface`) lives in `styles.scss` and is
shared by both, so what you type is what you see afterwards.

### Putting the trigger somewhere else

`headless` renders no trigger — just the chips, progress bar and messages — and
`open()` opens the dialog. Use it when the button has to live somewhere the
picker cannot reach, like the editor's toolbar:

```html
<tk-editor [(value)]="body">
  <span editor-tools class="contents">
    <span class="editor-tool-divider" aria-hidden="true"></span>
    <button type="button" class="editor-tool" (click)="picker.open()">
      <tk-icon name="paperclip" [size]="15" />
    </button>
  </span>
</tk-editor>
<tk-file-picker #picker headless multiple [(files)]="files" />
```

`class="contents"` on the slot wrapper is what keeps the divider and the button
as direct flex children of the toolbar instead of one nested box.

Do **not** solve this by splitting the picker in two — the file list and the
input that fills it are the state this component exists to own.

### Never hand-roll a file input

`tk-file-picker` is the only file input in the app. Writing
`<input type="file">` by hand means re-deriving drag-and-drop, the size check,
the accept check that drops bypass, the chosen-file chip, the remove button, the
`input.value = ''` reset that lets the same file be picked twice, and the
translated rejection message — and the two screens that did it had already
drifted apart and were emitting hard-coded English.

```html
<!-- A form: a dropzone earns its vertical space -->
<tk-file-picker multiple [(files)]="files" [maxBytes]="maxUploadBytes" [progress]="uploadProgress()" />

<!-- A composer: one action among several -->
<tk-file-picker variant="inline" [(files)]="files" [label]="'tickets.detail.attach' | transloco" />
```

Rules and constants live in `@trackly/core` (`MAX_ATTACHMENT_BYTES`,
`MAX_IMAGE_BYTES`, `IMAGE_ACCEPT`, `checkFile`) so the client and the API agree
on one number. **The picker does not upload** — it produces a validated
`File[]`. Uploading belongs in a typed `*.api.ts` calling `ApiService.upload`,
whose `onProgress` callback feeds `[progress]` back in. Client-side checking is
a courtesy that saves a round trip; the API re-checks everything.

`tk-avatar-upload` is the photo case: the avatar *is* the target, and it shows a
local `URL.createObjectURL` preview until `uploading` goes false, so the new
photo lands immediately. The parent does the upload and patches its own state
from the response — reloading a resource instead would leave the old photo on
screen for the length of the round trip.

### Show an image attachment, don't name it

`tk-attachment-list` renders anything that decodes as an image as a thumbnail
that opens full size; everything else stays a chip. A filename tells you nothing
about a screenshot, and screenshots are most of what a support desk receives.

Two details that are easy to get wrong and are already handled: the content type
is trusted **first but not only** — files arriving by email or a messaging
connector routinely carry `application/octet-stream`, so the extension is the
fallback — and a thumbnail that fails to load demotes that file to a chip,
because the broken-image glyph is worse than no preview.

Map the API type at the call site (`AttachmentItem` carries a `url`); the design
system does not know how to turn an attachment id into a session route or a
guest route with a token.

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

### Check `value()` before `isLoading()`

`isLoading()` is **also true during a reload**, and a reload keeps the previous
value. So this order is wrong:

```html
@if (r.error()) { … } @else if (r.isLoading()) { …skeleton… } @else if (r.value(); as v) { … }
```

Every `r.reload()` swaps the screen for a skeleton, which **destroys the whole
subtree** — scroll position, focus, and any component state inside it, including
an open dialog someone was halfway through filling in. It looks like the dialog
closing by itself.

Put the value first; the skeleton is for the first load, which is exactly "no
value yet":

```html
@if (r.value(); as v) { …content… } @else if (r.error()) { …retry… } @else { …skeleton… }
```

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

### Confirmations go through `ConfirmService`

```ts
if (!(await this.confirm.ask({ heading: 'Resolve this ticket?', tone: 'success' }))) return;
```

A promise, not a callback, so the guard reads top to bottom and sits where the
decision is instead of the real work being buried two levels down in a handler.
`<tk-confirm-host />` is already mounted in the shell — features only inject the
service.

**Ask sparingly.** A dialog on something routine trains people to dismiss it
without reading, which costs you the one time it mattered. It earns its place
where the action is hard to undo, reaches the customer, or is one slip away from
a control people use all day — a per-row icon in a dense table, a big coloured
button beside everyday controls. When a dialog names a specific record, put the
subject in the `message`: on a list, that is the only thing that catches the
wrong row.

**Cancelling has to restore the control.** `tk-select` writes its own model when
an option is picked, so a component that confirms a selection must mirror the
pick into its own signal *first* — Angular skips an input write that looks
identical to the last one, so pushing the old value back only works if the bound
expression actually changed. See `pickStatus` in `ticket-detail.ts`.

### Never put a backtick inside an inline template

Templates are template literals. A backtick in an HTML comment — writing
`` `card-footer` `` to quote an attribute name — closes the string, and the rest
of the template is parsed as TypeScript. The errors that come back point at
random identifiers ("Cannot find name 'footer'", "Incorrect number of arguments
to @Component") and never at the comment, so the cause is genuinely hard to see.

Quote with "double quotes" in template comments. Save backticks for JSDoc above
the `@Component`, which is ordinary code.

It is easy to do by reflex when writing a comment that mentions a CSS property
or a method name — `align-items`, `open()`. Write them bare. The build always
catches it, but it reports six unrelated TypeScript errors and none of them
mention the file's comment, so it costs a minute every time.

### Any popup must leave the DOM — use `tkFloating`

**Never position a menu `absolute` inside its control.** It will be clipped, and
by ordinary layout, not exotic layout:

- a table wrapped in `overflow-x-auto` clips it — CSS computes the *other* axis
  to `auto` too, so the card grows a scrollbar and swallows the list;
- a modal or drawer body scrolls, so it clips it as well;
- `position: fixed` does not rescue it either. A transformed ancestor becomes
  the containing block for fixed descendants, and `.modal` carries
  `animate-float-in`, whose keyframes use `transform`.

The only thing that works is moving the element to `<body>` while it is open.
That is what `FloatingMenu` does, and it is the one implementation — `Select`,
`Combobox`, `TagInput` and `Dropdown` all go through it:

```html
<ul #list class="menu" [tkFloating]="host.nativeElement" matchWidth>…</ul>
<div class="menu" [tkFloating]="host.nativeElement" align="end">…</div>
```

`matchWidth` takes the anchor's width (a select); omit it to size to content (a
menu). `align="end"` right-aligns. It measures on open and on every scroll and
resize, flips above the anchor when there is no room below, and hides itself for
one frame so `end` alignment does not visibly jump.

Two things the move breaks, which the **caller** still owns:

- `host.contains(relatedTarget)` in a focus-out check no longer sees the popup,
  so test it separately or dragging its scrollbar closes it.
- The element must exist only while the popup is open (`@if`), so the directive's
  `onDestroy` can take the node off `<body>`.

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
