import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from '../icon/icon';
import { CODE_LANGUAGES, MENTION_CLASS, isEmptyHtml, sanitizeHtml, textToHtml } from './rich-text';
import { EMOJI_GROUPS, matchEmojiShortcut } from './emoji';

/** Someone the composer can name. Supplied by the host — the editor knows no API. */
export interface MentionCandidate {
  readonly id: string;
  readonly name: string;
  /** Disambiguates two people with the same name. Shown under it. */
  readonly detail?: string;
  readonly avatarUrl?: string | null;
}

/** One toolbar button. `command` is the execCommand name; `state` is what to light up. */
interface Mark {
  readonly command: 'bold' | 'italic' | 'underline' | 'strikeThrough';
  readonly icon: 'bold' | 'italic' | 'underline' | 'strikethrough';
  readonly labelKey: string;
  readonly shortcut?: string;
}

const MARKS: readonly Mark[] = [
  { command: 'bold', icon: 'bold', labelKey: 'editor.bold', shortcut: 'Ctrl+B' },
  { command: 'italic', icon: 'italic', labelKey: 'editor.italic', shortcut: 'Ctrl+I' },
  { command: 'underline', icon: 'underline', labelKey: 'editor.underline', shortcut: 'Ctrl+U' },
  { command: 'strikeThrough', icon: 'strikethrough', labelKey: 'editor.strikethrough' },
];

/**
 * The rich composer. One component for every place an agent writes prose.
 *
 * ## Why `contenteditable` and `execCommand`
 *
 * `execCommand` is deprecated and its replacement is a document model plus a
 * renderer — which is a real editor framework, at roughly a hundred kilobytes.
 * Trackly needs bold, lists, links and code blocks in a reply box. Every browser
 * still implements these commands, none has announced removal, and the whole
 * surface Trackly uses is eleven of them. When that stops being true, this file
 * is the only thing that has to change: the stored format is HTML, and HTML is
 * what any replacement would produce too.
 *
 * ## The two rules that keep this honest
 *
 * 1. **What comes out is sanitised, twice.** Paste is cleaned here so the agent
 *    sees what they will get; the server cleans it again on write, and the
 *    server's pass is the control. Never treat this component's output as safe.
 * 2. **The DOM is the source of truth while focused.** Writing `value` back into
 *    `innerHTML` on every keystroke would move the caret to the start of the
 *    line. The effect below only writes when the incoming value is something
 *    this component did not produce — an external reset, like clearing after
 *    send.
 */
