import { computed, type Signal } from '@angular/core';

/**
 * The value of a resource, or a fallback when it has none.
 *
 * **`resource().value()` throws when the resource is in the error state.** That
 * is the right default for the one resource a screen exists to show, but it is
 * wrong for every optional lookup beside it: a failed suggestion list throws
 * during change detection and takes the whole view down with it — which looks to
 * the user like the dialog closing by itself, with nothing on screen explaining
 * why.
 *
 * Use this for anything a screen can do without: type-ahead sources, option
 * lists, counts. Read `.value()` directly only where the failure genuinely means
 * "there is nothing to render", and pair that with an error branch.
 *
 * Structurally typed rather than taking `ResourceRef`, so it also accepts an
 * `httpResource` or any hand-rolled equivalent.
 */
export function valueOr<T>(
  ref: { value: () => T | undefined; error: () => unknown },
  fallback: NonNullable<T>,
): NonNullable<T> {
  if (ref.error()) return fallback;
  return (ref.value() ?? fallback) as NonNullable<T>;
}

/**
 * The resource's value once it has settled, or `undefined` — never a throw.
 *
 * For the resource a screen *is* about, where the fallback is a branch rather
 * than a value:
 *
 * ```html
 * @if (loaded(); as ticket) { … } @else if (res.error()) { …retry… } @else { …skeleton… }
 * ```
 *
 * Written the obvious way — `@if (res.value(); as ticket)` — that error branch is
 * unreachable. `value()` throws in the error state (Angular's `ResourceValueError`),
 * and a throw while evaluating an `@if` condition escapes change detection and
 * takes the whole render down, so one failed request blanks the page instead of
 * showing the message written for exactly that case. `defaultValue` does not help;
 * it is not consulted once the resource has settled into an error.
 *
 * Reads `error()` first so `value()` is only touched when it is safe to touch.
 *
 * Takes a **thunk**, not the resource: `settled(() => this.ticket)`. A class field
 * that read `this.ticket` eagerly would have to be declared after the resource it
 * wraps, and field order is a silent trap — get it wrong and you capture
 * `undefined` with no error until the screen renders.
 */
export function settled<T>(
  ref: () => { value: () => T | undefined; error: () => unknown },
): Signal<T | undefined> {
  return computed(() => {
    const res = ref();
    return res.error() ? undefined : res.value();
  });
}
