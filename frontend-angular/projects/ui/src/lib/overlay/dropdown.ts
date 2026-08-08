import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { FloatingMenu } from './floating-menu';

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
  imports: [TranslocoPipe, FloatingMenu],
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
      <!-- tkFloating moves this to <body> while it is open. Without it the menu
           was clipped by any scrolling ancestor — a row-actions menu inside a
           table's overflow wrapper being the case that bites. -->
      <div
        class="menu animate-float-in"
        role="menu"
        [tkFloating]="host.nativeElement"
        [align]="align()"
        (click)="close()"
        (keydown.escape)="close()"
      >
        <ng-content select="[dropdown-menu]" />
      </div>
    }
  `,
})
export class Dropdown {
  /** Read from the template — the floating menu anchors to it. */
  protected readonly host = inject(ElementRef<HTMLElement>);

  /** Which edge the menu aligns to. `end` right-aligns — use it in the top bar. */
  readonly align = input<'start' | 'end'>('start');

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }
}
