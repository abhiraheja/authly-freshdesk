import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * Click-to-open menu anchored to a trigger.
 *
 * ```html
 * <tk-dropdown align="end">
 *   <button tkButton variant="outline" dropdown-trigger>Options</button>
 *   <div dropdown-menu>
 *     <button class="menu-item">Edit</button>
 *     <div class="menu-sep"></div>
 *     <button class="menu-item text-danger">Delete</button>
 *   </div>
 * </tk-dropdown>
 * ```
 *
 * Closes on any click inside the menu (so items never need their own close
 * call), on outside click, and on Esc. The outside-click catcher is a real
 * focusable-free button rather than a document listener, so it also blocks
 * interaction with the page behind — the same trick the menu backdrop uses.
 */
@Component({
  selector: 'tk-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  host: { class: 'relative inline-flex' },
  template: `
    <div (click)="toggle()" (keydown.escape)="close()">
      <ng-content select="[dropdown-trigger]" />
    </div>

    @if (open()) {
      <button
        type="button"
        class="fixed inset-0 z-40 cursor-default"
        [attr.aria-label]="'common.closeMenu' | transloco"
        (click)="close()"
      ></button>
      <div
        [class]="menuClasses()"
        role="menu"
        (click)="close()"
        (keydown.escape)="close()"
      >
        <ng-content select="[dropdown-menu]" />
      </div>
    }
  `,
})
export class Dropdown {
  /** Which edge the menu aligns to. `end` right-aligns — use it in the top bar. */
  readonly align = input<'start' | 'end'>('start');

  protected readonly open = signal(false);

  protected readonly menuClasses = computed(() =>
    [
      'menu absolute top-full z-50 mt-1.5 animate-float-in',
      this.align() === 'end' ? 'right-0' : 'left-0',
    ].join(' '),
  );

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }
}
