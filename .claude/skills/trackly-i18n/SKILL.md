---
name: trackly-i18n
description: Localization standard for the Trackly Angular frontend, built on Transloco. Use whenever adding or editing ANY user-visible text — a label, heading, placeholder, empty state, toast, aria-label, validation message — or when adding a screen, a library, or a status/enum that is rendered. Enforces the non-negotiable rule: no hard-coded user-visible strings. Triggers on "add text/label/copy", "i18n", "localization", "translate", "new page", "Hindi", or any UI string work.
---

# Trackly — Localization

Runtime localisation for `frontend-angular/` using **Transloco**
(`@jsverse/transloco` v8).

Runtime rather than build-time on purpose: Trackly ships one bundle that serves
every workspace, and a customer following a branded link should get their
language without a per-locale deployment.

## THE RULE (non-negotiable)

**No user-visible string may be hard-coded.** If a person can read it, it comes
from a key:

- text, headings, button labels, placeholders, table headers, empty states
- `aria-label`, `title`, `alt` — anything exposed to assistive tech
- toasts, dialog copy, validation and error messages
- status/priority/role **labels** (`Open`, `Urgent`, `Admin`)

**Identifiers stay literal** — they are never rendered:

- route paths, `routerLink`, query params, CSS classes, `IconName` values
- object keys, enum/discriminator values, storage keys, API field names
- tone names (`'warning'`), chart series numbers, `data-*` attributes

If a quote-delimited string ends up in the DOM as readable text, it needs a key.

---

## Setup (already wired — don't redo)

| Piece | Where |
|---|---|
| Provider | `src/app/app.config.ts` — `provideTransloco({ availableLangs: ['en','hi'], fallbackLang: 'en', reRenderOnLangChange: true })` |
| Loader | `src/app/i18n/transloco-loader.ts` → fetches `/i18n/<lang>.json` |
| Messages | `public/i18n/en.json` (source of truth) and `public/i18n/hi.json` |
| Persistence | `localStorage['trackly-lang']`, read by `savedLang()` at bootstrap |

---

## How to use

### Templates — `TranslocoPipe` (the default)

```ts
import { TranslocoPipe } from '@jsverse/transloco';
@Component({ imports: [TranslocoPipe, /* … */] })
```

```html
<h1>{{ 'dashboard.subtitle' | transloco }}</h1>
<button [attr.aria-label]="'common.close' | transloco">…</button>
<p>{{ 'login.belongsToMany' | transloco: { email: email() } }}</p>
```

### Many keys in one block — `TranslocoDirective`

```html
<section *transloco="let t">
  <h2>{{ t('tickets.title') }}</h2>
  <p>{{ t('tickets.searchPlaceholder') }}</p>
</section>
```

### TypeScript (toasts, computed labels) — `TranslocoService`

```ts
private readonly transloco = inject(TranslocoService);
this.toast.success(this.transloco.translate('tickets.assigned'));
```

### Data arrays → store KEYS, translate where they render

Never build a sentence in TypeScript. Keep the key in the data:

```ts
protected readonly stats = [
  { valueKey: 'dashboard.kpi.open', value: 12 },
];
```
```html
@for (s of stats; track s.valueKey) { <p>{{ s.valueKey | transloco }}</p> }
```

This is why `nav.ts` holds `labelKey: 'nav.items.dashboard'` rather than
`label: 'Dashboard'`, and why the tone maps in `@trackly/core` return a
`labelKey`, not a label.

---

## Libraries need the pipe too

`@trackly/ui` and every feature library render text, so they localise the same
way — import `TranslocoPipe` in the component, add the key to both JSON files.
Transloco is a **peerDependency** of any library that uses it.

A library must not ship its own message file. All keys live in the app's
`public/i18n/*.json`, under the namespace that matches the library (`ui.*`,
`tickets.*`), so an integrator sees one catalogue.

---

## What is NOT a visible string

Representative **content** is data, not UI copy: customer names, subjects,
timestamps, demo records. In production these come from the API. Localise the
**chrome** around them — labels, headers, statuses, captions — not the data.

The illustrative ticket rows in `AuthLayout`'s brand panel are the edge case:
they are decorative marketing copy inside an `aria-hidden` panel. They stay
literal, and the panel is `aria-hidden="true"` precisely because none of it is
content.

---

## Adding new strings

1. Add the key to **both** `en.json` and `hi.json`. Keep the trees identical.
2. Namespaces: `common`, `nav`, `palette`, `login`, `dashboard`, `tickets`,
   `status`, `priority`, `role`, `sla`, `ui`, `comingSoon`. Add one top-level
   namespace per new feature library. Keys are `camelCase`, grouped, descriptive.
3. Reference it through the pipe, directive or service — never inline.
4. A missing `hi` key falls back to `en`, but still add it. Relying on fallback
   is how a half-Hindi screen ships.

### Interpolation, not concatenation

```json
"showing": "Showing {{from}}–{{to}} of {{total}}"
```

```html
{{ 'ui.pagination.showing' | transloco: { from: from(), to: to(), total: total() } }}
```

Never glue translated fragments together. Word order differs between languages —
Hindi puts the verb last — so a sentence assembled from pieces cannot be
translated correctly. One key per sentence, with parameters.

### Counts

English and Hindi both need a singular form. Use two keys and pick in a
`computed()` (`tickets.count` / `tickets.countOne`), rather than appending "s".

---

## Switching language

```ts
inject(TranslocoService).setActiveLang('hi');
localStorage.setItem('trackly-lang', 'hi');
```

With `reRenderOnLangChange: true` the UI updates live — no reload.

---

## Quality bar

- Every new or edited template: scan for quote-delimited visible text. Each one
  is a key or it is a bug.
- `en.json` and `hi.json` must stay structurally identical.
- Prefer a full sentence key per case over assembling words.
- `aria-label` and `title` are visible strings. They are the most commonly
  missed, because they don't show up when you look at the screen.
