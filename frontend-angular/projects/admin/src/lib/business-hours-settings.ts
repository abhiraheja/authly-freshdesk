import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AdminApi, errorMessage, settled, valueOr, type BusinessDay } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Icon,
  InputDirective,
  LabelDirective,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
} from '@trackly/ui';

/** Monday first — a support rota is read as a working week, not a calendar one. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "09:00" ⇄ 540. The form speaks clock time; the API speaks minutes. */
function toClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

interface DayRow {
  day: number;
  open: boolean;
  start: string;
  end: string;
}

/**
 * Admin → SLA → Business hours: when the desk is open, and the days it is shut.
 *
 * **This is what makes an SLA number a promise the team can keep.** A ticket
 * raised at 17:55 on Friday with a four-hour target is otherwise breached before
 * anyone is back at their desk — which is not a missed SLA, it is a badly
 * measured one, and a team that stops trusting the number stops looking at it.
 *
 * **Off by default, and off means round-the-clock.** A 24/7 desk wants the clock
 * to keep running, and a workspace that has not thought about this is better
 * served by the simple behaviour than by hours somebody else guessed at.
 *
 * Existing deadlines are not recomputed when this changes. They were promised
 * under the old schedule, and quietly moving a queue of due dates is how an
 * agent finds a ticket late that was not late a minute ago.
 */
