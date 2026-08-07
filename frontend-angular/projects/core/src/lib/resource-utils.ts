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
