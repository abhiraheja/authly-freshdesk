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
import { CODE_LANGUAGES, isEmptyHtml, sanitizeHtml, textToHtml } from './rich-text';

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

        <ng-content select="[editor-tools]" />
      </div>

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
        (input)="pull()"
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
    const onSelectionChange = () => this.refreshState();
    document.addEventListener('selectionchange', onSelectionChange);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('selectionchange', onSelectionChange),
    );
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

  /** Reads the DOM back into `value`. Called after every mutation, ours or theirs. */
  protected pull(): void {
    const element = this.surface()?.nativeElement;
    if (!element) return;
    const html = element.innerHTML;
    this.lastEmitted = html;
    this.value.set(html);
  }

  protected onBlur(): void {
    this.focused.set(false);
    this.pull();
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
};