@Component({
  selector: 'tk-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, Icon],
  template: `
    <div class="editor" [class.is-disabled]="disabled()" [class.is-focused]="focused()">
      <div class="editor-toolbar" role="toolbar" [attr.aria-label]="toolbarLabel()">
        <!-- Projected tools lead the toolbar. Attaching a file is a thing you
             decide to do before you write, not a formatting choice you make
             after, so it sits where the eye starts rather than after eleven
             mark buttons. -->
        <ng-content select="[editor-tools]" />

        <button
          #emojiButton
          type="button"
          class="editor-tool"
          [class.is-active]="emojiOpen()"
          [attr.aria-expanded]="emojiOpen()"
          [attr.aria-label]="label('editor.emoji')"
          [title]="label('editor.emoji')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="toggleEmoji()"
        >
          <tk-icon name="smile" [size]="15" />
        </button>

        <span class="editor-tool-divider" aria-hidden="true"></span>

        @for (mark of marks; track mark.command) {
          <button
            type="button"
            class="editor-tool"
            [class.is-active]="active().has(mark.command)"
            [attr.aria-pressed]="active().has(mark.command)"
            [attr.aria-label]="label(mark.labelKey)"
            [title]="titleFor(mark)"
            [disabled]="disabled()"
            (mousedown)="hold($event)"
            (click)="exec(mark.command)"
          >
            <tk-icon [name]="mark.icon" [size]="15" />
          </button>
        }

        <span class="editor-tool-divider" aria-hidden="true"></span>

        <button
          type="button"
          class="editor-tool"
          [class.is-active]="active().has('insertUnorderedList')"
          [attr.aria-pressed]="active().has('insertUnorderedList')"
          [attr.aria-label]="label('editor.bulletList')"
          [title]="label('editor.bulletList')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="exec('insertUnorderedList')"
        >
          <tk-icon name="list" [size]="15" />
        </button>
        <button
          type="button"
          class="editor-tool"
          [class.is-active]="active().has('insertOrderedList')"
          [attr.aria-pressed]="active().has('insertOrderedList')"
          [attr.aria-label]="label('editor.numberedList')"
          [title]="label('editor.numberedList')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="exec('insertOrderedList')"
        >
          <tk-icon name="list-ordered" [size]="15" />
        </button>
        <button
          type="button"
          class="editor-tool"
          [attr.aria-label]="label('editor.quote')"
          [title]="label('editor.quote')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="exec('formatBlock', 'blockquote')"
        >
          <tk-icon name="quote" [size]="15" />
        </button>

        <span class="editor-tool-divider" aria-hidden="true"></span>

        <button
          type="button"
          class="editor-tool"
          [attr.aria-label]="label('editor.inlineCode')"
          [title]="label('editor.inlineCode')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="toggleInlineCode()"
        >
          <tk-icon name="code" [size]="15" />
        </button>
        <button
          type="button"
          class="editor-tool"
          [class.is-active]="inCodeBlock()"
          [attr.aria-pressed]="inCodeBlock()"
          [attr.aria-label]="label('editor.codeBlock')"
          [title]="label('editor.codeBlock')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="insertCodeBlock()"
        >
          <tk-icon name="square-code" [size]="15" />
        </button>

        <!-- The language for the block the caret is in, or for the next one.
             A native select here on purpose: it is a thirty-item list inside a
             toolbar, and the design system's tk-select is a rail-and-form
             control that would dominate the row. -->
        <select
          class="editor-language"
          [attr.aria-label]="label('editor.language')"
          [disabled]="disabled()"
          [ngModel]="language()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="setLanguage($event)"
        >
          @for (option of languages; track option) {
            <option [value]="option">{{ option }}</option>
          }
        </select>

        <span class="editor-tool-divider" aria-hidden="true"></span>

        <button
          type="button"
          class="editor-tool"
          [attr.aria-label]="label('editor.link')"
          [title]="titleWithShortcut('editor.link', 'Ctrl+K')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="openLink()"
        >
          <tk-icon name="link" [size]="15" />
        </button>
        <button
          type="button"
          class="editor-tool"
          [attr.aria-label]="label('editor.unlink')"
          [title]="label('editor.unlink')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="exec('unlink')"
        >
          <tk-icon name="unlink" [size]="15" />
        </button>
        <button
          type="button"
          class="editor-tool"
          [attr.aria-label]="label('editor.clearFormatting')"
          [title]="label('editor.clearFormatting')"
          [disabled]="disabled()"
          (mousedown)="hold($event)"
          (click)="clearFormatting()"
        >
          <tk-icon name="remove-formatting" [size]="15" />
        </button>
      </div>

      <!-- A popover, anchored to the button and moved to <body>.
           An inline panel pushed the whole composer down and swallowed the box
           the agent was writing in. Leaving the DOM is what lets it sit over the
           page: fixed positioning alone is not enough, because a transformed
           ancestor — Trackly's modal animates with one — becomes the containing
           block and then clips it away. Same fix as the combobox. -->
      @if (emojiOpen()) {
        <div
          #emojiPanel
          class="editor-emoji"
          role="dialog"
          [attr.aria-label]="label('editor.emoji')"
          [style.left.px]="emojiAnchor().left"
          [style.top.px]="emojiAnchor().top"
        >
          @for (group of emojiGroups; track group.key) {
            <p class="editor-emoji-group">{{ label('editor.emojiGroups.' + group.key) }}</p>
            <div class="editor-emoji-grid">
              @for (glyph of group.emoji; track glyph) {
                <button
                  type="button"
                  class="editor-emoji-option"
                  [attr.aria-label]="glyph"
                  (mousedown)="hold($event)"
                  (click)="insertEmoji(glyph)"
                >
                  {{ glyph }}
                </button>
              }
            </div>
          }
        </div>
      }

      @if (linkOpen()) {
        <div class="editor-linkbar">
          <input
            #linkInput
            class="editor-linkinput"
            type="url"
            placeholder="https://…"
            [attr.aria-label]="label('editor.linkUrl')"
            [(ngModel)]="linkUrl"
            [ngModelOptions]="{ standalone: true }"
            (keydown.enter)="applyLink(); $event.preventDefault()"
            (keydown.escape)="closeLink()"
          />
          <button type="button" class="editor-linkaction" (click)="applyLink()">
            {{ label('editor.apply') }}
          </button>
          <button type="button" class="editor-linkaction" (click)="closeLink()">
            {{ label('editor.cancel') }}
          </button>
        </div>
      }

      <!-- The mention picker. A list under the toolbar rather than a popover
           anchored to the caret: getting a floating box to follow a caret
           through a scrolling contenteditable is a lot of machinery for a list
           of six names, and a fixed position never lands off-screen. -->
      @if (mentionOpen()) {
        <ul class="editor-mentions" role="listbox" [attr.aria-label]="label('editor.mention')">
          @for (person of mentionMatches(); track person.id; let index = $index) {
            <li>
              <button
                type="button"
                class="editor-mention-option"
                role="option"
                [class.is-active]="index === mentionIndex()"
                [attr.aria-selected]="index === mentionIndex()"
                (mousedown)="hold($event)"
                (click)="pickMention(person)"
              >
                <span class="min-w-0 flex-1 truncate">{{ person.name }}</span>
                @if (person.detail) {
                  <span class="editor-mention-detail">{{ person.detail }}</span>
                }
              </button>
            </li>
          } @empty {
            <li class="editor-mention-empty">{{ label('editor.noMatches') }}</li>
          }
        </ul>
      }

      <!-- aria-multiline + role=textbox so it announces as a text field rather
           than as a group of paragraphs. -->
      <div
        #surface
        class="editor-surface"
        role="textbox"
        aria-multiline="true"
        [attr.contenteditable]="disabled() ? null : 'true'"
        [attr.aria-label]="ariaLabel() || placeholder()"
        [attr.data-placeholder]="placeholder()"
        [class.is-empty]="empty()"
        [style.min-height.rem]="minHeightRem()"
        (input)="onInput()"
        (paste)="onPaste($event)"
        (keydown)="onKeydown($event)"
        (focus)="focused.set(true)"
        (blur)="onBlur()"
      ></div>
    </div>
  `,
})
export class Editor {
  /** The HTML body. Sanitised again on the server — see the class comment. */
  readonly value = model<string>('');
  readonly placeholder = input('');
  readonly ariaLabel = input('');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Roughly how tall the writing area starts out, in lines. */
  readonly rows = input(4);

