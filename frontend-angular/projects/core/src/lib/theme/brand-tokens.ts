/**
 * One workspace colour → the token overrides a branded surface needs.
 *
 * A customer-facing surface wears the tenant's colour, not Trackly's
 * (invariant 6), and an admin configures exactly **one** hex. Everything else a
 * palette needs — the hover step, a foreground that passes contrast, a tint for
 * selected rows, the readable ink on that tint — is derived here rather than
 * asked for, because the alternative is a settings page with six colour pickers
 * that most workspaces would fill in badly.
 *
 * The values are space-separated RGB channels because that is how `styles.scss`
 * stores colour (`--primary: 79 70 229`), which is what makes `bg-primary/10`
 * resolve. Setting them on one element re-skins its whole subtree: every
 * component in the design system already reads these tokens, so nothing needs a
 * "branded" variant.
 */

/** sRGB channels, 0–255. */
type Rgb = readonly [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** `--foreground` — the near-black used for text on a light surface. */
const INK: Rgb = [15, 23, 42];
/** `--background` and `--border` in their unbranded form. */
const PAGE: Rgb = [248, 250, 252];
const LINE: Rgb = [226, 232, 240];

/**
 * The properties {@link brandTokens} writes.
 *
 * Exported so a caller can clear exactly what it set when the branding goes
 * away, instead of guessing or leaving a half-applied palette behind.
 */
export const BRAND_TOKEN_PROPERTIES: readonly string[] = [
  '--primary',
  '--primary-hover',
  '--primary-ink',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--accent',
  '--accent-foreground',
  '--ring',
  '--background',
  '--border',
  '--input',
];

/** `#7C3AED`, `#7c3aed` or `#abc`. Anything else is not a colour we can derive from. */
function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.replace(/./g, (char) => char + char) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channels(colour: Rgb): string {
  return `${Math.round(colour[0])} ${Math.round(colour[1])} ${Math.round(colour[2])}`;
}

/** `amount` of `a` blended into `b`. */
function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const rest = 1 - amount;
  return [
    a[0] * amount + b[0] * rest,
    a[1] * amount + b[1] * rest,
    a[2] * amount + b[2] * rest,
  ];
}

/** WCAG relative luminance — the only honest way to ask "is this colour light?". */
function luminance(colour: Rgb): number {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
}

/**
 * Text on a solid fill of `colour`.
 *
 * A mid-blue brand takes white; a yellow or lime one takes near-black. Deciding
 * this by luminance rather than defaulting to white is what stops a workspace
 * whose colour happens to be bright from shipping an unreadable header.
 */
function contrasting(colour: Rgb): Rgb {
  return luminance(colour) > 0.45 ? INK : WHITE;
}

/**
 * A readable version of the brand for text on a *tint* of itself — the badge
 * and menu-item case, which is where a light brand fails first.
 *
 * Darkened in 10% steps and stopped as soon as it is dark enough, so a brand
 * that already passes comes back untouched rather than being crushed to near
 * black. The 0.18 threshold is roughly 4.5:1 against the 8% tint below.
 */
function ink(brand: Rgb): Rgb {
  let colour = brand;
  for (let step = 0; step < 8 && luminance(colour) > 0.18; step++) {
    colour = mix(BLACK, colour, 0.1);
  }
  return colour;
}

/**
 * Token overrides for a workspace's primary colour, or `null` when there is no
 * usable colour — in which case the surface keeps Trackly's own palette, which
 * is a plain-looking page rather than a broken one.
 */
export function brandTokens(color: string | null | undefined): Readonly<Record<string, string>> | null {
  const brand = color ? parseHex(color) : null;
  if (!brand) return null;

  const readable = channels(ink(brand));
  const onBrand = channels(contrasting(brand));

  return {
    '--primary': channels(brand),
    '--primary-hover': channels(mix(BLACK, brand, 0.12)),
    '--primary-ink': readable,
    '--primary-foreground': onBrand,
    '--secondary': channels(brand),
    '--secondary-foreground': onBrand,
    // The selected/hover tint, and the ink that has to stay legible on it.
    '--accent': channels(mix(brand, WHITE, 0.08)),
    '--accent-foreground': readable,
    '--ring': channels(brand),
    // A whisper of the brand in the page and its edges — enough that the surface
    // reads as the workspace's, not so much that it competes with the content.
    '--background': channels(mix(brand, PAGE, 0.04)),
    '--border': channels(mix(brand, LINE, 0.1)),
    '--input': channels(mix(brand, LINE, 0.1)),
  };
}
