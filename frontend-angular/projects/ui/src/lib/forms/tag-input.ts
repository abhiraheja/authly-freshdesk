import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';
import { FloatingMenu } from '../overlay/floating-menu';

/**
 * Multi-value free-text field: selected values become chips, the rest of the
 * workspace's values are offered as suggestions.
 *
 * Two behaviours make it usable rather than merely functional:
 *
 * - **Suggestions exclude what is already chosen.** A list that keeps offering
 *   the chip sitting right next to it is noise, and picking it a second time
 *   does nothing — so the list only ever shows moves that change something.
 * - **Duplicates are folded case-insensitively.** "Billing" and "billing" are
 *   one tag to the server, so letting both sit in the box would promise a
 *   distinction that the save then silently drops.
 *
 * Like {@link Combobox} this creates nothing — it emits `string[]` and the
 * caller decides when those names become rows.
 */
@Component({
  selector: 'tk-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, FloatingMenu],
  host: {
    class: 'relative block',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <!-- Clicking the padding around the chips focuses the caret, which is what
         a text field is expected to do. The template ref is used directly:
         a viewChild named "field" would be shadowed by the ref itself. -->
    <div class="tag-field" [class.tag-field-inset]="inset()" (click)="fieldEl.focus()">
      @for (tag of value(); track tag) {
        <span class="tag-chip">
          {{ tag }}
          <button type="button" [attr.aria-label]="removeLabel() + ' ' + tag" (click)="remove(tag); $event.stopPropagation()">
            <tk-icon name="x" [size]="12" />
          </button>
        </span>
      }

      <input
        #fieldEl
        type="text"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        [id]="inputId()"
        [attr.placeholder]="placeholder()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [value]="draft()"
        (input)="onInput($event)"
        (focus)="open.set(true)"
        (keydown)="onKeydown($event)"
      />
    </div>

    @if (open() && (visible().length || canCreate())) {
      <ul #list class="menu" role="listbox" [id]="listId" [tkFloating]="host.nativeElement" matchWidth>
        @for (option of visible(); track option; let i = $index) {
          <li role="none">
            <button
              type="button"
              role="option"
              class="menu-item"
              [id]="listId + '-' + i"
              [class.is-highlighted]="i === highlighted()"
              aria-selected="false"
              (mousedown)="$event.preventDefault(); add(option)"
            >
              <tk-icon name="tag" [size]="14" class="shrink-0 text-muted-foreground" />
              <span class="truncate">{{ option }}</span>
            </button>
          </li>
        }

        @if (canCreate()) {
          <!-- Named explicitly, because creating workspace-wide taxonomy by
               pressing Enter should never be something the user only finds out
               about afterwards. -->
          <li role="none">
            <button
              type="button"
              role="option"
              class="menu-item"
              [id]="listId + '-new'"
              [class.is-highlighted]="highlighted() === visible().length"
              aria-selected="false"
              (mousedown)="$event.preventDefault(); add(draft())"
            >
              <tk-icon name="plus" [size]="14" class="shrink-0 text-primary" />
              <span class="truncate">{{ createLabel() }} “{{ draft().trim() }}”</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class TagInput {
  /** Read from the template — the floating list anchors to it. */
  protected readonly host = inject(ElementRef<HTMLElement>);

  /** Checked on focus-out: once floating, the list is no longer inside the host. */
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  readonly value = model<string[]>([]);
  readonly suggestions = input<readonly string[]>([]);
  readonly placeholder = input('');
  readonly inputId = input<string>();
  readonly maxLength = input(40);
  /** Muted fill, no idle border — matches `tkInput inset`.
   *  booleanAttribute so the bare `inset` attribute works; without it the
   *  empty string a bare attribute passes is a type error, not `true`. */
  readonly inset = input(false, { transform: booleanAttribute });
  readonly removeLabel = input('Remove');
  readonly createLabel = input('Create');

  protected readonly draft = signal('');
  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  protected readonly listId = `tk-tag-input-${nextId++}`;

  private readonly chosen = computed(() => new Set(this.value().map((tag) => tag.toLowerCase())));

  protected readonly visible = computed(() => {
    const query = this.draft().trim().toLowerCase();
    const taken = this.chosen();
    return this.suggestions()
      .filter((option) => !taken.has(option.toLowerCase()))
      .filter((option) => !query || option.toLowerCase().includes(query));
  });

  /** Offer "create" only for a name that is neither already chosen nor already known. */
  protected readonly canCreate = computed(() => {
    const draft = this.draft().trim();
    if (!draft) return false;
    const lower = draft.toLowerCase();
    if (this.chosen().has(lower)) return false;
    return !this.suggestions().some((option) => option.toLowerCase() === lower);
  });

  protected readonly activeId = computed(() => {
    const index = this.highlighted();
    if (!this.open() || index < 0) return null;
    return index === this.visible().length ? `${this.listId}-new` : `${this.listId}-${index}`;
  });

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.open.set(true);
    this.highlighted.set(-1);
  }

  protected add(raw: string): void {
    const tag = raw.trim().slice(0, this.maxLength());
    if (!tag || this.chosen().has(tag.toLowerCase())) {
      this.draft.set('');
      return;
    }
    this.value.update((tags) => [...tags, tag]);
    this.draft.set('');
    this.highlighted.set(-1);
  }

  protected remove(tag: string): void {
    this.value.update((tags) => tags.filter((existing) => existing !== tag));
  }

  protected onKeydown(event: KeyboardEvent): void {
    const options = this.visible();
    const rows = options.length + (this.canCreate() ? 1 : 0);

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!rows) return;
        this.open.set(true);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.highlighted.update((i) => (i + step + rows) % rows);
        return;
      }
      case 'Enter':
      case ',': {
        // A comma is how people type lists, so it commits too. Both are
        // swallowed only when there is something to commit — an empty field
        // must leave Enter free to submit the form.
        const index = this.highlighted();
        const picked = index >= 0 && index < options.length ? options[index] : this.draft();
        if (!picked.trim()) return;
        event.preventDefault();
        this.add(picked);
        return;
      }
      case 'Backspace':
        // Only with an empty caret, or backspacing through a typo would eat the
        // previous chip the moment the field ran dry.
        if (!this.draft() && this.value().length) {
          event.preventDefault();
          this.value.update((tags) => tags.slice(0, -1));
        }
        return;
      case 'Escape':
        if (this.open()) {
          event.stopPropagation();
          this.open.set(false);
          this.highlighted.set(-1);
        }
        return;
      default:
        return;
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) return;
    // The list lives on <body> now, so it is no longer "inside" the host and has
    // to be checked separately — otherwise dragging its scrollbar closes the
    // very list you are scrolling.
    if (next && this.list()?.nativeElement.contains(next)) return;
    // Commit whatever was typed. Losing a half-typed tag because the user
    // clicked the Save button instead of pressing Enter is a real data loss and
    // an easy one to hit.
    if (this.draft().trim()) this.add(this.draft());
    this.open.set(false);
    this.highlighted.set(-1);
  }
}

let nextId = 0;
