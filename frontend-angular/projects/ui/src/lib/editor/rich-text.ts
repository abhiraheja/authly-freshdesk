/**
 * The client half of Trackly's rich-text allowlist.
 *
 * It mirrors `RichText` on the server, and the server is the one that counts —
 * this runs so that what an agent pastes *looks* like what will be stored, and
 * so a paste from Word or Google Docs does not drop three kilobytes of
 * `<span style="mso-…">` into the composer. It is a courtesy, never a control.
 *
 * Keep the two lists in step. If they drift, the visible symptom is formatting
 * that survives the composer and vanishes on save, which is a maddening bug to
 * chase from the outside.
 */

/** Tags kept as-is. Everything else is unwrapped, keeping its text. */
const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'DIV',
  'SPAN',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'STRIKE',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'H3',
  'H4',
  'A',
  'HR',
]);

/** Tags whose *content* goes too — a pasted `<style>` block is not text. */
const DROP_ENTIRELY = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT']);

const ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
  A: ['href', 'title'],
  CODE: ['class'],
  PRE: ['class'],
  // A mention chip. The id is re-checked against workspace membership on the
  // server before anyone is notified — surviving here only means well-formed.
  SPAN: ['class', 'data-user-id'],
};

/** The class the composer marks a mention with. Must match the server. */
export const MENTION_CLASS = 'mention';

/** Languages the code-block picker offers. Must match `CodeLanguages` on the server. */
export const CODE_LANGUAGES = [
  'plaintext',
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'dart',
  'diff',
  'dockerfile',
  'go',
  'graphql',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'log',
  'markdown',
  'php',
  'powershell',
  'python',
  'ruby',
  'rust',
  'scss',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const LANGUAGE_CLASSES = new Set([
  ...CODE_LANGUAGES.map((language) => `language-${language}`),
  MENTION_CLASS,
]);

/**
 * Cleans an HTML fragment down to the allowlist.
 *
 * Unknown *tags* are unwrapped rather than deleted, because a paste from a real
 * document is mostly `<table>`, `<font>` and `<span>` wrapped around the words
 * somebody actually wants. Deleting the tag deletes the sentence with it.
 */
export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${flattenTables(html)}</body>`, 'text/html');
  clean(parsed.body);
  return parsed.body.innerHTML;
}

/**
 * Table structure → spaces and line breaks, before the cells are unwrapped.
 *
 * Trackly does not render tables in a reply, so `<td>` is unwrapped like any
 * other unknown tag — and unwrapping alone runs every cell together into one
 * word. Somebody pasting from a spreadsheet should still be able to read it.
 * The server does the same thing for the same reason.
 */
function flattenTables(html: string): string {
  return html.replace(/<\/t[dh]\s*>/gi, ' ').replace(/<\/tr\s*>/gi, '<br>');
}

/** Plain text → an HTML fragment, newlines preserved. */
export function textToHtml(text: string): string {
  return escapeHtml(text).split(/\r?\n/).join('<br>');
}

export function escapeHtml(text: string): string {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

/** True when nothing renderable survives — what an emptied editor serialises to. */
export function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  const el = document.createElement('div');
  el.innerHTML = html;
  // A lone <br> or an &nbsp; is what a contenteditable leaves behind after the
  // last character is deleted, and it is not something anyone typed.
  if (el.querySelector('img, hr, pre')) return false;
  return (el.textContent ?? '').replace(/ /g, ' ').trim().length === 0;
}

function clean(root: Element): void {
  // Snapshot first: unwrapping mutates childNodes while we walk it.
  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) continue;

    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }

    const element = node as Element;
    const tag = element.tagName.toUpperCase();

    if (DROP_ENTIRELY.has(tag)) {
      element.remove();
      continue;
    }

    clean(element);

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(element);
      continue;
    }

    stripAttributes(element, tag);
  }
}

function stripAttributes(element: Element, tag: string): void {
  const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];
  for (const attribute of [...element.attributes]) {
    if (!allowed.includes(attribute.name.toLowerCase())) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (attribute.name.toLowerCase() === 'class') {
      // The only classes that mean anything to Trackly are the code language
      // and the mention marker; everything else is another app's stylesheet.
      const kept = attribute.value.split(/\s+/).filter((name) => LANGUAGE_CLASSES.has(name));
      if (kept.length) element.setAttribute('class', kept.join(' '));
      else element.removeAttribute('class');
    }
  }

  // A data-user-id without the mention class is not a mention — it is an
  // attribute somebody's stylesheet or another app left behind.
  if (tag === 'SPAN' && !element.classList.contains(MENTION_CLASS)) {
    element.removeAttribute('data-user-id');
  }

  if (tag === 'A') {
    // Anything that is not http(s) or mailto is dropped, not "fixed". A
    // `javascript:` href in a pasted fragment is not a formatting problem.
    const href = element.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:)/i.test(href.trim())) {
      unwrap(element);
      return;
    }
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
  }
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}
