import { TranslocoPipe } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/**
 * Centred dialog. Two-way `[(open)]`, Esc and backdrop close it.
 *
 * The header is fixed and the BODY scrolls (see `.modal` in styles.scss), so a
 * tall form can never push its own actions off-screen.
 *
 * ```html
 * <tk-modal [(open)]="confirmOpen" heading="Delete 12 tickets?">
 *   <p>This cannot be undone.</p>
 *   <div modal-footer>
 *     <button tkButton variant="ghost" (click)="confirmOpen.set(false)">Cancel</button>
 *     <button tkButton variant="danger" (click)="remove()">Delete</button>
 *   </div>
 * </tk-modal>
 * ```
 */
@Component({
  selector: 'tk-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, TranslocoPipe],
  template: `
    @if (open()) {
      <div class="overlay" (click)="dismiss()" aria-hidden="true"></div>
      <div
        #panel
        [class]="panelClasses()"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="heading()"
        tabindex="-1"
        (keydown.escape)="dismiss()"
      >
        <div class="card-header">
          <h2 class="card-title font-display">{{ heading() }}</h2>
          <button tkButton variant="ghost" iconOnly [attr.aria-label]="'common.close' | transloco" (click)="dismiss()">
            <tk-icon name="x" [size]="18" />
          </button>
        </div>
        <div class="card-body">
          <ng-content />
        </div>
        <div class="card-footer flex justify-end gap-2">
          <ng-content select="[modal-footer]" />
        </div>
      </div>
    }
  `,
})
export class Modal {
  readonly open = model(false);
  readonly heading = input('');
  readonly size = input<'md' | 'wide' | 'xl'>('md');
  /**
   * Blocks Esc and backdrop dismissal. Use only where losing input would be
   * destructive — an in-flight save, a half-finished wizard step.
   */
  readonly persistent = input(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly panelClasses = computed(() =>
    ['modal animate-float-in', this.size() === 'wide' ? 'modal-wide' : this.size() === 'xl' ? 'modal-xl' : '']
      .filter(Boolean)
      .join(' '),
  );

  constructor() {
    // Move focus into the dialog when it opens, so Esc works and a keyboard user
    // isn't left tabbing the page behind the backdrop.
    effect(() => {
      if (this.open()) this.panel()?.nativeElement.focus();
    });
  }

  protected dismiss(): void {
    if (!this.persistent()) this.open.set(false);
  }
}