  /**
   * Toolbar wording. Passed in rather than injecting Transloco, because
   * `@trackly/ui` has no locale of its own and a component library that reaches
   * for the app's translation service stops being usable on its own.
   */
  readonly labels = input<Record<string, string>>({});

  /**
   * Who typing `@` can name. Empty disables mentions entirely — which is how a
   * composer that must not notify anyone (a note only its author will read)
   * turns the feature off, rather than by hiding a button that still works.
   */
  readonly mentionable = input<readonly MentionCandidate[]>([]);

  protected readonly marks = MARKS;
  protected readonly languages = CODE_LANGUAGES;

  private readonly surface = viewChild<ElementRef<HTMLElement>>('surface');
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');

  protected readonly focused = signal(false);
  protected readonly active = signal<ReadonlySet<string>>(new Set());
  protected readonly inCodeBlock = signal(false);
  protected readonly language = signal<string>('plaintext');

  protected readonly linkOpen = signal(false);
  protected readonly linkUrl = signal('');

  /** What has been typed after the `@`, or null when no mention is in progress. */
  protected readonly emojiGroups = EMOJI_GROUPS;
  protected readonly emojiOpen = signal(false);

  private readonly mentionQuery = signal<string | null>(null);
  protected readonly mentionIndex = signal(0);

