import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * A checkbox.
 *
 * **Built around a real `<input type="checkbox">`, not a div.** The native
 * control is kept in the DOM (clipped, not `display: none`) and the visible box
 * is drawn beside it. That is what keeps focus, the space key, form
 * participation, and every screen reader's checkbox semantics working without
 * a line of code re-implementing them.
 *
 * ```html
 * <tk-checkbox [(checked)]="notifyOnReply">Email me when a customer replies</tk-checkbox>
 * ```
 */
@Component({
  selector: 'tk-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <label class="control" [class.control-disabled]="disabled()">
      <input
        type="checkbox"
        class="control-input"
        [id]="inputId()"
        [attr.name]="inputId()"
        [attr.aria-label]="ariaLabel()"
        [checked]="checked()"
        [indeterminate]="indeterminate()"
        [disabled]="disabled()"
        (change)="toggle($event)"
      />
      <span class="checkbox-box" aria-hidden="true">
        <tk-icon [name]="indeterminate() ? 'minus' : 'check'" [size]="12" [strokeWidth]="3" />
      </span>
      <span class="control-label"><ng-content /></span>
    </label>
  `,
})
export class Checkbox {
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly inputId = input<string>();
  /** Only for a checkbox with no visible text beside it — a row selector. */
  readonly ariaLabel = input<string>();

  /**
   * "Some, but not all" — a header checkbox over a partly-selected list. Purely
   * a display state: clicking still reports plain checked/unchecked, which is
   * the browser's own behaviour.
   */
  readonly indeterminate = input(false, { transform: booleanAttribute });

  protected toggle(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}

/**
 * A switch — the same data as a checkbox, a different promise.
 *
 * Use it for a setting that takes effect the moment it is flipped. Use
 * {@link Checkbox} when the value is submitted later with the rest of a form.
 * Mixing them up is the usual reason a settings page feels unpredictable.
 */
@Component({
  selector: 'tk-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="control" [class.control-disabled]="disabled()">
      <input
        type="checkbox"
        role="switch"
        class="control-input"
        [id]="inputId()"
        [attr.name]="inputId()"
        [attr.aria-label]="ariaLabel()"
        [checked]="checked()"
        [disabled]="disabled()"
        (change)="toggle($event)"
      />
      <span class="switch-track" aria-hidden="true">
        <span class="switch-thumb"></span>
      </span>
      <span class="control-label"><ng-content /></span>
    </label>
  `,
})
export class Switch {
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly inputId = input<string>();
  readonly ariaLabel = input<string>();

  protected toggle(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
