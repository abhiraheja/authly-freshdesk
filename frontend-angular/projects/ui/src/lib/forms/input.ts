import { Directive, booleanAttribute, computed, input } from '@angular/core';

/**
 * Styles a native form control. Works unchanged with `ngModel`, reactive forms
 * or a plain `(input)` handler — it only contributes classes.
 *
 * ```html
 * <label tkLabel for="email">Work email</label>
 * <input tkInput id="email" type="email" [(ngModel)]="email" />
 * ```
 */
@Directive({
  selector: 'input[tkInput], textarea[tkInput], select[tkInput]',
  host: { '[class]': 'classes()' },
})
export class InputDirective {
  readonly inputSize = input<'sm' | 'md'>('md');
  /** Muted fill with no border — search bars, composers, filter rows. */
  readonly inset = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() =>
    ['input', this.inputSize() === 'sm' ? 'input-sm' : '', this.inset() ? 'input-inset' : '']
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Field label. Every input needs one — a placeholder is not a label, it fails
 * screen readers and vanishes the moment someone types.
 */
@Directive({
  selector: 'label[tkLabel]',
  host: { class: 'label' },
})
export class LabelDirective {}