  protected readonly mentionOpen = computed(
    () => this.mentionQuery() !== null && this.mentionable().length > 0,
  );

  /**
   * Six at most. A mention picker is a shortcut, not a directory — if the right
   * person is not in the first few, typing another letter is faster than reading
   * a list of forty.
   */
  protected readonly mentionMatches = computed<readonly MentionCandidate[]>(() => {
    const query = (this.mentionQuery() ?? '').toLowerCase();
    const people = this.mentionable();
    if (!query) return people.slice(0, 6);
    return people
      .filter(
        (person) =>
          person.name.toLowerCase().includes(query) ||
          (person.detail ?? '').toLowerCase().includes(query),
      )
      .slice(0, 6);
  });

  protected readonly empty = computed(() => isEmptyHtml(this.value()));
  protected readonly minHeightRem = computed(() => Math.max(2, this.rows()) * 1.5);

  /**
   * The last HTML this component put into `value`.
   *
   * The write-back effect compares against it to tell "the user typed" from
   * "someone reset us". Without that check the caret jumps to the start of the
   * document on every keystroke.
   */
  private lastEmitted = '';

  /** Where the caret was before the toolbar's link input stole focus. */
  private savedRange: Range | null = null;

  constructor() {
    // Enter should produce <p>, not Chrome's default <div>. The prose styles are
    // written for paragraphs, so without this every new line loses its spacing —
    // and the body that reaches the server is a pile of divs rather than
    // something that reads the same in an email client.
    //
    // It is a document-level setting and setting it repeatedly is harmless; it
    // throws in browsers that do not know the command, which is not a reason to
    // fail loading the composer.
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* the default separator stays whatever the browser prefers */
    }

    effect(() => {
      const incoming = this.value();
      const element = this.surface()?.nativeElement;
      if (!element || incoming === this.lastEmitted) return;
      element.innerHTML = incoming;
      this.lastEmitted = incoming;
    });

    // Focus the link input once it actually exists. An effect rather than a
    // timeout: the input is inside an @if, so it is not in the DOM at the moment
    // the flag flips, and the query signal re-runs this when it arrives.
    effect(() => {
      if (this.linkOpen()) this.linkInput()?.nativeElement.focus();
    });

    // Selection changes are a document-level event: there is no element event
    // that fires when the caret moves with an arrow key. Filtered to our own
    // surface so two editors on one page do not fight over the toolbar state.
    const onSelectionChange = () => {
      this.refreshState();
      // Also here, not only on input: moving the caret back into a half-typed
      // name with an arrow key or a click is exactly when the list is wanted
      // again, and neither of those fires an input event.
      this.trackMention();
    };
    document.addEventListener('selectionchange', onSelectionChange);

    // Move the popover to <body> the moment it exists.
    //
    // Fixed positioning is not enough on its own: a transformed ancestor becomes
    // the containing block for fixed descendants, and Trackly's modal animates
    // in with a transform — so inside a dialog this would be positioned against
    // the modal and then clipped away by its overflow. The element has to leave.
    // Angular still owns it: it created it, its bindings keep updating, and it
    // removes it by asking for the node's CURRENT parent.
    effect(() => {
      const panel = this.emojiPanel()?.nativeElement;
      if (panel && panel.parentElement !== document.body) document.body.appendChild(panel);
    });

