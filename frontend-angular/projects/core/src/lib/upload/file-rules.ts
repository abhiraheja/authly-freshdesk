/*
 * The rules every file picker in Trackly is checked against.
 *
 * Pure functions and constants, deliberately outside the UI layer: the same
 * limits are enforced by the API, and having them in one importable place is how
 * the two stay in step. Client-side checking is a courtesy — it turns a 10 MB
 * round trip that ends in a 413 into an instant message — never a control. The
 * server re-checks everything.
 */

/** Matches `AttachmentService.MaxSizeBytes`. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Matches `BrandingController.MaxLogoBytes` and the avatar cap. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/**
 * Matches `BrandingController.MaxSignInImageBytes`.
 *
 * Five times the logo's, because it is a different kind of picture: a logo is a
 * mark that has to read at 32px in an email header, and the sign-in panel image
 * is full-bleed artwork across a 1440px column. Holding it to 1 MB would make
 * admins degrade a photograph before it ever reached the page.
 */
export const MAX_SIGN_IN_IMAGE_BYTES = 5 * 1024 * 1024;

/** What the avatar and logo endpoints accept, as an `accept` attribute. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * What the logo endpoints accept. SVG is allowed here and nowhere else: a logo
 * is rendered into an `<img>` inside Trackly's own chrome, and vector is what
 * keeps a mark crisp from a 24px favicon to an email header. Deliberately *not*
 * offered for the sign-in panel image, which is a full-viewport background —
 * an SVG is a document, and one filling the page is a larger surface than one
 * sitting at 32px in a header.
 */
export const LOGO_ACCEPT = 'image/png,image/svg+xml,image/jpeg,image/webp';

/** What the sign-in panel image accepts. Raster only; GIF so a loop works. */
export const SIGN_IN_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Width ÷ height that a logo is cropped to. Square, because every surface that
 * shows one renders it in a square box: the sign-in header, the email header,
 * the widget launcher, the admin thumbnails.
 */
export const LOGO_ASPECT = 1;

/**
 * Width ÷ height that the sign-in panel image is cropped to — **and the ratio
 * `AuthLayout` sizes its panel by.** These two are one decision in two files, so
 * the constant lives here rather than being written down twice.
 *
 * The panel used to be a fixed half-width column, which made its shape depend on
 * the visitor's screen — 0.80 on a 1440×900 laptop, 0.89 on a 1080p monitor,
 * wider on an ultrawide. No fixed crop can match a target that moves, so the
 * image was always trimmed again on display. Now the panel takes its width from
 * its height and this number, so the crop fills it exactly: nothing is cut off,
 * and no brand colour shows down the sides.
 *
 * 4:5 rather than something wider because the panel is a tall column on every
 * desktop shape, and a portrait subject is what fits it.
 */
export const SIGN_IN_IMAGE_ASPECT = 0.8;

/**
 * What a ticket attachment may be — **must match `UploadPolicy.Allowed`**.
 *
 * Extensions rather than MIME types: the browser's guess at a type varies by OS
 * and is empty often enough that a type-based `accept` silently hides files the
 * server would have taken. The server checks the extension too, so the two agree
 * on the same fact.
 *
 * This is a courtesy — it greys out the wrong files in the OS dialog. Dragging
 * one in bypasses it, and the API is what refuses.
 */
export const ATTACHMENT_ACCEPT =
  '.csv,.doc,.docx,.jpeg,.jpg,.mov,.mp3,.mp4,.pdf,.png,.txt,.wav,.xls,.xlsx';

/** Why a file was turned away. Maps to `upload.rejected.*` translation keys. */
export type FileRejection = 'empty' | 'tooLarge' | 'wrongType';

export interface FileRules {
  /** Reject anything larger. Omit for no size limit. */
  maxBytes?: number;
  /** An `accept` attribute value: `image/*`, `.pdf`, `image/png,image/jpeg`. */
  accept?: string;
}

/**
 * True when a file satisfies an `accept` attribute.
 *
 * Browsers apply `accept` to the picker's own dialog, but it is only a filter —
 * drag-and-drop bypasses it completely, and on some platforms the user can
 * switch the dialog back to "All files". So anything that also takes a drop has
 * to check for itself.
 */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  const patterns = (accept ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return patterns.some((pattern) => {
    // ".png" — extension match. The only form that works when the OS reports no
    // MIME type at all, which happens for uncommon extensions on Windows.
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    // "image/*" — compare the type half only.
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/** The reason to reject `file`, or null when it passes. */
export function checkFile(file: File, rules: FileRules = {}): FileRejection | null {
  if (file.size === 0) return 'empty';
  if (rules.maxBytes !== undefined && file.size > rules.maxBytes) return 'tooLarge';
  if (!matchesAccept(file, rules.accept)) return 'wrongType';
  return null;
}
