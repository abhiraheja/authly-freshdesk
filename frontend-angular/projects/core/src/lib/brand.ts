/**
 * Re-points the brand tokens at a workspace's own colour.
 *
 * <h3>Why tokens and not style bindings</h3>
 * The token layer stores colours as space-separated RGB channels precisely so
 * `bg-primary/12` can compose `rgb(var(--primary) / 0.12)`. Overriding the
 * variables on one element therefore re-brands everything inside it — buttons,
 * tints, focus rings, badges — with no per-element bindings and no interpolated
 * class names. A surface that instead bound `[style.background]` at each call
 * site would drift the first time somebody added a control.
 *
 * <h3>Why the foreground is computed</h3>
 * `--primary-foreground` is white in the Trackly palette because Trackly's indigo
 * is dark. A workspace may well choose amber or lime, and white-on-amber is
 * unreadable. The contrast test below picks black or white per brand, so a
 * tenant cannot accidentally configure invisible button labels.
 *
 * Returns an empty object for a missing or unparseable colour, which leaves the
 * default palette in place — a bad hex should not produce an unstyled screen.
 */
export function brandVars(hex: string | null | undefined): Record<string, string> {
  const rgb = parseHex(hex);
  if (!rgb) return {};

  const [r, g, b] = rgb;
  const channels = `${r} ${g} ${b}`;
  const ink = readableOn(rgb);

  return {
    '--primary': channels,
    '--primary-foreground': ink,
    // A hover that is simply the brand darkened. Deriving it beats asking an
    // admin for a second colour they would have to keep in step with the first.
    '--primary-hover': shade(rgb, 0.86),
    '--primary-ink': shade(rgb, 0.8),
    '--ring': channels,
  };
}

function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Black or white, whichever has more contrast against the brand (WCAG 2.x). */
function readableOn(rgb: [number, number, number]): string {
  const l = relativeLuminance(rgb);
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onBlack >= onWhite ? '17 17 20' : '255 255 255';
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function shade([r, g, b]: [number, number, number], factor: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `${clamp(r)} ${clamp(g)} ${clamp(b)}`;
}