    // A popover that stays put while the page scrolls under it is worse than one
    // that closes. Capture phase, because the scroll that matters is usually an
    // ancestor's and scroll events do not bubble.
    const reposition = () => {
      if (this.emojiOpen()) this.measureEmoji();
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // Anywhere outside the panel and its button closes it. Pointerdown, not
    // click: the emoji buttons act on click, and a click-based close would fire
    // first and remove the button being pressed.
    const onPointerDown = (event: Event) => {
      if (!this.emojiOpen()) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (this.emojiPanel()?.nativeElement.contains(target)) return;
      if (this.emojiButton()?.nativeElement.contains(target)) return;
      this.emojiOpen.set(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('pointerdown', onPointerDown, true);
      // Angular cannot reach a node it no longer owns the parent of if the
      // component is torn down while the panel is open.
      this.emojiPanel()?.nativeElement.remove();
    });
  }

  /** Puts the caret in the writing area — for a parent that wants focus on open. */
  focus(): void {
    this.surface()?.nativeElement.focus();
  }

  protected label(key: string): string {
    return this.labels()[key] ?? FALLBACK_LABELS[key] ?? key;
  }

  protected titleFor(mark: Mark): string {
    return this.titleWithShortcut(mark.labelKey, mark.shortcut);
  }

  protected titleWithShortcut(key: string, shortcut?: string): string {
    const text = this.label(key);
    return shortcut ? `${text} (${shortcut})` : text;
  }

  protected toolbarLabel(): string {
    return this.label('editor.toolbar');
  }

  /**
   * Keeps focus in the writing area when a toolbar button is pressed.
   *
   * A button taking focus collapses the selection, and every command below
   * operates on the selection — so without this, "select a word, click Bold"
   * bolds nothing at all.
   */
  protected hold(event: MouseEvent): void {
    event.preventDefault();
  }

  protected exec(command: string, argument?: string): void {
    if (this.disabled()) return;
    this.surface()?.nativeElement.focus();
    document.execCommand(command, false, argument);
    this.pull();
    this.refreshState();
  }

  /**
   * Every keystroke: convert a finished emoticon, then publish.
   *
   * The order matters. `replaceShortcut` edits the DOM, so publishing first
   * would emit the `:-)` the user typed and leave the 🙂 unpublished until the
   * next keystroke — send at that moment and the message goes out with the
   * shortcut still in it.
   */
  protected onInput(): void {
    this.replaceShortcut();
    this.pull();
  }

  /** Reads the DOM back into `value`. Called after every mutation, ours or theirs. */
  protected pull(): void {
    const element = this.surface()?.nativeElement;
    if (!element) return;
    const html = element.innerHTML;
    this.lastEmitted = html;
    this.value.set(html);
    this.trackMention();
  }

  // ---- Emoji ---------------------------------------------------------------

  /** Viewport coordinates for the popover. Recomputed on open, scroll and resize. */
  protected readonly emojiAnchor = signal({ left: 0, top: 0 });

  private readonly emojiButton = viewChild<ElementRef<HTMLElement>>('emojiButton');
  private readonly emojiPanel = viewChild<ElementRef<HTMLElement>>('emojiPanel');

  protected toggleEmoji(): void {
    if (this.emojiOpen()) {
      this.emojiOpen.set(false);
      return;
    }
    this.measureEmoji();
    this.emojiOpen.set(true);
  }

  /**
   * Places the popover under the button, flipping above when there is no room.
   *
   * The composer usually sits at the BOTTOM of a ticket, so below is often the
   * side without space — a panel that only ever hung downwards would open
   * off-screen on the most common screen in the product.
   */
  private measureEmoji(): void {
    const button = this.emojiButton()?.nativeElement;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const gap = 6;
    const width = 320;
    const height = 300;

    const below = window.innerHeight - rect.bottom - gap;
    const preferBelow = below >= height || below >= rect.top - gap;

    this.emojiAnchor.set({
      // Clamped to the viewport so a button near the right edge does not push
      // the panel off it.
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: preferBelow ? rect.bottom + gap : Math.max(8, rect.top - gap - height),
    });
  }

