import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AdminApi, PRIORITY_TONE, errorMessage, toneFor, valueOr } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Icon,
  InputDirective,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';
import { BusinessHoursSettings } from './business-hours-settings';

/** Most urgent first — an SLA table is read top-down looking for the tight one. */
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

/**
 * Admin → SLA: first-response and resolution targets, one row per priority.
 *
 * **Hours here, minutes on the wire.** The clock counts minutes; nobody sets a
 * target in them. `0.5` is accepted and rounded to 30, so "half an hour" does
 * not need converting in the admin's head.
 *
 * **Blank is a real value.** It means no target for that leg, and the countdown
 * simply does not run — which is different from a target of zero and is why the
 * field is cleared to a dash rather than to `0`.
 *
 * Existing tickets keep the deadlines they were stamped with. Changing a policy
 * moves what NEW tickets get and what a priority change recomputes, not the
 * queue you are looking at.
 */
@Component({
  selector: 'tk-admin-sla-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Icon,
    InputDirective,
    SkeletonDirective,
    Spinner,
    BusinessHoursSettings,
  ],
  template: `
    <div class="mx-auto max-w-[720px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.sla.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.sla.subtitle' | transloco }}</p>

      <!-- Value first, skeleton last: a reload after saving must not swap the
           table out from under an admin who is still typing. -->
      @if (policies.value()) {
        <tk-card>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] border-collapse">
              <thead>
                <tr class="border-b border-border text-left">
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'tickets.columns.priority' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.sla.firstResponse' | transloco }}
                  </th>
                  <th class="pb-2 text-meta font-bold text-muted-foreground">
                    {{ 'admin.sla.resolution' | transloco }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (priority of priorities; track priority) {
                  <tr>
                    <td class="w-32 py-2.5">
                      <tk-badge [tone]="tone(priority).tone">{{ tone(priority).labelKey | transloco }}</tk-badge>
                    </td>
                    <td class="py-2.5 pr-3">
                      <input
                        tkInput
                        inset
                        inputSize="sm"
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="—"
                        class="w-full"
                        [attr.aria-label]="ariaFor(priority, 'admin.sla.firstResponse')"
                        [ngModel]="firstResponse()[priority] ?? ''"
                        (ngModelChange)="setFirstResponse(priority, $event)"
                      />
                    </td>
                    <td class="py-2.5">
                      <input
                        tkInput
                        inset
                        inputSize="sm"
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="—"
                        class="w-full"
                        [attr.aria-label]="ariaFor(priority, 'admin.sla.resolution')"
                        [ngModel]="resolve()[priority] ?? ''"
                        (ngModelChange)="setResolve(priority, $event)"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <p class="mt-3 flex items-start gap-2 text-meta text-muted-foreground">
            <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
            <span>{{ 'admin.sla.hint' | transloco }}</span>
          </p>

          <div card-footer class="card-footer flex items-center justify-end gap-2">
            <button tkButton [disabled]="saving()" (click)="save()">
              @if (saving()) {
                <tk-spinner [size]="16" />
              }
              {{ 'admin.sla.save' | transloco }}
            </button>
          </div>
        </tk-card>
      } @else if (policies.error()) {
        <tk-alert tone="danger" [heading]="'admin.sla.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="policies.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <span tkSkeleton class="h-64 w-full"></span>
      }

      <!-- Business hours and the scorecard sit under the targets, in that
           order: the targets are the promise, the hours are what makes it
           keepable, and the scorecard is how well it was kept. -->
      <tk-admin-business-hours class="mt-5 block" />
    </div>
  `,
})
export class SlaSettings {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly priorities = PRIORITIES;

  protected readonly policies = resource({ loader: () => this.api.slaPolicies() });

  /** Hours as typed, keyed by priority. '' is a real value: no target. */
  protected readonly firstResponse = signal<Record<string, string>>({});
  protected readonly resolve = signal<Record<string, string>>({});
  protected readonly saving = signal(false);

  protected readonly loadError = computed(() => errorMessage(this.policies.error()));

  constructor() {
    // Seeded from the server whenever it answers, including after a save. The
    // fields are not bound to the resource directly because '' has to survive
    // being typed — a two-way binding onto a nullable number would keep
    // rewriting it back to the stored value mid-edit.
    effect(() => {
      const saved = valueOr(this.policies, []);
      const byPriority = new Map(saved.map((policy) => [policy.priority, policy]));
      const first: Record<string, string> = {};
      const resolve: Record<string, string> = {};
      for (const priority of PRIORITIES) {
        first[priority] = toHours(byPriority.get(priority)?.firstResponseMinutes ?? null);
        resolve[priority] = toHours(byPriority.get(priority)?.resolveMinutes ?? null);
      }
      this.firstResponse.set(first);
      this.resolve.set(resolve);
    });
  }

  protected tone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  /** The inputs have no visible label of their own — the row's badge is it. */
  protected ariaFor(priority: string, key: string): string {
    return `${this.transloco.translate(`priority.${priority}`)} — ${this.transloco.translate(key)}`;
  }

  protected setFirstResponse(priority: string, value: string): void {
    this.firstResponse.update((current) => ({ ...current, [priority]: String(value ?? '') }));
  }

  protected setResolve(priority: string, value: string): void {
    this.resolve.update((current) => ({ ...current, [priority]: String(value ?? '') }));
  }

  /**
   * One request per priority, because the API upserts a single policy at a time.
   *
   * Sequential rather than `Promise.all`: four rows is nothing, and if the third
   * fails the admin needs to be told which target did not take rather than
   * having four results race into one error.
   */
  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      for (const priority of PRIORITIES) {
        await this.api.saveSlaPolicy({
          priority,
          firstResponseMinutes: toMinutes(this.firstResponse()[priority]),
          resolveMinutes: toMinutes(this.resolve()[priority]),
        });
      }
      this.policies.reload();
      this.toast.success(this.transloco.translate('admin.sla.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}

/** 90 → "1.5", null → "". Trailing ".0" is dropped so 2 hours reads as "2". */
function toHours(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '';
  return String(Number((minutes / 60).toFixed(2)));
}

/** "" and anything at or below zero mean "no target", which the API takes as null. */
function toMinutes(hours: string | undefined): number | null {
  const value = Number(hours ?? '');
  if (!String(hours ?? '').trim() || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 60);
}
