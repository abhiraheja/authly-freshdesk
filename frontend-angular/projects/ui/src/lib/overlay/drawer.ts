import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/**
 * Right-hand slide-over. Same contract as `tk-modal`, different geometry.
 *
 * Prefer a drawer over a modal when the user needs the page behind it for
 * context — editing a row while its list stays visible. Prefer a modal when the
 * decision is self-contained.
 */
@Component({
  selector: 'tk-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon],
  template: `
    @if (open()) {
      <div class="overlay" (click)="dismiss()" aria-hidden="true"></div>
      <div
        #panel
        class="drawer"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="heading()"
        tabindex="-1"
        (keydown.escape)="dismiss()"
      >
        <div class="card-header">
          <h2 class="card-title font-display">{{ heading() }}</h2>
          <button tkButton variant="ghost" iconOnly aria-label="Close" (click)="dismiss()">
            <tk-icon name="x" [size]="18" />
          </button>
        </div>
        <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
          <ng-content />
        </div>
        <div class="card-footer flex justify-end gap-2">
          <ng-content select="[drawer-footer]" />
        </div>
      </div>
    }
  `,
})
export class Drawer {
  readonly open = model(false);
  readonly heading = input('');
  readonly persistent = input(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      if (this.open()) this.panel()?.nativeElement.focus();
    });
  }

  protected dismiss(): void {
    if (!this.persistent()) this.open.set(false);
  }
}