  /**
   * Drops a glyph in at the caret.
   *
   * `insertText`, not `insertHTML`: an emoji is a character, so the browser
   * handles it as one — it lands inside whatever formatting is already active,
   * backspaces as a unit, and needs no markup that the sanitiser would then have
   * to be taught about.
   */
  protected insertEmoji(glyph: string): void {
    this.emojiOpen.set(false);
    this.exec('insertText', glyph);
  }

  /**
   * Turns `:-)` into 🙂 as it is typed, the way Teams and WhatsApp do.
   *
   * Runs off the text before the caret — the same mechanism as mentions, and for
   * the same reason: watching keystrokes gets it wrong the moment somebody
   * backspaces into a half-typed shortcut.
   *
   * Returns true when it replaced something, so the caller knows the DOM moved
   * under it and the value it was about to publish is already stale.
   */
  private replaceShortcut(): boolean {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !this.ownsSelection()) return false;

    const offset = selection!.anchorOffset;
    const before = (node.textContent ?? '').slice(0, offset);
    const found = matchEmojiShortcut(before);
    if (!found) return false;

    // Select back over the shortcut so the insert replaces it rather than
    // appending after it.
    const range = document.createRange();
    range.setStart(node, offset - found.code.length);
    range.setEnd(node, offset);
    selection!.removeAllRanges();
    selection!.addRange(range);

