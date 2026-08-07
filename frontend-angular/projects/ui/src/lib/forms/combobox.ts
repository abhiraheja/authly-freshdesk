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

    <!-- Moved to <body> while it is open, and positioned against the viewport.
         See portal() below for why nothing simpler works. -->
    @if (open() && visible().length) {
      <ul
        #list
        class="menu combobox-menu"
        role="listbox"
        [id]="listId"
        [style.left.px]="anchor().left"
        [style.top.px]="anchor().top"
        [style.width.px]="anchor().width"
        [style.max-height.px]="anchor().maxHeight"
      >
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
   * Viewport coordinates for the suggestion list.
   *
   * Recomputed whenever it opens and on any scroll or resize — a fixed element
   * does not move with its anchor, so without this the list would stay behind
   * when the page underneath it scrolled.
   */
  protected readonly anchor = signal({ left: 0, top: 0, width: 0, maxHeight: 240 });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    const reposition = () => {
      if (this.open()) this.measure();
    };
    // Capture phase: the scroll that matters is usually an ancestor's (a modal
    // body, the page shell), and scroll events do not bubble.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // Re-parent the list to <body> the moment it exists.
    //
    // `position: fixed` is not enough on its own. A transformed ancestor becomes
    // the containing block for fixed descendants, and Trackly's modal animates
    // in with a transform — so inside a dialog the list was positioned against
    // the modal instead of the viewport and then clipped away entirely by the
    // modal's own `overflow: hidden`. Nothing about the CSS can fix that from
    // inside; the element has to leave.
    //
    // Angular still owns the node: it created it, its bindings keep updating,
    // and it removes it by asking for the node's *current* parent, so the move
    // does not strand anything.
    effect(() => {
      const element = this.list()?.nativeElement;
      if (element && element.parentElement !== document.body) {
        document.body.appendChild(element);
        // Measure again now that it is laid out somewhere with a real width —
        // `.menu` has a min-width the field may be narrower than.
        this.measure();
      }
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      // Angular cannot clean up a node it can no longer reach from the view if
      // the component is torn down while the list is open.
      this.list()?.nativeElement.remove();
    });
  }

  /**
   * Measures the field and decides whether the list hangs below it or above.
   *
   * Flipping matters: this control sits near the bottom of a modal often enough
   * that a list pinned below would open off-screen with no way to reach it.
   */
  private measure(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap;
    const above = rect.top - gap;
    const preferBelow = below >= 160 || below >= above;
    const maxHeight = Math.min(240, Math.max(120, preferBelow ? below : above));

    this.anchor.set({
      left: rect.left,
      top: preferBelow ? rect.bottom + gap : rect.top - gap - maxHeight,
      width: rect.width,
      maxHeight,
    });
  }

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

  /** Opens the list, measuring first so it paints where it belongs. */
  protected openList(): void {
    this.measure();
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
