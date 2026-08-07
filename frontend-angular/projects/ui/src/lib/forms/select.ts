import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  contentChildren,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * One row of a {@link Select}. Renders nothing itself — the select reads its
 * `value`/`label` and draws its own list.
 *
 * `label` is an input rather than projected content so call sites keep using
 * the transloco pipe in the template, while the select still has the text as
 * plain data. Reading it back out of the DOM would mean a MutationObserver and
 * a render-timing dance for no gain.
 */
@Component({
  selector: 'tk-option',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class SelectOption {
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}

/**
 * A `<select>` replacement: styled trigger, styled option list.
 *
 * **Why this exists.** A native select's popup is drawn by the operating
 * system. It ignores the token palette, the border radius, and dark mode
 * completely — there is no CSS that reaches it. The closed control could be
 * styled, so the two never matched: a Trackly-looking box that opened into a
 * stark OS list. Owning the list is the only way to fix that.
 *
 * ```html
 * <tk-select inset [(value)]="priority" [ariaLabel]="'Priority' | transloco">
 *   <tk-option value="" [label]="'All priorities' | transloco" />
 *   @for (option of priorityOptions(); track option.id) {
 *     <tk-option [value]="option.value" [label]="option.label" />
 *   }
 * </tk-select>
 * ```
 *
 * Two-way `value` binds straight to a signal, and `(valueChange)` alone works
 * for the read-from-the-URL case where the value is not locally owned.
 */
@Component({
  selector: 'tk-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'relative',
    '[class.block]': '!auto()',
    '[class.inline-block]': 'auto()',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      [class]="triggerClasses()"
      [id]="inputId()"
      [attr.name]="inputId()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="activeId()"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      <span class="select-value" [class.select-placeholder]="!selected()">
        {{ selected()?.label() ?? placeholder() }}
      </span>
      <tk-icon name="chevron-down" [size]="16" class="select-caret" />
    </button>

    @if (open()) {
      <ul
        #list
        class="menu animate-float-in absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto"
        role="listbox"
        [id]="listId"
      >
        @for (option of options(); track option; let i = $index) {
          <li role="none">
            <!-- mousedown, not click: click lands after focusout, by which time
                 the list has closed and the row no longer exists. -->
            <button
              type="button"
              role="option"
              class="menu-item"
              [id]="listId + '-' + i"
              [class.is-highlighted]="i === highlighted()"
              [class.active]="option.value() === value()"
              [attr.aria-selected]="option.value() === value()"
              [disabled]="option.disabled()"
              (mousedown)="$event.preventDefault(); choose(option)"
            >
              <span class="truncate">{{ option.label() }}</span>
              @if (option.value() === value()) {
                <tk-icon name="check" [size]="14" class="ml-auto shrink-0" />
              }
            </button>
          </li>
        }
      </ul>
    }

    <!-- tk-option renders nothing; this only guarantees the content is
         instantiated so the query below has something to read. -->
    <div hidden><ng-content /></div>
  `,
})
export class Select {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly value = model('');
  readonly placeholder = input('');
  readonly inputId = input<string>();
  readonly ariaLabel = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly size = input<'sm' | 'md'>('md');
  /** Muted fill, no idle border — matches `tkInput inset`. */
  readonly inset = input(false, { transform: booleanAttribute });
  /** Shrink to fit instead of filling the row — filter bars. */
  readonly auto = input(false, { transform: booleanAttribute });

  protected readonly options = contentChildren(SelectOption, { descendants: true });
  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  protected readonly listId = `tk-select-${nextId++}`;

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly list = viewChild<ElementRef<HTMLUListElement>>('list');

  /** Typeahead buffer, the way a native select behaves: "de" jumps to Design. */
  private typed = '';
  private typedAt = 0;

  protected readonly selected = computed(() => {
    const current = this.value();
    return this.options().find((option) => option.value() === current);
  });

  protected readonly activeId = computed(() => {
    const index = this.highlighted();
    return this.open() && index >= 0 ? `${this.listId}-${index}` : null;
  });

  /** Static class names only — an interpolated Tailwind class emits no CSS. */
  protected readonly triggerClasses = computed(() =>
    [
      'select-trigger input',
      this.size() === 'sm' ? 'input-sm' : '',
      this.inset() ? 'input-inset' : '',
      this.auto() ? 'input-auto' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  constructor() {
    // After render, not inside a plain effect: the row being scrolled to only
    // exists once the list has actually been laid out.
    afterRenderEffect(() => {
      const list = this.list()?.nativeElement;
      const index = this.highlighted();
      if (!list || index < 0) return;
      list.querySelectorAll('[role="option"]')[index]?.scrollIntoView({ block: 'nearest' });
    });
  }

  protected toggle(): void {
    this.open() ? this.close() : this.openList();
  }

  protected choose(option: SelectOption): void {
    if (option.disabled()) return;
    this.value.set(option.value());
    this.close();
    this.trigger().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.openList();
          return;
        }
        this.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Home':
      case 'End': {
        if (!this.open()) return;
        event.preventDefault();
        this.highlighted.set(event.key === 'Home' ? -1 : 0);
        this.move(event.key === 'Home' ? 1 : -1);
        return;
      }
      case 'Enter':
      case ' ': {
        // Space must not scroll the page, and Enter must not submit the
        // surrounding form while the list is being used as a list.
        event.preventDefault();
        if (!this.open()) {
          this.openList();
          return;
        }
        const option = this.options()[this.highlighted()];
        if (option) this.choose(option);
        return;
      }
      case 'Escape':
        if (this.open()) {
          // Stops here so Esc closes the list without also closing the dialog
          // the select happens to be sitting in.
          event.stopPropagation();
          this.close();
        }
        return;
      case 'Tab':
        this.close();
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.typeahead(event.key);
        }
        return;
    }
  }

  /** Closes only when focus leaves the component entirely. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) return;
    this.close();
  }

  private openList(): void {
    if (this.disabled()) return;
    // Opens on the current value so the list starts where the user left it.
    this.highlighted.set(this.options().findIndex((option) => option.value() === this.value()));
    this.open.set(true);
  }

  private close(): void {
    this.open.set(false);
    this.highlighted.set(-1);
    this.typed = '';
  }

  /**
   * Steps the cursor, skipping disabled rows and wrapping. Bounded by the option
   * count so an all-disabled list terminates instead of spinning.
   */
  private move(step: number): void {
    const options = this.options();
    if (!options.length) return;

    let index = this.highlighted();
    for (let attempt = 0; attempt < options.length; attempt++) {
      index = (index + step + options.length) % options.length;
      if (!options[index].disabled()) {
        this.highlighted.set(index);
        return;
      }
    }
  }

  /**
   * Jumps to the first option starting with what was typed. Keystrokes inside a
   * second of each other build a prefix ("de" → Design); after that the buffer
   * resets, so a later "d" starts a fresh search rather than extending a stale
   * one.
   */
  private typeahead(key: string): void {
    const now = Date.now();
    this.typed = now - this.typedAt > 1000 ? key : this.typed + key;
    this.typedAt = now;

    const prefix = this.typed.toLowerCase();
    const index = this.options().findIndex(
      (option) => !option.disabled() && option.label().toLowerCase().startsWith(prefix),
    );
    if (index < 0) return;

    if (!this.open()) {
      this.value.set(this.options()[index].value());
      return;
    }
    this.highlighted.set(index);
  }
}

let nextId = 0;