@Component({
  selector: 'tk-admin-business-hours',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Icon,
    InputDirective,
    LabelDirective,
    SkeletonDirective,
    Spinner,
    Switch,
  ],
  template: `
    @if (loadedHours()) {
      <tk-card [heading]="'admin.hours.title' | transloco">
        <div card-actions>
          <tk-switch
            [checked]="enabled()"
            (checkedChange)="enabled.set($event)"
            [ariaLabel]="'admin.hours.enable' | transloco"
          />
        </div>

        <p class="mb-4 text-body text-muted-foreground">
          {{ (enabled() ? 'admin.hours.onHint' : 'admin.hours.offHint') | transloco }}
        </p>

        <!-- Everything below is meaningless while the clock runs continuously,
             so it is hidden rather than disabled: a form full of greyed inputs
             reads as broken, not as switched off. -->
        @if (enabled()) {
          <div class="mb-4 max-w-xs">
            <label tkLabel for="hours-tz">{{ 'admin.hours.timeZone' | transloco }}</label>
            <input tkInput inset inputSize="sm" id="hours-tz" class="w-full" [(ngModel)]="timeZone" />
            <p class="mt-1 text-meta text-muted-foreground">{{ 'admin.hours.timeZoneHint' | transloco }}</p>
          </div>

          <ul class="divide-y divide-border">
            @for (row of days(); track row.day) {
              <li class="flex flex-wrap items-center gap-3 py-2">
                <tk-checkbox
                  class="w-32 shrink-0"
                  [checked]="row.open"
                  (checkedChange)="setOpen(row.day, $event)"
                >
                  {{ dayName(row.day) }}
                </tk-checkbox>

                @if (row.open) {
                  <input
                    tkInput
                    inset
                    inputSize="sm"
                    class="input-time"
                    [attr.aria-label]="startLabel(row.day)"
                    [ngModel]="row.start"
                    (ngModelChange)="setTime(row.day, 'start', $event)"
                  />
                  <span class="text-muted-foreground">–</span>
                  <input
                    tkInput
                    inset
                    inputSize="sm"
                    class="input-time"
                    [attr.aria-label]="endLabel(row.day)"
                    [ngModel]="row.end"
                    (ngModelChange)="setTime(row.day, 'end', $event)"
                  />
                } @else {
                  <span class="text-body text-muted-foreground">{{ 'admin.hours.closed' | transloco }}</span>
                }
              </li>
            }
          </ul>

          @if (invalid().length) {
            <tk-alert tone="warning" class="mt-3">
              {{ 'admin.hours.invalid' | transloco: { days: invalid().join(', ') } }}
            </tk-alert>
          }

          <!-- ── Holidays ──────────────────────────────────────────────────── -->
          <div class="mt-5 border-t border-border pt-4">
            <p class="mb-2 text-meta font-bold text-muted-foreground">
              {{ 'admin.hours.holidays' | transloco }}
            </p>

            @if (holidays().length) {
              <ul class="mb-3 flex flex-wrap gap-2">
                @for (holiday of holidays(); track holiday.id) {
                  <li>
                    <span class="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-meta">
                      {{ holiday.date }}
                      @if (holiday.name) {
                        <span class="text-muted-foreground">· {{ holiday.name }}</span>
                      }
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-danger"
                        [attr.aria-label]="'admin.hours.removeHoliday' | transloco"
                        [disabled]="busy()"
                        (click)="removeHoliday(holiday.id)"
                      >
                        <tk-icon name="x" [size]="12" />
                      </button>
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="mb-3 text-body text-muted-foreground">{{ 'admin.hours.noHolidays' | transloco }}</p>
            }

            <div class="flex flex-wrap items-end gap-2">
              <div>
                <label tkLabel for="holiday-date">{{ 'admin.hours.holidayDate' | transloco }}</label>
                <input tkInput inset inputSize="sm" id="holiday-date" type="date" [(ngModel)]="holidayDate" />
              </div>
              <div class="min-w-0 flex-1">
                <label tkLabel for="holiday-name">{{ 'admin.hours.holidayName' | transloco }}</label>
                <input tkInput inset inputSize="sm" id="holiday-name" class="w-full" [(ngModel)]="holidayName" />
              </div>
              <button tkButton variant="outline" size="sm" [disabled]="busy() || !holidayDate()" (click)="addHoliday()">
                <tk-icon name="plus" [size]="14" />
                {{ 'admin.hours.addHoliday' | transloco }}
              </button>
            </div>
          </div>
        }

        <div card-footer class="card-footer flex items-center justify-between gap-2">
          <p class="flex items-start gap-2 text-meta text-muted-foreground">
            <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
            <span>{{ 'admin.hours.existingHint' | transloco }}</span>
          </p>
          <button tkButton [disabled]="busy()" (click)="save()">
            @if (busy()) {
              <tk-spinner [size]="16" />
            }
            {{ 'common.save' | transloco }}
          </button>
        </div>
      </tk-card>
    } @else if (hours.error()) {
      <tk-alert tone="danger">{{ loadError() }}</tk-alert>
    } @else {
      <span tkSkeleton class="block h-64 w-full"></span>
    }

    <!-- ── Scorecard ──────────────────────────────────────────────────────── -->
    <tk-card class="mt-5" [heading]="'admin.scorecard.title' | transloco">
      <p class="mb-3 text-meta text-muted-foreground">{{ 'admin.scorecard.hint' | transloco }}</p>

      @if (loadedScorecard(); as rows) {
        @if (rows.length) {
          <div class="overflow-x-auto">
            <table class="w-full min-w-[520px] border-collapse text-body">
              <thead>
                <tr class="border-b border-border text-left">
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.scorecard.agent' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.scorecard.resolved' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.scorecard.firstResponse' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.scorecard.resolution' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.scorecard.attainment' | transloco }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows; track row.agentId) {
                  <tr class="border-t border-border">
                    <td class="py-2 font-semibold">{{ row.name }}</td>
                    <td class="py-2">{{ row.resolved }}</td>
                    <td class="py-2 text-muted-foreground">
                      {{ row.firstResponseMet }} / {{ row.firstResponseTracked }}
                    </td>
                    <td class="py-2 text-muted-foreground">
                      {{ row.resolutionMet }} / {{ row.resolutionTracked }}
                    </td>
                    <td class="py-2">
                      <!-- Null, not zero, when nothing was measurable: "0%" reads
                           as failure and the truth is that no target applied. -->
                      @if (row.attainment === null) {
                        <span class="text-muted-foreground">—</span>
                      } @else {
                        <tk-badge [tone]="attainmentTone(row.attainment)">{{ row.attainment }}%</tk-badge>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="text-body text-muted-foreground">{{ 'admin.scorecard.empty' | transloco }}</p>
        }
      } @else {
        <span tkSkeleton class="block h-24 w-full"></span>
      }
    </tk-card>
  `,
})
export class BusinessHoursSettings {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly hours = resource({ loader: () => this.api.businessHours() });
  protected readonly scorecard = resource({ loader: () => this.api.slaScorecard(30) });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedHours = settled(() => this.hours);
  protected readonly loadedScorecard = settled(() => this.scorecard);

