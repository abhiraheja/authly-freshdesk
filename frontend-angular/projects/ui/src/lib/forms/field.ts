import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Label + control + one line of help underneath.
 *
 * Every form in the app was hand-writing this trio, which is why the spacing
 * and the help-text size had already drifted between screens. Wrapping it means
 * changing the arrangement once.
 *
 * `for` must match the control's id, or the label is decoration: clicking it
 * won't focus the field and a screen reader will announce the input unnamed.
 *
 * ```html
 * <tk-field [label]="'Container' | transloco" for="container" [error]="containerError()">
 *   <input tkInput id="container" [(ngModel)]="container" />
 * </tk-field>
 * ```
 */
@Component({
  selector: 'tk-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="label" [attr.for]="for()">
      {{ label() }}
      @if (required()) {
        <span class="field-required" [attr.aria-label]="requiredLabel()">*</span>
      }
    </label>

    <ng-content />

    <!-- Error REPLACES the hint rather than stacking under it. Two lines of
         small print below a field is where people stop reading, and the error
         is the one that has to land. -->
    @if (error()) {
      <p class="field-error" role="alert">{{ error() }}</p>
    } @else if (hint()) {
      <p class="field-hint">{{ hint() }}</p>
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  /** The id of the control inside. */
  readonly for = input<string>();
  readonly hint = input<string>();
  /** Non-empty puts the field in its error state and hides the hint. */
  readonly error = input<string>();
  readonly required = input(false, { transform: booleanAttribute });
  /** Accessible name for the asterisk — pass the translated "required". */
  readonly requiredLabel = input('required');
}
