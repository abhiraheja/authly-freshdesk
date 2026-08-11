import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
    AnalyticsApi,
  REWARD_METRICS,
  REWARD_PERIODS,
  REWARD_TIERS,
  errorMessage,
  isPercentageMetric,
  settled,
  type RewardGoal,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Icon,
  InputDirective,
  LabelDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Rewards: the targets this workspace considers good work.
 *
 * **Trackly ships none of these on purpose.** "50 tickets a month" is heroic on a
 * two-person IT desk and unambitious on a fifty-agent floor, so a built-in set
 * would be shipping somebody else's opinion of the team's job. An empty list is the
 * honest starting state, and the empty copy says what to do about it.
 *
 * **Every metric is already recorded.** Nothing here asks an agent to log anything
 * extra — a scoreboard that needs feeding stops being true within a fortnight.
 *
 * Awarding happens in a background sweep every fifteen minutes, not on save, so the
 * numbers on this page describe intent and the badges describe history. Once a goal
 * has awarded anything, delete is replaced by retire: a badge whose goal is gone is
 * a trophy with the engraving rubbed off.
 */
@Component({
  selector: 'tk-reward-settings',
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
    LabelDirective,
    Select,
    SelectOption,
    SkeletonDirective,
  ],
  template: `
    <div class="mx-auto max-w-[860px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.rewards.title' | transloco }}</h1>
      <p class="mb-5 mt-1 text-body text-muted-foreground">{{ 'admin.rewards.subtitle' | transloco }}</p>

      @if (goals.error()) {
        <tk-alert tone="danger" [heading]="'admin.rewards.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="goals.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else if (loadedGoals()) {
        <tk-card flush [heading]="'admin.rewards.goals' | transloco">
          <ul class="divide-y divide-border">
            @for (goal of rows(); track goal.id) {
              <li class="flex flex-wrap items-center gap-3 px-5 py-3">
                <tk-icon name="trophy" [size]="16" class="shrink-0" [class]="tierClass(goal.tier)" />

                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2">
                    <span class="truncate font-semibold" [class.text-muted-foreground]="!goal.isActive">
                      {{ goal.name }}
                    </span>
                    @if (!goal.isActive) {
                      <tk-badge tone="neutral">{{ 'admin.rewards.retired' | transloco }}</tk-badge>
                    }
                    @if (goal.awardedCount) {
                      <tk-badge tone="success">
                        {{ 'admin.rewards.awarded' | transloco: { count: goal.awardedCount } }}
                      </tk-badge>
                    }
                  </p>
                  <p class="text-meta text-muted-foreground">
                    {{ describe(goal) }}
                  </p>
                  @if (goal.description) {
                    <p class="text-meta text-muted-foreground">{{ goal.description }}</p>
                  }
                </div>

                <span class="shrink-0 text-meta font-bold text-primary">
                  {{ 'admin.rewards.pointsShort' | transloco: { points: goal.points } }}
                </span>

                <button
                  type="button"
                  class="shrink-0 text-meta font-semibold text-primary hover:underline disabled:opacity-40"
                  [disabled]="busy()"
                  (click)="setActive(goal, !goal.isActive)"
                >
                  {{ (goal.isActive ? 'admin.rewards.retire' : 'admin.rewards.restore') | transloco }}
                </button>

                <!-- Hidden once anything has been awarded, not disabled: the API
                     refuses it, and a dead button invites the click that finds
                     that out. Retire is the move that keeps the badges. -->
                @if (!goal.awardedCount) {
                  <button
                    type="button"
                    class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    [disabled]="busy()"
                    [attr.aria-label]="'common.delete' | transloco"
                    (click)="remove(goal)"
                  >
                    <tk-icon name="trash-2" [size]="15" />
                  </button>
                }
              </li>
            } @empty {
              <li class="px-5 py-6 text-center text-body text-muted-foreground">
                {{ 'admin.rewards.empty' | transloco }}
              </li>
            }
          </ul>

          <!-- ── Add ────────────────────────────────────────────────────────
               One row, because a goal is five short answers. A modal for it
               would be more machinery than the fields are worth. -->
          <div card-footer class="card-footer space-y-3">
            <div class="flex flex-wrap items-end gap-2">
              <div class="min-w-[200px] flex-1">
                <label tkLabel for="goal-name">{{ 'admin.rewards.name' | transloco }}</label>
                <input
                  tkInput
                  inset
                  inputSize="sm"
                  id="goal-name"
                  class="w-full"
                  [placeholder]="'admin.rewards.namePlaceholder' | transloco"
                  [(ngModel)]="name"
                  (keydown.enter)="add()"
                />
              </div>

              <div class="w-48">
                <label tkLabel for="goal-metric">{{ 'admin.rewards.metric' | transloco }}</label>
                <tk-select inset size="sm" [inputId]="'goal-metric'" [(value)]="metric">
                  @for (option of metrics; track option) {
                    <tk-option [value]="option" [label]="metricLabel(option)" />
                  }
                </tk-select>
              </div>

              <div class="w-28">
                <label tkLabel for="goal-target">{{ targetLabel() }}</label>
                <input
                  tkInput
                  inset
                  inputSize="sm"
                  id="goal-target"
                  type="number"
                  min="1"
                  [attr.max]="isPercent() ? 100 : null"
                  class="w-full"
                  [(ngModel)]="target"
                />
              </div>

              <div class="w-36">
                <label tkLabel for="goal-period">{{ 'admin.rewards.period' | transloco }}</label>
                <tk-select inset size="sm" [inputId]="'goal-period'" [(value)]="period">
                  @for (option of periods; track option) {
                    <tk-option [value]="option" [label]="periodLabel(option)" />
                  }
                </tk-select>
              </div>
            </div>

            <div class="flex flex-wrap items-end gap-2">
              <div class="w-28">
                <label tkLabel for="goal-points">{{ 'admin.rewards.points' | transloco }}</label>
                <input
                  tkInput
                  inset
                  inputSize="sm"
                  id="goal-points"
                  type="number"
                  min="0"
                  class="w-full"
                  [(ngModel)]="points"
                />
              </div>

              <div class="w-32">
                <label tkLabel for="goal-tier">{{ 'admin.rewards.tier' | transloco }}</label>
                <tk-select inset size="sm" [inputId]="'goal-tier'" [(value)]="tier">
                  @for (option of tiers; track option) {
                    <tk-option [value]="option" [label]="tierLabel(option)" />
                  }
                </tk-select>
              </div>

              <!-- Only for a rate goal, because it means nothing for a count and a
                   field that does nothing is a field somebody fills in wrongly. -->
              @if (isPercent()) {
                <div class="w-40">
                  <label tkLabel for="goal-sample">{{ 'admin.rewards.minimumSample' | transloco }}</label>
                  <input
                    tkInput
                    inset
                    inputSize="sm"
                    id="goal-sample"
                    type="number"
                    min="0"
                    class="w-full"
                    [(ngModel)]="minimumSample"
                  />
                </div>
              }

              <div class="min-w-[200px] flex-1">
                <label tkLabel for="goal-desc">{{ 'admin.rewards.description' | transloco }}</label>
                <input tkInput inset inputSize="sm" id="goal-desc" class="w-full" [(ngModel)]="description" />
              </div>

              <button tkButton size="sm" [disabled]="!canAdd()" (click)="add()">
                <tk-icon name="plus" [size]="14" />
                {{ 'admin.rewards.add' | transloco }}
              </button>
            </div>

            @if (isPercent()) {
              <p class="text-meta text-muted-foreground">
                {{ 'admin.rewards.minimumSampleHint' | transloco }}
              </p>
            }

            @if (addError(); as message) {
              <tk-alert tone="danger">{{ message }}</tk-alert>
            }
          </div>
        </tk-card>

        <p class="mt-4 flex items-start gap-2 text-meta text-muted-foreground">
          <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
          {{ 'admin.rewards.sweepHint' | transloco }}
        </p>
      } @else {
        <span tkSkeleton class="block h-64 w-full"></span>
      }
    </div>
  `,
})
export class RewardSettings {
  private readonly api = inject(AnalyticsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly metrics = REWARD_METRICS;
  protected readonly periods = REWARD_PERIODS;
  protected readonly tiers = REWARD_TIERS;

  /** Retired goals included: this is the screen where they are brought back. */
  protected readonly goals = resource({ loader: () => this.api.goals(true) });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedGoals = settled(() => this.goals);

  protected readonly rows = computed(() => this.loadedGoals() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.goals.error()));

