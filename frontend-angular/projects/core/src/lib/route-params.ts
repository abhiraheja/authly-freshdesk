/**
 * Transforms for inputs bound to query params by `withComponentInputBinding()`.
 *
 * **The router writes `undefined` — not the declared default — when a param
 * leaves the URL.** `readonly q = input('')` is `''` only until something puts
 * `?q=` in the URL and takes it out again; from then on it is `undefined`, and
 * `this.q().trim()` throws.
 *
 * That failure is nastier than a normal exception because it happens inside a
 * `computed()` read from a template. The throw aborts the update pass partway
 * through, so the view is left half-bound — bindings after the throwing one
 * never run, and the screen shows a component with its structure but none of its
 * text. It then repeats on every change-detection pass, which reads as the tab
 * hanging rather than as an error.
 *
 * So normalise at the boundary. Do not scatter `?? ''` across the read sites:
 * one `transform` is the whole fix, and a defensive read at site nineteen just
 * hides that site twenty is missing one.
 *
 * ```ts
 * readonly q = input('', { transform: fromQuery });
 * readonly assignee = input('me', { transform: fromQueryOr('me') });
 * ```
 *
 * Note that a `transform` does **not** run over the declared default, so the
 * default and the fallback must agree — hence passing `'me'` twice above.
 */
export function fromQuery(value: string | undefined): string {
  return value ?? '';
}

/**
 * As {@link fromQuery}, for a param whose absence means something other than
 * "no filter" — `?assignee=` missing means *me*, not *everybody*.
 *
 * Falls back on empty as well as absent: `?assignee=` with nothing after it is a
 * URL somebody hand-edited, and it should mean the same as leaving it out.
 */
export function fromQueryOr(fallback: string): (value: string | undefined) => string {
  return (value) => value || fallback;
}
