import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { STATUS_TONE, hasWarnings, toneFor, type ResolvePreview } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Icon,
  InputDirective,
  LabelDirective,
  Modal,
  Spinner,
} from '@trackly/ui';

export interface ResolvePayload {
  status: 'resolved' | 'closed';
  note: string;
  link?: string;
  minutes?: number;
  /** What the customer is told. Optional — see the field's hint for why. */
  summary?: string;
  /**
   * Linked duplicates the agent chose to resolve too. Empty means only this one.
   *
   * Every id here is a customer who will receive a resolution email, which is why
   * these are ticked boxes and not a switch somebody sets once and forgets.
   */
  alsoResolve: string[];
  /**
   * The agent saw the open tasks / silent responders / open blockers and went
   * ahead. False when there was nothing to acknowledge.
   */
  acknowledgeWarnings: boolean;
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
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Checkbox,
    Field,
    Icon,
    InputDirective,
    LabelDirective,
    Modal,
    Spinner,
  ],
  template: `
    <tk-modal [(open)]="open" [heading]="heading()" [persistent]="saving()">
      <!-- Bulk mode says so plainly, and says what the note will do. One note
           recorded on twenty tickets is a real limitation of resolving them
           together; an agent who is not told will write a note that only makes
           sense on the ticket they happened to be looking at. -->
      @if (appliesTo() > 1) {
        <tk-alert tone="warning" class="mb-4">
          {{ 'tickets.resolveDialog.bulkWarning' | transloco: { count: appliesTo() } }}
        </tk-alert>
      } @else if (subject(); as name) {
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

        <!-- The customer's half. OPTIONAL on purpose: demanding two paragraphs
             to close a ticket is how you end up with "." in both, and the
             internal note is the one that has to exist. -->
        <tk-field
          [label]="'tickets.resolveDialog.summary' | transloco"
          for="resolution-summary"
          [hint]="'tickets.resolveDialog.summaryHint' | transloco"
        >
          <textarea
            tkInput
            inset
            id="resolution-summary"
            name="resolutionSummary"
            rows="3"
            [placeholder]="'tickets.resolveDialog.summaryPlaceholder' | transloco"
            [(ngModel)]="summary"
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
              class="input-duration"
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
              class="input-duration"
              [(ngModel)]="minutes"
            />
            <span class="text-body text-muted-foreground">{{ 'tickets.resolveDialog.minutes' | transloco }}</span>
          </div>
          <p class="field-hint">{{ 'tickets.resolveDialog.timeHint' | transloco }}</p>
        </div>
      </div>

      <!-- ── What else this resolve touches ─────────────────────────────────
           Below the note, not above it: the note is what the agent came here to
           write, and pushing it under a wall of warnings is how a dialog gets
           dismissed unread. These are read on the way to the button. -->
      @if (preview(); as data) {
        @if (data.duplicates.length) {
          <div class="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <p class="mb-1 flex items-center gap-1.5 text-body font-semibold">
              <tk-icon name="copy" [size]="15" class="shrink-0 text-primary" />
              {{ 'tickets.resolveDialog.duplicates.heading' | transloco: { count: data.duplicates.length } }}
            </p>
            <p class="mb-2 text-meta text-muted-foreground">
              {{ 'tickets.resolveDialog.duplicates.hint' | transloco }}
            </p>

            <!-- Ticked by default, because "same issue" is a statement somebody
                 already made deliberately by linking them — but every box is
                 individually clearable, because it is somebody's ticket and one of
                 them may have turned out to be different after all. -->
            <ul class="space-y-1.5">
              @for (duplicate of data.duplicates; track duplicate.id) {
                <li class="flex items-start gap-2">
                  <tk-checkbox
                    class="mt-0.5 shrink-0"
                    [checked]="isChosen(duplicate.id)"
                    [disabled]="saving()"
                    [ariaLabel]="duplicate.subject"
                    (checkedChange)="choose(duplicate.id, $event)"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-body">{{ duplicate.subject }}</p>
                    <p class="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                      <span class="font-mono">#{{ number(duplicate.id) }}</span>
                      <tk-badge [tone]="statusTone(duplicate.statusCategory).tone" dot>
                        {{ duplicate.statusName }}
                      </tk-badge>
                      @if (duplicate.assignee; as who) {
                        <span>{{ who.name || who.email }}</span>
                      }
                    </p>
                  </div>
                </li>
              }
            </ul>

            @if (data.moreDuplicates) {
              <!-- Said plainly. A list quietly cut off reads as "that is all of
                   them", and the tickets past the cut stay open forever. -->
              <p class="mt-2 text-meta text-warning-ink">
                {{ 'tickets.resolveDialog.duplicates.capped' | transloco: { max: cascadeLimit } }}
              </p>
            }
          </div>
        }

        @if (warned()) {
          <div class="mt-4 rounded-xl border border-warning/50 bg-warning/10 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-body font-semibold text-warning-ink">
              <tk-icon name="octagon-alert" [size]="15" class="shrink-0" />
              {{ 'tickets.resolveDialog.warnings.heading' | transloco }}
            </p>

            @if (data.warnings.openBlockers.length) {
              <p class="mb-1 text-meta font-semibold">
                {{ 'tickets.resolveDialog.warnings.blockers' | transloco }}
              </p>
              <ul class="mb-2 space-y-0.5 text-meta">
                @for (blocker of data.warnings.openBlockers; track blocker.id) {
                  <li class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-muted-foreground">#{{ number(blocker.id) }}</span>
                    <span class="min-w-0 max-w-[20rem] truncate">{{ blocker.subject }}</span>
                    <tk-badge [tone]="statusTone(blocker.statusCategory).tone" dot>
                      {{ blocker.statusName }}
                    </tk-badge>
                  </li>
                }
              </ul>
            }

            @if (data.warnings.openTasks.length) {
              <p class="mb-1 text-meta font-semibold">
                {{ 'tickets.resolveDialog.warnings.tasks' | transloco: { count: data.warnings.openTasks.length } }}
              </p>
              <ul class="mb-2 space-y-0.5 text-meta">
                @for (task of data.warnings.openTasks; track task.id) {
                  <li class="flex flex-wrap items-center gap-1.5">
                    <span class="min-w-0 max-w-[22rem] truncate">{{ task.title }}</span>
                    @if (task.assignee; as who) {
                      <span class="text-muted-foreground">· {{ who.name || who.email }}</span>
                    }
                  </li>
                }
              </ul>
            }

            @if (data.warnings.pendingResponders.length) {
              <p class="mb-1 text-meta font-semibold">
                {{ 'tickets.resolveDialog.warnings.responders' | transloco }}
              </p>
              <ul class="mb-2 space-y-0.5 text-meta">
                @for (responder of data.warnings.pendingResponders; track responder.agent.id) {
                  <li class="flex flex-wrap items-center gap-1.5">
                    <span>{{ responder.agent.name || responder.agent.email }}</span>
                    @if (responder.role) {
                      <span class="text-muted-foreground">· {{ responder.role }}</span>
                    }
                  </li>
                }
              </ul>
            }

            <!-- The override is an explicit act, and the label says it will be
                 recorded. A confirmation nobody can audit is a click, not
                 accountability — and the log entry is the whole reason this gate
                 is soft rather than a refusal. -->
            <label class="mt-1 flex items-start gap-2">
              <tk-checkbox
                class="mt-0.5 shrink-0"
                [checked]="acknowledged()"
                [disabled]="saving()"
                [ariaLabel]="'tickets.resolveDialog.warnings.acknowledge' | transloco"
                (checkedChange)="acknowledged.set($event)"
              />
              <span class="text-meta">{{ 'tickets.resolveDialog.warnings.acknowledge' | transloco }}</span>
            </label>
          </div>
        }
      } @else if (previewLoading()) {
        <p class="mt-4 flex items-center gap-2 text-meta text-muted-foreground">
          <tk-spinner [size]="14" />
          {{ 'tickets.resolveDialog.checking' | transloco }}
        </p>
      }

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
  /**
   * How many tickets this one note will be written to. 0 or 1 is the normal
   * single-ticket case; more switches the dialog into bulk mode, where it warns
   * instead of naming a subject it cannot name.
   */
  readonly appliesTo = input(0);
  readonly saving = input(false);
  /** Server-side failure. Cleared by the caller when it retries. */
  readonly error = input<string | null>(null);

  /**
   * What else this resolve touches, fetched by the parent when the dialog opens.
   *
   * An input rather than a fetch of its own so this component stays a dialog: it
   * has no ticket id, and giving it one would make it the second place that knows
   * how to read a ticket. Null while it is still loading, and on the bulk path
   * where "which duplicates" has no single answer.
   */
  readonly preview = input<ResolvePreview | null>(null);
  readonly previewLoading = input(false);

  /** Mirrors `TicketResolveGuard.MaxCascade`, for the "there are more" line. */
  protected readonly cascadeLimit = 25;

  readonly confirmed = output<ResolvePayload>();

  protected readonly note = signal('');
  protected readonly summary = signal('');
  protected readonly link = signal('');
  protected readonly hours = signal<number | null>(null);
  protected readonly minutes = signal<number | null>(null);

  /**
   * Which duplicates go with it. Seeded to all of them when the preview lands.
   *
   * A Set rather than a per-row signal: the rows come from an input that can be
   * replaced wholesale, and state keyed by identity survives that where state held
   * on the row objects would not.
   */
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly acknowledged = signal(false);

  protected readonly warned = computed(() => hasWarnings(this.preview()?.warnings));

  protected number(id: string): string {
    return id.slice(0, 8);
  }

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected isChosen(id: string): boolean {
    return this.chosen().has(id);
  }

  protected choose(id: string, wanted: boolean): void {
    const next = new Set(this.chosen());
    if (wanted) next.add(id);
    else next.delete(id);
    this.chosen.set(next);
  }

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

  /**
   * The note is required, and so is the acknowledgement when there is anything to
   * acknowledge.
   *
   * Blocking the button rather than warning after the fact: this is the one screen
   * where "I did not see that" has to be untrue, because the log will say the agent
   * did see it.
   */
  protected readonly canSubmit = computed(
    () =>
      !this.saving() &&
      this.note().trim().length > 0 &&
      !this.linkError() &&
      (!this.warned() || this.acknowledged()),
  );

  constructor() {
    // Reset on open, not on close: closing while a save is in flight would wipe
    // what the agent typed before the failure could put it back in front of them.
    effect(() => {
      if (!this.open()) return;
      this.note.set('');
      this.summary.set('');
      this.link.set('');
      this.hours.set(null);
      this.minutes.set(null);
      // Deliberately NOT reset here: the preview arrives after the dialog opens,
      // so clearing on open would race the seed below and land on empty.
      this.acknowledged.set(false);
    });

    // Seed every duplicate as ticked, once, when the preview lands.
    //
    // Ticked by default because linking two tickets as duplicates is already a
    // deliberate statement that they are the same issue — making the agent
    // re-assert it one box at a time is asking the same question twice. Untick is
    // the exception, and it is one click.
    effect(() => {
      const duplicates = this.preview()?.duplicates;
      if (!duplicates) return;
      untracked(() => this.chosen.set(new Set(duplicates.map((d) => d.id))));
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const total = (this.hours() ?? 0) * 60 + (this.minutes() ?? 0);
    // Intersected with what is actually on offer: a box ticked for a duplicate
    // that has since dropped out of the preview must not be sent, or the server
    // spends a round trip refusing an id this dialog no longer shows.
    const offered = new Set((this.preview()?.duplicates ?? []).map((d) => d.id));
    this.confirmed.emit({
      status: this.status(),
      note: this.note().trim(),
      link: this.link().trim() || undefined,
      summary: this.summary().trim() || undefined,
      // Undefined rather than 0 — the API treats 0 as "no entry", and sending it
      // would be asking for a row that says nobody spent any time.
      minutes: total > 0 ? total : undefined,
      alsoResolve: [...this.chosen()].filter((id) => offered.has(id)),
      // False when there was nothing to warn about, so the flag never claims an
      // acknowledgement that was never asked for.
      acknowledgeWarnings: this.warned() && this.acknowledged(),
    });
  }
}
