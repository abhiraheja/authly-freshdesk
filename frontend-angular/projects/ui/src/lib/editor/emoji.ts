/**
 * Emoticons and the picker set.
 *
 * **Emoji are plain text, and that is the whole design.** They travel as Unicode
 * characters inside the message body, so they survive the sanitiser (which
 * strips tags, never text), the plain-text flattening that builds email
 * previews, and every connector that carries a string. Nothing here needs a
 * special case anywhere downstream — which is exactly why it is not an image, a
 * span with a class, or a custom element.
 */

/**
 * What Teams and WhatsApp turn into a face as you type.
 *
 * Longest-first is load-bearing: `:-)` has to be tested before `:)`, or the
 * three-character form would never match and would be left as `:-` plus a
 * smiley. The map below is ordered, and `SHORTCUTS` preserves that order.
 */
const SHORTCUT_PAIRS: readonly (readonly [string, string])[] = [
  // Three characters first.
  [':-)', '🙂'],
  [':-D', '😄'],
  [':-(', '🙁'],
  [':-P', '😛'],
  [':-p', '😛'],
  [':-O', '😮'],
  [':-o', '😮'],
  [':-*', '😘'],
  [':-|', '😐'],
  [':-/', '😕'],
  [';-)', '😉'],
  ['>:-(', '😠'],
  ["':-(", '😥'],
  // Then the two-character forms.
  [':)', '🙂'],
  [':D', '😄'],
  [':(', '🙁'],
  [':P', '😛'],
  [':p', '😛'],
  [':O', '😮'],
  [':o', '😮'],
  [':*', '😘'],
  [':|', '😐'],
  [';)', '😉'],
  ['xD', '😆'],
  ['XD', '😆'],
  ['<3', '❤️'],
  [':+1:', '👍'],
  [':-1:', '👎'],
  ['(y)', '👍'],
  ['(n)', '👎'],
];

/**
 * Sorted longest-first so a prefix can never win over the longer form it starts.
 *
 * `:/` is deliberately absent. It is the tail of every `http://` and `https://`
 * anybody pastes, and a URL that silently grew a face in the middle is a worse
 * bug than a missing shortcut.
 */
export const EMOJI_SHORTCUTS: readonly (readonly [string, string])[] = [...SHORTCUT_PAIRS].sort(
  (a, b) => b[0].length - a[0].length,
);

/** The longest shortcut, so the caret scan only ever looks back that far. */
const LONGEST = Math.max(...EMOJI_SHORTCUTS.map(([code]) => code.length));

/**
 * Finds a shortcut ending exactly at the end of `before`.
 *
 * Returns what to replace and what with, or null. **A word boundary is
 * required** — start of line, whitespace, or an opening bracket — which is what
 * stops `http://` and a timestamp like `10:00` from turning into faces.
 */
export function matchEmojiShortcut(before: string): { code: string; emoji: string } | null {
  const tail = before.slice(-LONGEST);

  for (const [code, emoji] of EMOJI_SHORTCUTS) {
    if (!tail.endsWith(code)) continue;

    const preceding = before.slice(0, before.length - code.length);
    // Nothing before it, or a space/newline/opening bracket. Anything else means
    // it is part of a longer token and was never meant as a face.
    if (preceding.length === 0 || /[\s( ]$/.test(preceding)) {
      return { code, emoji };
    }
  }
  return null;
}

/** One group in the picker. */
export interface EmojiGroup {
  /** i18n key under `editor.emojiGroups`. */
  readonly key: string;
  readonly emoji: readonly string[];
}

/**
 * The picker set.
 *
 * Deliberately short. A full Unicode picker needs search, skin-tone variants,
 * lazy rendering and a recents list, and none of that helps somebody adding a
 * thumbs-up to "will do". These are the ones a support desk actually sends; the
 * shortcuts above cover the rest of the common ground.
 */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    key: 'faces',
    emoji: [
      '🙂', '😄', '😅', '😂', '🙃', '😉', '😊', '😍',
      '😘', '😛', '😜', '🤔', '😐', '😑', '🙄', '😏',
      '😕', '🙁', '😢', '😭', '😤', '😠', '😳', '😴',
      '😮', '😱', '🤯', '🤗', '🤝', '🙏', '💪', '🫶',
    ],
  },
  {
    key: 'gestures',
    emoji: ['👍', '👎', '👌', '✌️', '👋', '👀', '🎉', '🔥', '⭐', '❤️', '💯', '✅'],
  },
  {
    key: 'work',
    emoji: ['📌', '📎', '📝', '📅', '⏰', '🚀', '🐛', '🔧', '⚠️', '❌', '💡', '📈'],
  },
];