  protected readonly enabled = signal(false);
  protected readonly timeZone = signal('UTC');
  protected readonly rows = signal<Record<number, DayRow>>({});
  protected readonly busy = signal(false);
  protected readonly holidayDate = signal('');
  protected readonly holidayName = signal('');

  protected readonly loadError = computed(() => errorMessage(this.hours.error()));
  protected readonly holidays = computed(() => this.loadedHours()?.holidays ?? []);

  constructor() {
    effect(() => {
      const saved = this.loadedHours();
      if (!saved) return;
      // untracked: seeds from the server, so it must run when the server answers
      // and at no other time — otherwise every keystroke resets the form.
      untracked(() => {
        this.enabled.set(saved.isEnabled);
        this.timeZone.set(saved.timeZone);

        const byDay = new Map(saved.days.map((d) => [d.dayOfWeek, d]));
        const seeded: Record<number, DayRow> = {};
        for (const day of DAY_ORDER) {
          const window = byDay.get(day);
          seeded[day] = {
            day,
            // An open day is one that HAS a window. There is no separate flag to
            // fall out of step with the hours.
            open: !!window,
            // A day being switched on for the first time gets a sensible working
            // window rather than 00:00–00:00, which saves as "closed" and looks
            // like the tick did not take.
            start: toClock(window?.startMinute ?? 540),
            end: toClock(window?.endMinute ?? 1020),
          };
        }
        this.rows.set(seeded);
      });
    });
  }

  protected readonly days = computed(() => DAY_ORDER.map((d) => this.rows()[d]).filter(Boolean));

  /** Days whose times cannot be parsed, or that end before they start. */
  protected readonly invalid = computed(() =>
    this.days()
      .filter((row) => {
        if (!row.open) return false;
        const start = toMinutes(row.start);
        const end = toMinutes(row.end);
        return start === null || end === null || end <= start;
      })
      .map((row) => this.dayName(row.day)),
  );

  protected dayName(day: number): string {
    return this.transloco.translate(`admin.hours.days.${day}`);
  }

  protected startLabel(day: number): string {
    return `${this.dayName(day)} — ${this.transloco.translate('admin.hours.opens')}`;
  }

  protected endLabel(day: number): string {
    return `${this.dayName(day)} — ${this.transloco.translate('admin.hours.closes')}`;
  }

  protected attainmentTone(value: number): 'success' | 'warning' | 'danger' {
    // Bands, not a gradient: the question is "is this fine, watch it, or act on
    // it", and three answers is what a manager can act on.
    return value >= 90 ? 'success' : value >= 70 ? 'warning' : 'danger';
  }

  protected setOpen(day: number, open: boolean): void {
    this.rows.update((rows) => ({ ...rows, [day]: { ...rows[day], open } }));
  }

  protected setTime(day: number, which: 'start' | 'end', value: string): void {
    this.rows.update((rows) => ({ ...rows, [day]: { ...rows[day], [which]: value } }));
  }

  protected async save(): Promise<void> {
    if (this.invalid().length) {
      this.toast.error(
        this.transloco.translate('admin.hours.invalid', { days: this.invalid().join(', ') }),
      );
      return;
    }

    const days: BusinessDay[] = this.days()
      .filter((row) => row.open)
      .map((row) => ({
        dayOfWeek: row.day,
        startMinute: toMinutes(row.start)!,
        endMinute: toMinutes(row.end)!,
      }));

    await this.write(() =>
      this.api.saveBusinessHours({ isEnabled: this.enabled(), timeZone: this.timeZone().trim(), days }),
    );
  }

  protected async addHoliday(): Promise<void> {
    const date = this.holidayDate();
    if (!date || this.busy()) return;
    await this.write(() => this.api.addHoliday(date, this.holidayName().trim() || null));
    this.holidayDate.set('');
    this.holidayName.set('');
  }

  protected async removeHoliday(id: string): Promise<void> {
    await this.write(() => this.api.removeHoliday(id));
  }

  private async write(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.toast.success(this.transloco.translate('admin.hours.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.hours.reload();
      this.busy.set(false);
    }
  }
}

/** Kept out of the class so the seeding effect stays readable. */
export { toClock, toMinutes };
