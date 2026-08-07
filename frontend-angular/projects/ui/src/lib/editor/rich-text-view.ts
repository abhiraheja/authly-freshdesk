import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

/**
 * Renders a stored body — the one place that decides between markup and text.
 *
 * **It branches on the stored format, it never sniffs the string.** A customer
 * who writes "&lt;3 that fix" produces text that looks exactly like markup, and
 * guessing wrong shows them a broken tag instead of their own words. The server
 * says which it is; this obeys.
 *
 * `[innerHTML]` runs Angular's sanitizer on every render, which is the third
 * pass over this content after the composer and the API. That is deliberate:
 * the body can reach the database from anything that can post JSON, and old
 * rows were written under whatever rules applied at the time.
 */
@Component({
  selector: 'tk-rich-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (isHtml()) {
      <div class="rich-text" [class.on-dark]="dark()" [innerHTML]="value()"></div>
    } @else {
      <p class="whitespace-pre-wrap text-body" [class.text-white]="dark()">{{ value() }}</p>
    }
  `,
})
export class RichTextView {
  readonly value = input<string>('');
  /** "html" or "text", straight from the API. Anything unknown renders as text. */
  readonly format = input<string>('text');
  /** Inverted bubble — an agent's public reply. */
  readonly dark = input(false, { transform: booleanAttribute });

  protected readonly isHtml = computed(() => this.format() === 'html');
}
