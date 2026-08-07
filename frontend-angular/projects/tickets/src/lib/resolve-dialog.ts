import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Alert, Button, Field, InputDirective, LabelDirective, Modal, Spinner } from '@trackly/ui';

export interface ResolvePayload {
  status: 'resolved' | 'closed';
  note: string;
  link?: string;
  minutes?: number;
}

/**
 * Asks why, before a ticket leaves the queue.
 *
 * Two jobs in one dialog. The obvious one is the confirmation — Resolve is a
 * big coloured button sitting next to controls an agent uses all day, and a
 * per-row icon in the list is worse. The one that pays off later is the
 * **record**: six months on, "why was this closed?" should have an answer
 * without reading a thread, and the person who fixed it is the only one who can
 * write it while they still remember.
 *
 * The note is required here **and** at the API. This dialog is the convenience;
 * `TicketService.UpdateAsync` is the rule.
 *
 * Time is asked for in the same breath because that is when it is known, and it
 * is sent in the same request — two calls could leave a ticket resolved with the
 * agent's time dropped in between.
 */
@Component({
  selector: 'tk-resolve-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, Alert, Button, Field, InputDirective, LabelDirective, Modal, Spinner],
  template: `
    <tk-modal [(open)]="open" [heading]="heading()" [persistent]="saving()">
      @if (subject(); as name) {
        <p class="mb-4 text-body text-muted-foreground">
          {{ 'tickets.resolveDialog.about' | transloco: { subject: name } }}
        </p>
      }

      <div class="space-y-4">
        <tk-field
          [label]="'tickets.resolveDialog.note' | transloco"
          for="resolution-note"
          required
          [requiredLabel]="'tickets.resolveDialog.required' | transloco"
          [hint]="'tickets.resolveDialog.noteHint' | transloco"
        >
          <textarea
            tkInput
            inset
            id="resolution-note"
            name="resolutionNote"
            rows="4"
            [placeholder]="'tickets.resolveDialog.notePlaceholder' | transloco"
            [(ngModel)]="note"
          ></textarea>
        </tk-field>

        <tk-field
          [label]="'tickets.resolveDialog.link' | transloco"
          for="resolution-link"
          [hint]="'tickets.resolveDialog.linkHint' | transloco"
          [error]="linkError()"
        >
          <input
            tkInput
            inset
            id="resolution-link"
            name="resolutionLink"
            type="url"
            placeholder="https://…"
            [(ngModel)]="link"
          />
        </tk-field>

        <div>
          <label tkLabel for="resolution-hours">{{ 'tickets.resolveDialog.time' | transloco }}</label>
          <!-- Hours and minutes as two fields rather than one free-text box:
               "1.5", "1h30", "90" all mean the same thing to a person and three
               different things to a parser. -->
          <div class="flex items-center gap-2">
            <input
              tkInput
              inset
              id="resolution-hours"
              name="hours"
              type="number"
              min="0"
              max="24"
              class="w-20"
              [(ngModel)]="hours"
            />
            <span class="text-body text-muted-foreground">{{ 'tickets.resolveDialog.hours' | transloco }}</span>
            <input
              tkInput
              inset
              id="resolution-minutes"
              name="minutes"
              type="number"
              min="0"
              max="59"
              class="w-20"
              [(ngModel)]="minutes"
            />
            <span class="text-body text-muted-foreground">{{ 'tickets.resolveDialog.minutes' | transloco }}</span>
          </div>
          <p class="field-hint">{{ 'tickets.resolveDialog.timeHint' | transloco }}</p>
        </div>
      </div>

      @if (error(); as message) {
        <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
      }

      <div modal-footer>
        <button tkButton variant="ghost" [disabled]="saving()" (click)="open.set(false)">
          {{ 'common.cancel' | transloco }}
        </button>
        <button tkButton [variant]="tone()" [disabled]="!canSubmit()" (click)="submit()">
          @if (saving()) {
            <tk-spinner [size]="16" />
          }
          {{ confirmLabel() }}
        </button>
      </div>
    </tk-modal>
  `,
})
export class ResolveDialog {
  private readonly transloco = inject(TranslocoService);

  readonly open = model(false);
  readonly status = input<'resolved' | 'closed'>('resolved');
  /** Named in the body when the caller is a list, where the row is ambiguous. */
  readonly subject = input<string>();
  readonly saving = input(false);
  /** Server-side failure. Cleared by the caller when it retries. */
  readonly error = input<string | null>(null);

  readonly confirmed = output<ResolvePayload>();

  protected readonly note = signal('');
  protected readonly link = signal('');
  protected readonly hours = signal<number | null>(null);
  protected readonly minutes = signal<number | null>(null);

  protected readonly tone = computed(() => (this.status() === 'resolved' ? 'success' : 'primary'));

  protected readonly heading = computed(() =>
    this.transloco.translate(
      this.status() === 'resolved' ? 'tickets.resolveDialog.headingResolve' : 'tickets.resolveDialog.headingClose',
    ),
  );

  protected readonly confirmLabel = computed(() =>
    this.transloco.translate(
      this.status() === 'resolved' ? 'tickets.resolveDialog.confirmResolve' : 'tickets.resolveDialog.confirmClose',
    ),
  );

  /**
   * Checked here as well as at the API so a bad link is caught before the round
   * trip — and because the server's answer for this one is a generic 400.
   */
  protected readonly linkError = computed(() => {
    const value = this.link().trim();
    if (!value) return undefined;
    return /^https?:\/\/\S+$/i.test(value)
      ? undefined
      : this.transloco.translate('tickets.resolveDialog.linkInvalid');
  });

  protected readonly canSubmit = computed(
    () => !this.saving() && this.note().trim().length > 0 && !this.linkError(),
  );

  constructor() {
    // Reset on open, not on close: closing while a save is in flight would wipe
    // what the agent typed before the failure could put it back in front of them.
    effect(() => {
      if (!this.open()) return;
      this.note.set('');
      this.link.set('');
      this.hours.set(null);
      this.minutes.set(null);
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const total = (this.hours() ?? 0) * 60 + (this.minutes() ?? 0);
    this.confirmed.emit({
      status: this.status(),
      note: this.note().trim(),
      link: this.link().trim() || undefined,
      // Undefined rather than 0 — the API treats 0 as "no entry", and sending it
      // would be asking for a row that says nobody spent any time.
      minutes: total > 0 ? total : undefined,
    });
  }
}