  protected readonly busy = signal(false);
  protected readonly addError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly metric = signal<string>('tickets_resolved');
  protected readonly target = signal<number | null>(null);
  protected readonly period = signal<string>('month');
  protected readonly points = signal<number | null>(10);
  protected readonly tier = signal<string>('bronze');
  protected readonly minimumSample = signal<number | null>(10);

  protected readonly isPercent = computed(() => isPercentageMetric(this.metric()));

  protected readonly targetLabel = computed(() =>
    this.transloco.translate(
      this.isPercent() ? 'admin.rewards.targetPercent' : 'admin.rewards.targetCount',
    ),
  );

  protected readonly canAdd = computed(
    () => !this.busy() && this.name().trim().length > 0 && (this.target() ?? 0) >= 1,
  );

  protected metricLabel(metric: string): string {
    return this.transloco.translate(`admin.rewards.metrics.${metric}`);
  }

  protected periodLabel(period: string): string {
    return this.transloco.translate(`admin.rewards.periods.${period}`);
  }

  protected tierLabel(tier: string): string {
    return this.transloco.translate(`admin.rewards.tiers.${tier}`);
  }

  /** "12 tickets resolved · this month" — the goal in one readable line. */
  protected describe(goal: RewardGoal): string {
    const target = isPercentageMetric(goal.metric) ? `${goal.target}%` : `${goal.target}`;
    const parts = [
      `${target} ${this.metricLabel(goal.metric).toLowerCase()}`,
      this.periodLabel(goal.period).toLowerCase(),
    ];
    if (isPercentageMetric(goal.metric) && goal.minimumSample > 0)
      parts.push(
        this.transloco.translate('admin.rewards.minimumSampleShort', { count: goal.minimumSample }),
      );
    return parts.join(' · ');
  }

