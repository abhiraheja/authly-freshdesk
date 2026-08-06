import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * Free-text field with suggestions — "type anything, but here is what already
 * exists".
 *
 * The distinction from a `<select>` is the whole point: a select can only offer
 * what someone has already set up, so a value that doesn't exist yet is
 * unreachable and the user has to leave the form to create it. Here the typed
 * string IS the value; the list is a shortcut and a spelling aid, so existing
 * entries get reused instead of re-typed into near-duplicates.
 *
 * The component never creates anything. It emits a string and the caller
 * decides — which is what lets the ticket form defer every write until the
 * ticket is actually saved.
 *
 * ```html
 * <tk-combobox
 *   inputId="category"
 *   [(value)]="categoryName"
 *   [suggestions]="categoryNames()"
 *   [placeholder]="'Billing, Technical…'"
 * />
 * ```
 */
@Component({
  selector: 'tk-combobox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'relative block',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <input
      class="input pr-9"
      type="text"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      [id]="inputId()"
      [attr.name]="inputId()"
      [attr.placeholder]="placeholder()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="activeId()"
      [disabled]="disabled()"
      [value]="value()"
      (input)="onInput($event)"
      (focus)="open.set(true)"
    />

    <button
      type="button"
      class="absolute right-0 top-0 grid h-full w-9 place-items-center text-muted-foreground"
      tabindex="-1"
      [attr.aria-label]="toggleLabel()"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      <tk-icon name="chevron-down" [size]="16" />
    </button>

    @if (open() && visible().length) {
      <ul class="menu absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto" role="listbox" [id]="listId">
        @for (option of visible(); track option; let i = $index) {
          <li role="none">
            <!-- mousedown, not click: click fires after focusout, by which time
                 the list has already closed and the row is gone. -->
            <button
              type="button"
              role="option"
              class="menu-item"
              [id]="listId + '-' + i"
              [class.is-highlighted]="i === highlighted()"
              [attr.aria-selected]="option === value()"
              (mousedown)="$event.preventDefault(); choose(option)"
            >
              <span class="truncate">{{ option }}</span>
              @if (option === value()) {
                <tk-icon name="check" [size]="14" class="ml-auto shrink-0" />
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class Combobox {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly value = model('');
  readonly suggestions = input<readonly string[]>([]);
  readonly placeholder = input('');
  readonly inputId = input<string>();
  readonly disabled = input(false);
  /** Accessible name for the open/close chevron. */
  readonly toggleLabel = input('Show suggestions');

  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  protected readonly listId = `tk-combobox-${nextId++}`;

  /**
   * Substring match, not prefix — someone hunting for "Billing — EU" will type
   * "eu". An exact match still shows, so the row can confirm "this one already
   * exists" rather than vanishing at the moment it becomes true.
   */
  protected readonly visible = computed(() => {
    const query = this.value().trim().toLowerCase();
    const all = this.suggestions();
    return query ? all.filter((option) => option.toLowerCase().includes(query)) : [...all];
  });

  protected readonly activeId = computed(() => {
    const index = this.highlighted();
    return this.open() && index >= 0 ? `${this.listId}-${index}` : null;
  });

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
    this.open.set(true);
    this.highlighted.set(-1);
  }

  protected choose(option: string): void {
    this.value.set(option);
    this.open.set(false);
    this.highlighted.set(-1);
  }

  protected toggle(): void {
    this.open.update((open) => !open);
    this.highlighted.set(-1);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const options = this.visible();

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!options.length) return;
        this.open.set(true);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // Wraps, so holding one arrow key can reach every option.
        this.highlighted.update((i) => (i + step + options.length) % options.length);
        return;
      }
      case 'Enter':
        // Only swallow Enter when it is actually picking something — otherwise
        // it must stay free to submit the surrounding form.
        if (this.open() && this.highlighted() >= 0) {
          event.preventDefault();
          this.choose(options[this.highlighted()]);
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

  /**
   * Closes only when focus leaves the component entirely. `relatedTarget` is
   * what makes that distinguishable from focus moving to the chevron inside it.
   */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) return;
    this.open.set(false);
    this.highlighted.set(-1);
  }
}

let nextId = 0;
