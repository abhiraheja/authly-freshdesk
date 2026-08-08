import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, fieldHasOptions, type TicketFieldAnswer } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Combobox,
  InputDirective,
  LabelDirective,
  Radio,
  RadioGroup,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * The workspace's own ticket properties.
 *
 * Trackly's built-in fields are elsewhere in the rail because the product
 * reasons about them. These are whatever this workspace decided to track, so
 * everything here is rendered from data — the label, the control, the choices.
 *
 * **A select is a combobox when the field allows new values.** That is the
 * setting that makes these usable on day one: without it, filling in a ticket
 * means stopping to ask an admin to add "Mumbai" to a list of offices, and the
 * field gets left blank instead.
 *
 * **Saved as a block, not per keystroke.** A text field firing a request per
 * character would be a write per letter on a ticket several people have open.
 */
@Component({
  selector: 'tk-ticket-custom-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Checkbox,
    Combobox,
    InputDirective,
    LabelDirective,
    Radio,
    RadioGroup,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    @if (fields.value(); as list) {
      @if (list.length) {
        <div class="space-y-4">
          @for (field of list; track field.id) {
            <div>
              <label tkLabel [attr.for]="'cf-' + field.id">
                {{ field.label }}
                @if (field.isRequired) {
                  <span class="text-danger" aria-hidden="true">*</span>
                }
                @if (!field.isActive) {
                  <tk-badge tone="neutral" class="ml-1">{{ 'tickets.fields.retired' | transloco }}</tk-badge>
                }
              </label>

              @switch (field.type) {
                @case ('checkbox') {
                  <tk-checkbox
                    [inputId]="'cf-' + field.id"
                    [checked]="draft()[field.id] === 'true'"
                    [disabled]="saving()"
                    (checkedChange)="set(field.id, $event ? 'true' : 'false')"
                  >
                    {{ field.helpText ?? '' }}
                  </tk-checkbox>
                }

                @case ('radio') {
                  <tk-radio-group
                    [name]="'cf-' + field.id"
                    [ariaLabel]="field.label"
                    [disabled]="saving()"
                    [value]="draft()[field.id] ?? ''"
                    (valueChange)="set(field.id, $event)"
                  >
                    @for (option of field.options; track option) {
                      <tk-radio [value]="option" [label]="option" />
                    }
                  </tk-radio-group>
                }

                @case ('select') {
                  <!-- A combobox when the field may learn a new value, a plain
                       select when the list is closed. Same data, two different
                       promises about what an agent is allowed to type. -->
                  @if (field.allowNewOptions) {
                    <tk-combobox
                      inset
                      [inputId]="'cf-' + field.id"
                      [suggestions]="field.options"
                      [disabled]="saving()"
                      [value]="draft()[field.id] ?? ''"
                      (valueChange)="set(field.id, $event)"
                    />
                  } @else {
                    <tk-select
                      inset
                      size="sm"
                      [inputId]="'cf-' + field.id"
                      [disabled]="saving()"
                      [value]="draft()[field.id] ?? ''"
                      (valueChange)="set(field.id, $event)"
                    >
                      <tk-option value="" [label]="'common.none' | transloco" />
                      @for (option of field.options; track option) {
                        <tk-option [value]="option" [label]="option" />
                      }
                    </tk-select>
                  }
                }

                @default {
                  <input
                    tkInput
                    inset
                    inputSize="sm"
                    class="w-full"
                    [id]="'cf-' + field.id"
                    [disabled]="saving()"
                    [ngModel]="draft()[field.id] ?? ''"
                    (ngModelChange)="set(field.id, $event)"
                  />
                }
              }

              @if (field.helpText && field.type !== 'checkbox') {
                <p class="mt-1 text-meta text-muted-foreground">{{ field.helpText }}</p>
              }
            </div>
          }

          <div class="flex items-center gap-2">
            <button tkButton size="sm" [disabled]="saving() || !dirty()" (click)="save()">
              {{ 'common.save' | transloco }}
            </button>
            @if (saving()) {
              <tk-spinner [size]="14" />
            } @else if (dirty()) {
              <span class="text-meta text-muted-foreground">{{ 'tickets.fields.unsaved' | transloco }}</span>
            }
          </div>
        </div>
      } @else {
        <p class="text-body text-muted-foreground">{{ 'tickets.fields.none' | transloco }}</p>
      }
    } @else if (fields.error()) {
      <tk-alert tone="danger">{{ loadError() }}</tk-alert>
    } @else {
      <span tkSkeleton class="block h-24 w-full"></span>
    }
  `,
})
export class TicketCustomFields {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();

  protected readonly saving = signal(false);

  protected readonly fields = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketFieldAnswers(params.id),
  });

  /** What is on screen, keyed by field id. */
  protected readonly draft = signal<Record<string, string>>({});
  /** What the server last sent, to tell an edit from a reload. */
  private readonly baseline = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const list = this.fields.value();
      if (!list) return;
      // untracked: this seeds from the server, so it must run when the server
      // answers and at no other time — tracking `draft` would reset every
      // keystroke back to the stored value.
      untracked(() => {
        const seeded = Object.fromEntries(list.map((f) => [f.id, f.value ?? defaultFor(f)]));
        this.draft.set(seeded);
        this.baseline.set({ ...seeded });
      });
    });
  }

  protected readonly loadError = computed(() => errorMessage(this.fields.error()));

  protected readonly dirty = computed(() => {
    const now = this.draft();
    const was = this.baseline();
    return Object.keys({ ...now, ...was }).some((key) => (now[key] ?? '') !== (was[key] ?? ''));
  });

  protected set(id: string, value: string): void {
    this.draft.update((draft) => ({ ...draft, [id]: value }));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      // Only what moved. Sending the whole set would re-stamp every answer's
      // updated_at and write an activity entry for fields nobody touched.
      const was = this.baseline();
      const changed: Record<string, string | null> = {};
      for (const [id, value] of Object.entries(this.draft())) {
        if ((was[id] ?? '') !== value) changed[id] = value === '' ? null : value;
      }
      await this.api.saveTicketFieldAnswers(this.ticketId(), changed);
      this.toast.success(this.transloco.translate('tickets.fields.saved'));
      this.fields.reload();
    } catch (error) {
      // Left as typed: a required-field message is only actionable if what they
      // wrote is still on screen.
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}

/**
 * What an unanswered field shows.
 *
 * A checkbox is the odd one: unticked is a real answer rather than an absence,
 * so an empty string would render as neither state and save as "no answer".
 */
function defaultFor(field: TicketFieldAnswer): string {
  return field.type === 'checkbox' ? 'false' : '';
}

/** Re-exported so callers do not reach into @trackly/core for one predicate. */
export { fieldHasOptions };