  /** Static lookups — an interpolated Tailwind class emits no CSS under v4. */
  protected tierClass(tier: string): string {
    switch (tier) {
      case 'gold':
        return 'text-warning-ink';
      case 'silver':
        return 'text-muted-foreground';
      default:
        return 'text-primary';
    }
  }

  protected async add(): Promise<void> {
    if (!this.canAdd()) return;
    this.busy.set(true);
    this.addError.set(null);
    try {
      await this.api.createGoal({
        name: this.name().trim(),
        description: this.description().trim() || null,
        metric: this.metric(),
        target: this.target()!,
        period: this.period(),
        points: this.points() ?? 0,
        tier: this.tier(),
        // Sent as 0 for a count goal, where it means nothing — rather than
        // carrying over whatever the field held while it was last visible.
        minimumSample: this.isPercent() ? (this.minimumSample() ?? 0) : 0,
      });
      this.name.set('');
      this.description.set('');
      this.target.set(null);
      this.goals.reload();
    } catch (error) {
      // Inline, not a toast: the form is still on screen with what they typed, and
      // "a percentage target cannot be above 100" is something to act on.
      this.addError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async setActive(goal: RewardGoal, isActive: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.updateGoal(goal.id, { isActive });
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.goals.reload();
      this.busy.set(false);
    }
  }

  protected async remove(goal: RewardGoal): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('admin.rewards.confirmDelete.heading'),
      message: this.transloco.translate('admin.rewards.confirmDelete.message', { name: goal.name }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!confirmed) return;

    this.busy.set(true);
    try {
      await this.api.deleteGoal(goal.id);
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.goals.reload();
      this.busy.set(false);
    }
  }
}
