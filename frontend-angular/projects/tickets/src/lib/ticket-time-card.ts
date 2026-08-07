import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SessionStore,
  TicketsApi,
  errorMessage,
  formatDateTime,
  formatDuration,
  valueOr,
  type TimeEntry,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfirmService,
  Icon,
  InputDirective,
  LabelDirective,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * Work logged against a ticket: who, how long, on what.
 *
 * Owns its own data rather than taking it from the detail resource. Logging
 * time is frequent and cheap, and re-fetching the whole ticket — SLA, watchers,
 * tags, comments — every time someone adds fifteen minutes would be a lot of
 * work to move one number.
 *
 * Entries are typed in, not measured by a running clock: a timer is left going
 * overnight or never started, and either way the figure has to be corrected by
 * hand afterwards.
 */
@Component({
  selector: 'tk-ticket-time-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Avatar,
    Button,
    Card,
    Icon,
    InputDirective,
    LabelDirective,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <tk-card [heading]="'tickets.time.heading' | transloco">
      <div card-actions>
        <span class="text-body font-extrabold">{{ totalLabel() }}</span>
      </div>

      @if (entries.error()) {
        <tk-alert tone="danger">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="entries.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else if (entries.isLoading() && !entries.value()) {
        <span tkSkeleton class="h-16 w-full"></span>
      } @else {
        <ul class="space-y-3">
          @for (entry of list(); track entry.id) {
            <li class="flex gap-2.5">
              <tk-avatar
                [name]="entry.user.name || entry.user.email"
                [imageUrl]="entry.user.avatarUrl"
                [size]="26"
                round
                class="mt-0.5"
              />
              <div class="min-w-0 flex-1">
                <p class="flex items-baseline justify-between gap-2 text-body">
                  <span class="min-w-0 truncate font-semibold">{{ entry.user.name || entry.user.email }}</span>
                  <span class="shrink-0 font-extrabold">{{ duration(entry) }}</span>
                </p>
                @if (entry.note) {
                  <p class="whitespace-pre-wrap text-meta text-muted-foreground">{{ entry.note }}</p>
                }
                <p class="mt-0.5 flex items-center gap-2 text-meta text-muted-foreground">
                  <span>{{ spentAt(entry) }}</span>
                  @if (mayEdit(entry)) {
                    <button type="button" class="font-semibold hover:text-primary" (click)="edit(entry)">
                      {{ 'common.edit' | transloco }}
                    </button>
                    <button type="button" class="font-semibold hover:text-danger" (click)="remove(entry)">
                      {{ 'common.delete' | transloco }}
                    </button>
                  }
                </p>
              </div>
            </li>
          } @empty {
            @if (!composing()) {
              <li class="text-body text-muted-foreground">{{ 'tickets.time.empty' | transloco }}</li>
            }
          }
        </ul>
      }

      @if (composing()) {
        <div class="mt-3 space-y-2.5 border-t border-border pt-3">
          <div>
            <label tkLabel for="time-hours">{{ 'tickets.time.spent' | transloco }}</label>
            <div class="flex items-center gap-2">
              <input tkInput inset inputSize="sm" id="time-hours" name="hours" type="number" min="0" max="24"
                     class="w-16" [(ngModel)]="hours" />
              <span class="text-meta text-muted-foreground">{{ 'tickets.resolveDialog.hours' | transloco }}</span>
              <input tkInput inset inputSize="sm" name="minutes" type="number" min="0" max="59"
                     class="w-16" [(ngModel)]="minutes" />
              <span class="text-meta text-muted-foreground">{{ 'tickets.resolveDialog.minutes' | transloco }}</span>
            </div>
          </div>
          <div>
            <label tkLabel for="time-note">{{ 'tickets.time.note' | transloco }}</label>
            <textarea tkInput inset inputSize="sm" id="time-note" name="note" rows="2"
                      [placeholder]="'tickets.time.notePlaceholder' | transloco" [(ngModel)]="note"></textarea>
          </div>
          @if (saveError(); as message) {
            <tk-alert tone="danger">{{ message }}</tk-alert>
          }
          <div class="flex justify-end gap-2">
            <button tkButton variant="ghost" size="sm" [disabled]="saving()" (click)="cancel()">
              {{ 'common.cancel' | transloco }}
            </button>
            <button tkButton size="sm" [disabled]="!canSave()" (click)="save()">
              @if (saving()) {
                <tk-spinner [size]="14" />
              }
              {{ 'common.save' | transloco }}
            </button>
          </div>
        </div>
      } @else {
        <button tkButton variant="outline" size="sm" class="mt-3 w-full" (click)="startAdd()">
          <tk-icon name="clock" [size]="15" />
          {{ 'tickets.time.log' | transloco }}
        </button>
      }
    </tk-card>
  `,
})
export class TicketTimeCard {
  private readonly api = inject(TicketsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();

  protected readonly entries = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.timeEntries(params.id),
  });

  protected readonly composing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Null while adding; the entry's id while editing one. */
  private readonly editingId = signal<string | null>(null);

  protected readonly hours = signal<number | null>(null);
  protected readonly minutes = signal<number | null>(null);
  protected readonly note = signal('');

  protected readonly list = computed(() => valueOr(this.entries, []));
  protected readonly loadError = computed(() => errorMessage(this.entries.error()));

  protected readonly totalLabel = computed(() => {
    const total = this.list().reduce((sum, entry) => sum + entry.minutes, 0);
    return total > 0 ? formatDuration(total) : '—';
  });

  protected readonly canSave = computed(
    () => !this.saving() && (this.hours() ?? 0) * 60 + (this.minutes() ?? 0) > 0,
  );

  /** For a parent that logged time through another route — the resolve dialog. */
  refresh(): void {
    this.entries.reload();
  }

  protected duration(entry: TimeEntry): string {
    return formatDuration(entry.minutes);
  }

  protected spentAt(entry: TimeEntry): string {
    return formatDateTime(entry.spentAt);
  }

  /**
   * Your own entry; an admin may correct anyone's.
   *
   * An agent editing a colleague's logged hours is how a timesheet stops being
   * evidence of anything. The API enforces the same rule — this only decides
   * whether the buttons are worth drawing.
   */
  protected mayEdit(entry: TimeEntry): boolean {
    return entry.user.id === this.session.user()?.id || this.session.isAdmin();
  }

  protected startAdd(): void {
    this.editingId.set(null);
    this.hours.set(null);
    this.minutes.set(null);
    this.note.set('');
    this.saveError.set(null);
    this.composing.set(true);
  }

  protected edit(entry: TimeEntry): void {
    this.editingId.set(entry.id);
    this.hours.set(Math.floor(entry.minutes / 60) || null);
    this.minutes.set(entry.minutes % 60 || null);
    this.note.set(entry.note ?? '');
    this.saveError.set(null);
    this.composing.set(true);
  }

  protected cancel(): void {
    this.composing.set(false);
    this.saveError.set(null);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    const body = {
      minutes: (this.hours() ?? 0) * 60 + (this.minutes() ?? 0),
      note: this.note().trim() || undefined,
    };

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const editing = this.editingId();
      if (editing) await this.api.updateTime(this.ticketId(), editing, body);
      else await this.api.logTime(this.ticketId(), body);
      this.composing.set(false);
      this.entries.reload();
    } catch (error) {
      // Inline, not a toast: the form is still on screen with the values in it,
      // and this is something to act on rather than an outcome to acknowledge.
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(entry: TimeEntry): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('tickets.time.confirmDelete.heading'),
      message: this.transloco.translate('tickets.time.confirmDelete.message', {
        duration: formatDuration(entry.minutes),
      }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await this.api.deleteTime(this.ticketId(), entry.id);
      this.entries.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    }
  }
}
