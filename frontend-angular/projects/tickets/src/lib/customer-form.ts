import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import type { CustomerBody } from '@trackly/core';
import { Button, Icon, InputDirective, LabelDirective } from '@trackly/ui';

/** One row of the custom-fields editor. Kept as a list, not an object, so a
 *  half-typed key doesn't collide with another half-typed key while editing. */
interface FieldRow {
  key: string;
  value: string;
}

/**
 * The customer's details, used for both "create" and "edit".
 *
 * **Custom fields are free key/value.** A workspace tracks whatever its business
 * runs on — account number, plan, warehouse — and a fixed set of columns would
 * mean a code change every time one of them needed another. Configuration can
 * suggest keys so the same field is spelled the same way twice; it never
 * restricts what an agent can write down mid-call.
 *
 * Emits a body; the caller decides whether that is a POST or a PUT.
 */
@Component({
  selector: 'tk-customer-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, Button, Icon, InputDirective, LabelDirective],
  template: `
    <div class="space-y-4">
      <div>
        <label tkLabel for="cf-email">{{ 'customers.email' | transloco }}</label>
        <input
          tkInput
          inset
          id="cf-email"
          type="email"
          [readonly]="emailLocked()"
          [class.opacity-60]="emailLocked()"
          [(ngModel)]="email"
        />
        @if (emailLocked()) {
          <!-- The email identifies the customer, so changing it here would
               quietly mean "a different person" rather than "a correction". -->
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'customers.emailLocked' | transloco }}</p>
        }
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label tkLabel for="cf-name">{{ 'customers.name' | transloco }}</label>
          <input tkInput inset id="cf-name" [(ngModel)]="name" />
        </div>
        <div>
          <label tkLabel for="cf-phone">{{ 'customers.phone' | transloco }}</label>
          <input tkInput inset id="cf-phone" type="tel" [(ngModel)]="phone" />
        </div>
        <div>
          <label tkLabel for="cf-company">{{ 'customers.company' | transloco }}</label>
          <input tkInput inset id="cf-company" [(ngModel)]="company" />
        </div>
        <div>
          <label tkLabel for="cf-location">{{ 'customers.location' | transloco }}</label>
          <input tkInput inset id="cf-location" [(ngModel)]="location" />
        </div>
      </div>

      <div>
        <span class="mb-1.5 block text-meta font-semibold">{{ 'customers.customFields' | transloco }}</span>
        <p class="mb-2 text-meta text-muted-foreground">{{ 'customers.customFieldsHelp' | transloco }}</p>

        <div class="space-y-2">
          @for (row of rows(); track $index) {
            <div class="flex items-center gap-2">
              <input
                tkInput
                inset
                inputSize="sm"
                class="flex-1"
                list="tk-customer-field-keys"
                [attr.aria-label]="'customers.fieldKey' | transloco"
                [placeholder]="'customers.fieldKey' | transloco"
                [ngModel]="row.key"
                (ngModelChange)="setKey($index, $event)"
              />
              <input
                tkInput
                inset
                inputSize="sm"
                class="flex-1"
                [attr.aria-label]="'customers.fieldValue' | transloco"
                [placeholder]="'customers.fieldValue' | transloco"
                [ngModel]="row.value"
                (ngModelChange)="setValue($index, $event)"
              />
              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-danger"
                [attr.aria-label]="'customers.removeField' | transloco"
                (click)="removeRow($index)"
              >
                <tk-icon name="x" [size]="15" />
              </button>
            </div>
          }
        </div>

        <!-- A datalist rather than a select: the configured keys are offered,
             but anything can still be typed. -->
        <datalist id="tk-customer-field-keys">
          @for (key of suggestedKeys(); track key) {
            <option [value]="key"></option>
          }
        </datalist>

        <button tkButton variant="ghost" size="sm" class="mt-2" (click)="addRow()">
          <tk-icon name="plus" [size]="14" />
          {{ 'customers.addField' | transloco }}
        </button>
      </div>
    </div>
  `,
})
export class CustomerForm {
  readonly email = model('');
  readonly name = model('');
  readonly phone = model('');
  readonly company = model('');
  readonly location = model('');

  /** Editing an existing customer: the email is their identity, not a field. */
  readonly emailLocked = input(false, { transform: booleanAttribute });
  readonly suggestedKeys = input<readonly string[]>([]);

  protected readonly rows = signal<FieldRow[]>([]);

  /** Seeds the editor from an existing customer. Called by the host, not bound. */
  setFields(fields: Record<string, string> | undefined): void {
    this.rows.set(Object.entries(fields ?? {}).map(([key, value]) => ({ key, value })));
  }

  protected addRow(): void {
    this.rows.update((rows) => [...rows, { key: '', value: '' }]);
  }

  protected removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected setKey(index: number, key: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, key } : row)));
  }

  protected setValue(index: number, value: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, value } : row)));
  }

  /**
   * The body to send. Blank rows are dropped rather than saved as empty
   * strings — an agent who added a row and changed their mind should not leave
   * a nameless field on the customer forever.
   *
   * A repeated key keeps its LAST value, which is what the agent sees last.
   */
  readonly body = computed<CustomerBody>(() => {
    const customFields: Record<string, string> = {};
    for (const { key, value } of this.rows()) {
      const trimmed = key.trim();
      if (trimmed && value.trim()) customFields[trimmed] = value.trim();
    }
    return {
      email: this.email().trim() || undefined,
      name: this.name().trim() || undefined,
      phone: this.phone().trim() || undefined,
      company: this.company().trim() || undefined,
      location: this.location().trim() || undefined,
      customFields,
    };
  });
}
