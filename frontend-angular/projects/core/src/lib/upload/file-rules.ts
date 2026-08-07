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

/** What the avatar and logo endpoints accept, as an `accept` attribute. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

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