    document.execCommand('insertText', false, found.emoji);
    return true;
  }

  // ---- Mentions ------------------------------------------------------------
  //
  // Driven off the text immediately before the caret rather than off keystrokes.
  // Keystroke tracking gets it wrong the moment somebody uses an arrow key, a
  // backspace or a click to move back into a half-typed name — which is exactly
  // when they want the list again.

  private trackMention(): void {
    if (this.mentionable().length === 0) {
      this.mentionQuery.set(null);
      return;
    }

    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !this.ownsSelection()) {
      this.mentionQuery.set(null);
      return;
    }

    const before = (node.textContent ?? '').slice(0, selection!.anchorOffset);
    // `@` at a word boundary, then anything that is not whitespace. Requiring a
    // boundary is what stops an email address turning into a picker.
    const match = /(?:^|[\s( ])@([^\s@]{0,30})$/.exec(before);
    if (!match) {
      this.mentionQuery.set(null);
      return;
    }

    this.mentionQuery.set(match[1]);
    this.mentionIndex.set(0);
  }

  private closeMention(): void {
    this.mentionQuery.set(null);
  }

  /**
   * Replaces the typed `@query` with a chip.
   *
   * The chip is `contenteditable="false"` so it deletes as one unit — a name
   * that can be backspaced letter by letter into `<span>Pri</span>` would still
   * carry the user id and would still notify Priya.
   */
  protected pickMention(person: MentionCandidate): void {
    const query = this.mentionQuery();
    if (query === null) return;

    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    // Select back over "@query" so insertHTML replaces it.
    const end = selection!.anchorOffset;
    const start = end - query.length - 1;
    if (start < 0) return;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    selection!.removeAllRanges();
    selection!.addRange(range);

    const holder = document.createElement('div');
    const chip = document.createElement('span');
    chip.className = MENTION_CLASS;
    chip.setAttribute('data-user-id', person.id);
    chip.setAttribute('contenteditable', 'false');
    chip.textContent = `@${person.name}`;
    holder.appendChild(chip);

    this.closeMention();
    // The trailing space is what lets the next word be typed without landing
    // inside the chip.
    this.exec('insertHTML', `${holder.innerHTML}&nbsp;`);
  }

  protected onBlur(): void {
    this.focused.set(false);
    // pull() first — it re-evaluates the mention state, so closing before it
    // would just reopen the picker on the way out.
    this.pull();
    this.closeMention();
  }

  /**
   * Paste, cleaned.
   *
   * This is the whole point of intercepting it: a copy from Word, Google Docs
   * or Outlook carries hundreds of `style`, `class` and `mso-*` attributes, and
   * pasting them raw drops another document's typography into the middle of a
   * reply. The text and its structure are kept; everything decorative goes.
   *
   * Shift+Paste bypasses formatting entirely — the browser's own convention, and
   * one people already know.
   */
  protected onPaste(event: ClipboardEvent): void {
    if (this.disabled()) return;
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();

    const plain = data.getData('text/plain');
    // Inside a code block, formatting is never wanted: pasting a styled snippet
    // into <pre> would nest markup in something meant to be literal.
    if (this.inCodeBlock()) {
      document.execCommand('insertText', false, plain);
      this.pull();
      return;
    }

    const html = data.getData('text/html');
    const fragment = html ? sanitizeHtml(html) : textToHtml(plain);
    document.execCommand('insertHTML', false, fragment);
    this.pull();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;

    // The picker owns the arrows and Enter while it is open, so choosing a name
    // with the keyboard does not also insert a newline behind it.
    if (this.mentionOpen()) {
      const matches = this.mentionMatches();
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.mentionIndex.update((i) => (matches.length ? (i + 1) % matches.length : 0));
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.mentionIndex.update((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
          return;
        case 'Enter':
        case 'Tab': {
          const chosen = matches[this.mentionIndex()];
          if (!chosen) break;
          event.preventDefault();
          this.pickMention(chosen);
          return;
        }
        case 'Escape':
          event.preventDefault();
          this.closeMention();
          return;
      }
    }

    // Enter inside a code block adds a line, it does not leave the block. The
    // way out is the toolbar button or the paragraph the block was inserted with.
    if (event.key === 'Enter' && !event.shiftKey && this.inCodeBlock()) {
      event.preventDefault();
      document.execCommand('insertText', false, '\n');
      this.pull();
      return;
    }

    if (!(event.ctrlKey || event.metaKey)) return;
    switch (event.key.toLowerCase()) {
      case 'b':
        event.preventDefault();
        this.exec('bold');
        break;
      case 'i':
        event.preventDefault();
        this.exec('italic');
        break;
      case 'u':
        event.preventDefault();
        this.exec('underline');
        break;
      case 'k':
        event.preventDefault();
        this.openLink();
        break;
    }
  }

  protected toggleInlineCode(): void {
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    if (!text) return;
    // No execCommand produces <code>, so this is a wrap. Escaping is left to
    // insertHTML's own handling of the text node we build.
    const holder = document.createElement('div');
    const code = document.createElement('code');
    code.textContent = text;
    holder.appendChild(code);
    this.exec('insertHTML', holder.innerHTML);
  }

  /**
   * Wraps the selection in a code block, or starts an empty one.
   *
   * A paragraph is appended after it so there is always somewhere to type once
   * the block is finished — a `pre` as the last node of a contenteditable is a
   * trap you cannot get the caret out of with the keyboard alone.
   */
  protected insertCodeBlock(): void {
    if (this.disabled()) return;
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';

    const holder = document.createElement('div');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = `language-${this.language()}`;
    code.textContent = text || '\n';
    pre.appendChild(code);
    holder.appendChild(pre);

    this.exec('insertHTML', `${holder.innerHTML}<p><br></p>`);
  }

  protected setLanguage(language: string): void {
    this.language.set(language);
    // Retag the block the caret is in, if it is in one. Otherwise this is just
    // the language the next block will get.
    const code = this.currentCode();
    if (!code) return;
    code.className = `language-${language}`;
    this.pull();
  }

  /**
   * Strips formatting from the selection.
   *
   * `removeFormat` handles inline marks but leaves list and quote structure
   * behind, so those are undone explicitly — "clear formatting" that leaves the
   * text in a blockquote has not cleared the thing people are looking at.
   */
  protected clearFormatting(): void {
    if (this.disabled()) return;
    this.surface()?.nativeElement.focus();
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    if (this.active().has('insertUnorderedList')) document.execCommand('insertUnorderedList');
    if (this.active().has('insertOrderedList')) document.execCommand('insertOrderedList');
    document.execCommand('formatBlock', false, 'p');
    this.pull();
    this.refreshState();
  }

  protected openLink(): void {
    if (this.disabled()) return;
    const selection = window.getSelection();
    // Saved because the input below takes focus, which collapses the selection
    // the link is supposed to wrap.
    this.savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    this.linkUrl.set(this.currentHref() ?? '');
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.savedRange = null;
    this.surface()?.nativeElement.focus();
  }

  protected applyLink(): void {
    const url = this.linkUrl().trim();
    // Silently refusing a non-http(s) URL rather than storing it: the server
    // would strip it on write anyway, and a link that vanishes on save is worse
    // than one that never appeared.
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) return;

    this.restoreRange();
    const selection = window.getSelection();
    if (selection && selection.isCollapsed) {
      // No selection: insert the URL as its own link rather than doing nothing.
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.textContent = url;
      const holder = document.createElement('div');
      holder.appendChild(anchor);
      document.execCommand('insertHTML', false, holder.innerHTML);
    } else {
      document.execCommand('createLink', false, url);
    }

    this.pull();
    this.linkOpen.set(false);
    this.savedRange = null;
    this.surface()?.nativeElement.focus();
  }

  private restoreRange(): void {
    this.surface()?.nativeElement.focus();
    const range = this.savedRange;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /** Which marks are on at the caret, so the toolbar can show it. */
  private refreshState(): void {
    const element = this.surface()?.nativeElement;
    if (!element || !this.ownsSelection()) return;

    const on = new Set<string>();
    for (const command of [
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'insertUnorderedList',
      'insertOrderedList',
    ]) {
      // queryCommandState throws on a detached selection in some browsers, and
      // a toolbar highlight is never worth an exception.
      try {
        if (document.queryCommandState(command)) on.add(command);
      } catch {
        /* leave it off */
      }
    }
    this.active.set(on);

    const code = this.currentCode();
    this.inCodeBlock.set(!!code);
    if (code) {
      const match = /language-([\w+-]+)/.exec(code.className);
      if (match) this.language.set(match[1]);
    }
  }

  private ownsSelection(): boolean {
    const element = this.surface()?.nativeElement;
    const node = window.getSelection()?.anchorNode;
    return !!element && !!node && element.contains(node);
  }

  /** The `code` element inside a `pre` that the caret sits in, if any. */
  private currentCode(): HTMLElement | null {
    if (!this.ownsSelection()) return null;
    const node = window.getSelection()?.anchorNode ?? null;
    const start = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
    const pre = start?.closest('pre');
    return (pre?.querySelector('code') as HTMLElement | null) ?? null;
  }

  private currentHref(): string | null {
    if (!this.ownsSelection()) return null;
    const node = window.getSelection()?.anchorNode ?? null;
    const start = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
    return start?.closest('a')?.getAttribute('href') ?? null;
  }
}

/**
 * English, used when the host passes no `labels`.
 *
 * Not a translation layer — the app always passes its own. These exist so the
 * component is not mute in a test, a story, or the first five minutes of being
 * dropped into a new screen.
 */
const FALLBACK_LABELS: Record<string, string> = {
  'editor.toolbar': 'Formatting',
  'editor.emoji': 'Emoji',
  'editor.emojiGroups.faces': 'Faces',
  'editor.emojiGroups.gestures': 'Gestures',
  'editor.emojiGroups.work': 'Work',
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.bulletList': 'Bullet list',
  'editor.numberedList': 'Numbered list',
  'editor.quote': 'Quote',
  'editor.inlineCode': 'Inline code',
  'editor.codeBlock': 'Code block',
  'editor.language': 'Code language',
  'editor.link': 'Link',
  'editor.linkUrl': 'Link URL',
  'editor.unlink': 'Remove link',
  'editor.clearFormatting': 'Clear formatting',
  'editor.apply': 'Apply',
  'editor.cancel': 'Cancel',
  'editor.mention': 'Mention someone',
  'editor.noMatches': 'Nobody by that name',
};
