import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, model } from '@angular/core';

/**
 * Owns the value for a set of {@link Radio}s.
 *
 * The group holds the value, not the individual radios, because that is what
 * "pick exactly one" means — a radio has no state of its own, only a question
 * of whether it matches.
 *
 * ```html
 * <tk-radio-group [(value)]="provider" [ariaLabel]="'Storage provider' | transloco">
 *   <tk-radio value="local" label="Local disk" hint="Files stay on the server" />
 *   <tk-radio value="azure" label="Azure Blob Storage" />
 *   <tk-radio value="gcs" label="Google Cloud Storage" />
 * </tk-radio-group>
 * ```
 */
@Component({
  selector: 'tk-radio-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radiogroup',
    class: 'block space-y-2',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: '<ng-content />',
})
export class RadioGroup {
  readonly value = model('');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string>();

  /**
   * Shared `name`, which is what makes the browser treat these as one set:
   * arrow keys move between them and only one can be checked. Auto-generated so
   * two groups on a page never collide.
   */
  readonly name = input(`tk-radio-${nextId++}`);

  select(value: string): void {
    this.value.set(value);
  }
}

/**
 * One option inside a {@link RadioGroup}. Injecting the group is what makes the
 * grouping structural — a radio outside one is a compile-time error rather than
 * a control that silently never selects anything.
 */
@Component({
  selector: 'tk-radio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="control control-boxed" [class.is-selected]="checked()" [class.control-disabled]="isDisabled()">
      <input
        type="radio"
        class="control-input"
        [name]="group.name()"
        [value]="value()"
        [checked]="checked()"
        [disabled]="isDisabled()"
        (change)="group.select(value())"
      />
      <span class="radio-dot" aria-hidden="true"></span>
      <span class="control-label">
        {{ label() }}
        @if (hint()) {
          <span class="control-hint">{{ hint() }}</span>
        }
      </span>
    </label>
  `,
})
export class Radio {
  protected readonly group = inject(RadioGroup);

  readonly value = input.required<string>();
  readonly label = input.required<string>();
  /** Second line under the label — what choosing this actually means. */
  readonly hint = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly checked = computed(() => this.group.value() === this.value());
  /** Disabling the group disables every option in it. */
  protected readonly isDisabled = computed(() => this.disabled() || this.group.disabled());
}

let nextId = 0;
