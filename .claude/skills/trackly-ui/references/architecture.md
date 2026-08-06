# Workspace architecture

`frontend-angular/` is an Angular **multi-project workspace**: a thin host app
plus eight publishable libraries. Boundaries are enforced by the compiler, not
by convention, so a feature cannot quietly reach into another feature's
internals.

```
frontend-angular/
├── src/                     the HOST APP — and almost nothing else
│   ├── styles.scss          design tokens + component CSS layer
│   ├── tailwind.css         @theme inline — tokens → Tailwind utilities
│   ├── environments/        the only place environment values live
│   └── app/
│       ├── app.config.ts    providers; hands environment down to the libraries
│       ├── app.routes.ts    mounts libraries; knows none of their internals
│       └── shell/           sidebar + top bar + ⌘K palette + nav.ts
└── projects/
    ├── core/                @trackly/core       framework, no UI
    ├── ui/                  @trackly/ui         design system
    ├── auth/                @trackly/auth       sign-in, verify, onboarding
    ├── dashboard/           @trackly/dashboard  agent overview
    ├── tickets/             @trackly/tickets    agent ticket surfaces
    ├── admin/               @trackly/admin      13 workspace-admin screens
    ├── portal/              @trackly/portal     signed-in customer
    └── guest/               @trackly/guest      anonymous branded surfaces
```

---

## 1. The dependency graph

```
        ┌──────────────────────────────────────┐
        │  app (src/)  — shell, routes, config │
        └──────────────┬───────────────────────┘
                       │ mounts
   ┌─────────┬─────────┼─────────┬─────────┬─────────┐
 auth    dashboard  tickets    admin   portal    guest
   └─────────┴─────────┼─────────┴─────────┴─────────┘
                       ▼
                      ui
                       ▼
                     core
```

**Acyclic, and only two directions matter:** everything may depend on `core`;
everything except `core` may depend on `ui`. Feature libraries **must not**
import each other. If two features need the same thing, it belongs in `core`
(data/logic) or `ui` (a component) — that is the whole rule.

| Library | May import | Contains |
|---|---|---|
| `core` | nothing local | config token, `ApiService`, typed `*.api.ts`, `SessionStore`, guards, `ThemeService`, tone maps + formatters |
| `ui` | `core` | every design-system component |
| feature | `core`, `ui` | screens + that feature's route table |
| app | all | shell, nav, route mounting, environments |

`core` holds **no templates**. `ui` holds **no API calls**. Both rules are what
keep the graph flat.

---

## 2. Environment never crosses into a library

A library that imports the app's `environment.ts` is un-consumable by any other
app and untestable without the app's file layout. So the app hands values down:

```ts
// src/app/app.config.ts — the ONLY place environment crosses the boundary
provideTracklyCore({
  apiBaseUrl: environment.apiBaseUrl,
  chatHubPath: environment.chatHubPath,
})
```

```ts
// projects/core/src/lib/api/api.service.ts
private readonly config = inject(TRACKLY_CONFIG);
```

A new library that needs configuration follows the same shape: an interface, an
`InjectionToken`, and a `provideX()` returning `makeEnvironmentProviders`.
`provideTracklyCore` also installs `HttpClient` and both interceptors, so a
consumer cannot forget the session cookie or `ApiError` normalisation.

---

## 3. Routing — how libraries get mounted

Each feature library exports a route table. The app mounts it; it never names
the library's components.

```ts
{ path: 'dashboard/tickets', loadChildren: () => import('@trackly/tickets').then(m => m.ticketsRoutes) }
```

### The empty-path rule — read this before adding a route

**There is exactly one `path: ''` route in the app, and it is the shell.**

Angular matches empty-path routes in order and does **not** backtrack out of a
lazy config once it has loaded. Two sibling `path: ''` entries with
`loadChildren` therefore render *nothing* — no error, no console warning, just a
blank page — for any URL the first one fails to match. This exact bug shipped
once here; that is why the rule exists.

So:

| The library's URLs | How it is mounted |
|---|---|
| Under a prefix (`/dashboard`, `/admin`, `/portal`) | `loadChildren` — fully lazy |
| Top-level (`/login`, `/submit`, `/kb`) | **spread** into the app's config: `...authRoutes` |

Spreading costs nothing at runtime: the tables are a few hundred bytes and every
screen inside them is still `loadComponent`. But the barrel is now imported
eagerly, so **`@trackly/auth` and `@trackly/guest` export their route table
only** — re-exporting a component there would drag it into the initial bundle.
Libraries mounted with `loadChildren` are free to export whatever they like.

---

## 4. Two resolution modes, on purpose

| Mode | Where | `@trackly/*` resolves to |
|---|---|---|
| **Development** | root `tsconfig.json` | `projects/*/src/public-api.ts` — **source** |
| **Packaging** | each `projects/*/tsconfig.lib.json` | `dist/trackly/*` — **built packages** |

Source resolution is what makes `ng serve` pick up a library edit instantly, with
no `ng build @trackly/ui` in the inner loop. ng-packagr must not do that, or a
dependency's source gets compiled *into* the dependent package — two copies of
`core` in the bundle. Hence the override in every dependent library's
`tsconfig.lib.json`, and hence the order in `build:libs`:

```bash
npm run build:libs      # core → ui → auth → dashboard → tickets → admin → portal → guest
```

You only need that for publishing, or to consume a library from another repo.
Day-to-day, `npm start` and `npm run build` compile everything from source.

Cross-library dependencies are declared as **peerDependencies** in each
library's `package.json`. ng-packagr fails the build on an undeclared import,
which is the mechanism that keeps the graph in § 1 honest.

---

## 5. Adding to the workspace

### A screen inside an existing library

Add the component under `projects/<lib>/src/lib/`, add a route to that library's
`*.routes.ts`. **The app does not change.** That is the point of the split.

### A new library

```bash
npx ng generate library @trackly/<name> --project-root=projects/<name> --prefix=tk
```

Then:
1. Point the generated tsconfig path at **source**
   (`./projects/<name>/src/public-api.ts`) — the CLI defaults to `dist/`.
2. Replace `tsconfig.lib.json` with the packaging variant (copy from any
   existing library — it carries the `dist/trackly/*` paths override).
3. Declare cross-library deps in `package.json` as peerDependencies.
4. Write `src/lib/<name>.routes.ts` and export it from `public-api.ts`.
5. Mount it in `src/app/app.routes.ts` — `loadChildren` under a prefix, spread
   if its URLs are top-level.
6. Add it to `build:libs` **in dependency order**.
7. Add a nav entry in `src/app/shell/nav.ts` if it needs one.

### Where does this code go?

| It is… | Library |
|---|---|
| an HTTP call or a data type | `core` |
| a reusable visual component | `ui` |
| used by exactly one screen | that screen's library, not exported |
| needed by two features | push it down to `core` or `ui` — never feature→feature |
| the sidebar, top bar, or route table | the app |
