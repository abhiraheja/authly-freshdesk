import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Applies the design-system `.btn` classes to a real `<button>` or `<a>`.
 *
 * An attribute selector rather than a wrapper element, so native semantics
 * survive: `type`, `disabled`, `href`, focus order and click behaviour all keep
 * working, and a form's submit button is still a submit button.
 *
 * ```html
 * <button tkButton variant="primary" (click)="save()">Save</button>
 * <a tkButton variant="outline" routerLink="/dashboard">Back</a>
 * <button tkButton variant="ghost" iconOnly aria-label="Refresh">
 *   <tk-icon name="refresh-cw" [size]="20" />
 * </button>
 * ```
 */
@Component({
  selector: 'button[tkButton], a[tkButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'classes()' },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  /** Square, no label — the caller MUST supply an `aria-label`. */
  readonly iconOnly = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() =>
    [
      'btn',
      `btn-${this.variant()}`,
      this.size() === 'sm' ? 'btn-sm' : this.size() === 'lg' ? 'btn-lg' : '',
      this.iconOnly() ? 'btn-icon' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
