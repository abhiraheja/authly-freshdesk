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
  imports: [Icon, FloatingMenu],
  host: {
    class: 'relative block',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <input
      class="input pr-9"
      [class.input-inset]="inset()"
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
      (focus)="openList()"
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

    <!-- tkFloating moves this to <body> while it is open — see FloatingMenu for
         the ancestors that would otherwise clip it. -->
    @if (open() && visible().length) {
      <ul #list class="menu" role="listbox" [id]="listId" [tkFloating]="host.nativeElement" matchWidth>
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
  /** Read from the template — the floating list anchors to it. */
  protected readonly host = inject(ElementRef<HTMLElement>);

  readonly value = model('');
  readonly suggestions = input<readonly string[]>([]);
  readonly placeholder = input('');
  readonly inputId = input<string>();
  readonly disabled = input(false);
  /** Muted fill, no idle border — matches `tkInput inset`.
   *  booleanAttribute so the bare `inset` attribute works; without it the
   *  empty string a bare attribute passes is a type error, not `true`. */
  readonly inset = input(false, { transform: booleanAttribute });
  /** Accessible name for the open/close chevron. */
  readonly toggleLabel = input('Show suggestions');

  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  protected readonly listId = `tk-combobox-${nextId++}`;

  /**
   * Read from the template: the floating list anchors to it, and focus-out has
   * to test the list separately once it has moved to `<body>`.
   */
  protected readonly list = viewChild<ElementRef<HTMLElement>>('list');

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

  protected openList(): void {
    this.open.set(true);
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
    this.openList();
    this.highlighted.set(-1);
  }

  protected choose(option: string): void {
    this.value.set(option);
    this.open.set(false);
    this.highlighted.set(-1);
  }

  protected toggle(): void {
    if (this.open()) this.open.set(false);
    else this.openList();
    this.highlighted.set(-1);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const options = this.visible();

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!options.length) return;
        this.openList();
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
    // The list lives on <body> now, so it is no longer "inside" the host and
    // has to be checked separately — otherwise dragging its scrollbar closes
    // the very list you are scrolling.
    if (next && this.list()?.nativeElement.contains(next)) return;
    this.open.set(false);
    this.highlighted.set(-1);
  }
}

let nextId = 0;
