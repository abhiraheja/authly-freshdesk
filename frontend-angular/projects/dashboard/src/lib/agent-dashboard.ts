import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  AnalyticsApi,
  PRIORITY_TONE,
  errorMessage,
  isPercentageMetric,
  toneFor,
  type RewardProgress,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Bars,
  Button,
  Card,
  Icon,
  Meter,
  SkeletonDirective,
  StatCard,
  type BarGroup,
} from '@trackly/ui';

/**
 * One agent's own dashboard: what is on them, how they are doing, what they are
 * working toward.
 *
 * **Two kinds of number, kept apart.** "What is on me" is this moment and is
 * actionable — every tile in the first row links somewhere you can do something.
 * "How am I doing" is a trailing window and is not actionable at all; it is
 * feedback. Mixing them produced a screen where an agent could not tell which
 * numbers they were supposed to act on.
 *
 * **Nothing is invented.** Every figure comes from `GET /api/dashboard/me`, which
 * an agent may only ever call for themselves. Where the workspace has configured
 * no reward goals the whole rewards card is absent rather than showing an empty
 * scoreboard — an empty scoreboard reads as "you have earned nothing".
 *
 * Also serves as the admin's "My work" tab, which is why the agent is an input
 * rather than read from the session: an admin reviewing somebody's figures and an
 * agent looking at their own are the same screen.
 */
@Component({
  selector: 'tk-agent-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Bars,
    Button,
    Card,
    Icon,
    Meter,
    SkeletonDirective,
    StatCard,
  ],
  template: `
    @if (overview.error()) {
      <tk-alert tone="danger" [heading]="'dashboard.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="overview.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-6">
        <!-- ── On me right now ──────────────────────────────────────────────
             Every tile here is a place to go. Overdue and awaiting-first-reply
             turn red only when they are non-zero, because a red zero teaches
             people to stop reading the colour. -->
        <section>
          <h2 class="mb-3 font-display text-section font-extrabold">
            {{ 'dashboard.agent.onMe' | transloco }}
          </h2>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <tk-stat-card
              [label]="'dashboard.agent.openTickets' | transloco"
              icon="ticket"
              tone="primary"
              [value]="data()?.openNow"
              clickable
              routerLink="/dashboard/tickets"
              [queryParams]="{ view: 'mine' }"
            />
            <tk-stat-card
              [label]="'dashboard.agent.overdue' | transloco"
              icon="timer"
              [tone]="(data()?.overdueNow ?? 0) > 0 ? 'danger' : 'success'"
              [value]="data()?.overdueNow"
            />
            <tk-stat-card
              [label]="'dashboard.agent.awaitingReply' | transloco"
              icon="message-square"
              [tone]="(data()?.awaitingFirstReply ?? 0) > 0 ? 'warning' : 'success'"
              [value]="data()?.awaitingFirstReply"
            />
            <tk-stat-card
              [label]="'dashboard.agent.openTasks' | transloco"
              icon="clipboard-list"
              [tone]="(data()?.overdueTasks ?? 0) > 0 ? 'danger' : 'info'"
              [value]="data()?.pendingTasks"
              clickable
              routerLink="/dashboard/tasks"
            />
            <tk-stat-card
              [label]="'dashboard.agent.mentions' | transloco"
              icon="at-sign"
              tone="neutral"
              [value]="data()?.mentioningMeCount"
              clickable
              routerLink="/dashboard/tickets"
              [queryParams]="{ view: 'mentioned' }"
            />
          </div>

          @if (data()?.overdueTasks; as late) {
            <p class="mt-2 flex items-center gap-1.5 text-meta font-semibold text-danger">
              <tk-icon name="clock" [size]="13" />
              {{ 'dashboard.agent.overdueTasks' | transloco: { count: late } }}
            </p>
          }
        </section>

        <!-- ── How I am doing ───────────────────────────────────────────────
             Feedback, not a to-do list. Said explicitly in the subheading,
             because a number with no window on it invites the wrong reading. -->
        <section>
          <h2 class="mb-1 font-display text-section font-extrabold">
            {{ 'dashboard.agent.performance' | transloco }}
          </h2>
          <p class="mb-3 text-meta text-muted-foreground">
            {{ 'dashboard.agent.performanceWindow' | transloco: { days: data()?.days ?? 30 } }}
          </p>

          <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <tk-card class="xl:col-span-2" [heading]="'dashboard.agent.resolvedPerDay' | transloco">
              <div card-actions>
                <span class="text-meta font-bold text-muted-foreground">
                  {{ 'dashboard.agent.resolvedTotal' | transloco: { count: data()?.resolved ?? 0 } }}
                </span>
              </div>
              @if (overview.isLoading() && !data()) {
                <span tkSkeleton class="block h-32 w-full"></span>
              } @else if (data()?.resolved) {
                <tk-bars [data]="resolvedBars()" [seriesNames]="[resolvedSeriesName()]" />
              } @else {
                <p class="py-10 text-center text-body text-muted-foreground">
                  {{ 'dashboard.agent.nothingResolved' | transloco }}
                </p>
              }
            </tk-card>

            <tk-card [heading]="'dashboard.agent.quality' | transloco">
              @if (overview.isLoading() && !data()) {
                <span tkSkeleton class="block h-32 w-full"></span>
              } @else {
                <dl class="space-y-3 text-body">
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-muted-foreground">{{ 'dashboard.agent.firstResponse' | transloco }}</dt>
                    <dd class="font-semibold">{{ duration(data()?.avgFirstResponseMinutes) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-muted-foreground">{{ 'dashboard.agent.resolutionTime' | transloco }}</dt>
                    <dd class="font-semibold">{{ duration(data()?.avgResolutionMinutes) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-muted-foreground">{{ 'dashboard.agent.responseSla' | transloco }}</dt>
                    <dd class="font-semibold">{{ percent(data()?.firstResponseSlaAttainment) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-muted-foreground">{{ 'dashboard.agent.resolutionSla' | transloco }}</dt>
                    <dd class="font-semibold">{{ percent(data()?.resolutionSlaAttainment) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <dt class="text-muted-foreground">{{ 'dashboard.agent.csat' | transloco }}</dt>
                    <dd class="font-semibold">
                      @if (data()?.avgCsat; as csat) {
                        {{ csat }} / 5
                        <span class="text-meta font-normal text-muted-foreground">
                          ({{ 'dashboard.agent.csatCount' | transloco: { count: data()?.csatResponses ?? 0 } }})
                        </span>
                      } @else {
                        <!-- Not "0". Nobody rating you is not a rating of zero, and
                             the two would be read the same way in a table. -->
                        <span class="text-muted-foreground">{{ 'dashboard.agent.noRatings' | transloco }}</span>
                      }
                    </dd>
                  </div>
                </dl>
              }
            </tk-card>
          </div>
        </section>

        <!-- ── What I am carrying, and what I am working toward ───────────── -->
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <tk-card [heading]="'dashboard.agent.byPriority' | transloco">
            @if (priorities().length) {
              <ul class="space-y-2.5">
                @for (row of priorities(); track row.label) {
                  <li class="flex items-center justify-between gap-3">
                    <tk-badge [tone]="priorityTone(row.label).tone">
                      {{ priorityTone(row.label).labelKey | transloco }}
                    </tk-badge>
                    <b class="font-display font-extrabold">{{ row.count }}</b>
                  </li>
                }
              </ul>
            } @else {
              <p class="py-6 text-center text-body text-muted-foreground">
                {{ 'dashboard.agent.queueEmpty' | transloco }}
              </p>
            }
          </tk-card>

          <!-- Absent, not empty, when the workspace runs no goals. A scoreboard
               with no goals on it reads as "you have earned nothing". -->
          @if (rewards().length) {
            <tk-card [heading]="'dashboard.agent.goals' | transloco">
              <div card-actions>
                <span class="text-meta font-bold text-primary">
                  {{ 'dashboard.agent.points' | transloco: { points: data()?.rewardPoints ?? 0 } }}
                </span>
              </div>
              <ul class="space-y-3">
                @for (row of rewards(); track row.goal.id) {
                  <li>
                    <div class="mb-1 flex items-center gap-2">
                      @if (row.earned) {
                        <tk-icon name="trophy" [size]="14" [class]="tierClass(row.goal.tier)" />
                      }
                      <span class="min-w-0 flex-1 truncate text-body font-semibold">{{ row.goal.name }}</span>
                      @if (row.earned) {
                        <tk-badge tone="success">{{ 'dashboard.agent.earned' | transloco }}</tk-badge>
                      }
                    </div>
                    <tk-meter
                      [label]="goalLabel(row)"
                      [value]="goalValue(row)"
                      [percent]="goalPercent(row)"
                      [series]="tierSeries(row.goal.tier)"
                    />
                    @if (row.goal.description) {
                      <p class="mt-1 text-meta text-muted-foreground">{{ row.goal.description }}</p>
                    }
                  </li>
                }
              </ul>
            </tk-card>
          }
        </div>

        @if (data()?.badges; as badges) {
          <tk-card [heading]="'dashboard.agent.badges' | transloco">
            <div card-actions>
              <span class="text-meta font-bold text-muted-foreground">{{ badges }}</span>
            </div>
            @if (awards.value(); as list) {
              <ul class="flex flex-wrap gap-2">
                @for (award of list; track award.id) {
                  <li
                    class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                    [class]="tierFrame(award.tier)"
                    [title]="awardTitle(award.periodKey, award.value, award.target)"
                  >
                    <tk-icon name="trophy" [size]="14" [class]="tierClass(award.tier)" />
                    <span class="text-meta font-semibold">{{ award.goalName }}</span>
                    <span class="text-meta text-muted-foreground">{{ award.periodKey }}</span>
                  </li>
                }
              </ul>
            } @else {
              <span tkSkeleton class="block h-10 w-full"></span>
            }
          </tk-card>
        }

        <a tkButton variant="secondary" routerLink="/dashboard/tickets" [queryParams]="{ view: 'mine' }">
          {{ 'dashboard.agent.openMyQueue' | transloco }}
        </a>
      </div>
    }
  `,
})
export class AgentDashboard {
  private readonly api = inject(AnalyticsApi);

  /**
   * Whose figures. Omitted means the caller's own — and the API enforces that an
   * agent can only ever get their own, whatever is passed.
   */
  readonly agentId = input<string | undefined>(undefined);
  readonly days = input(30);

  protected readonly overview = resource({
    params: () => ({ agent: this.agentId(), days: this.days() }),
    loader: ({ params }) => this.api.me(params.agent, params.days),
  });

  /**
   * Badges, fetched separately so the main screen is not held up by a list that
   * lives at the bottom of it.
   */
  protected readonly awards = resource({
    params: () => ({ agent: this.agentId() ?? 'me' }),
    loader: ({ params }) => this.api.awards(params.agent, 24),
  });

  protected readonly data = computed(() => this.overview.value());
  protected readonly loadError = computed(() => errorMessage(this.overview.error()));

  protected readonly priorities = computed(() => this.data()?.byPriority ?? []);
  protected readonly rewards = computed(() => this.data()?.rewards ?? []);

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  /** One bar per day. `label` is the day of the month — a full date is unreadable at 30 bars. */
  protected readonly resolvedBars = computed<BarGroup[]>(() =>
    (this.data()?.resolvedPerDay ?? []).map((point) => ({
      label: point.date.slice(-2),
      values: [point.count],
    })),
  );

  /** Passed as an already-translated string, per `tk-bars`. */
  protected readonly resolvedSeriesName = computed(() => 'Resolved');

  /**
   * Minutes as something a person reads. `—` when there is nothing to average, not
   * `0m`: no measurable tickets and an instant response are different facts.
   */
  protected duration(minutes: number | null | undefined): string {
    if (minutes === null || minutes === undefined) return '—';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  /** A 0–1 fraction as a percentage. `—` when nothing was measurable. */
  protected percent(fraction: number | null | undefined): string {
    return fraction === null || fraction === undefined ? '—' : `${Math.round(fraction * 100)}%`;
  }

  // ── Reward goal rendering ─────────────────────────────────────────────────

  protected goalValue(row: RewardProgress): string {
    return isPercentageMetric(row.goal.metric)
      ? `${row.value}% / ${row.goal.target}%`
      : `${row.value} / ${row.goal.target}`;
  }

  protected goalLabel(row: RewardProgress): string {
    return row.goal.period;
  }

  /** Clamped: overshooting a target must not draw a bar past the end of its track. */
  protected goalPercent(row: RewardProgress): number {
    if (row.goal.target <= 0) return 0;
    return Math.min(100, Math.round((row.value / row.goal.target) * 100));
  }

  protected awardTitle(periodKey: string, value: number, target: number): string {
    return `${periodKey} · ${value} / ${target}`;
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

  protected tierFrame(tier: string): string {
    switch (tier) {
      case 'gold':
        return 'border-warning/50 bg-warning/10';
      case 'silver':
        return 'border-border bg-muted';
      default:
        return 'border-primary/40 bg-primary/5';
    }
  }

  protected tierSeries(tier: string): 1 | 2 | 3 | 4 | 5 {
    switch (tier) {
      case 'gold':
        return 3;
      case 'silver':
        return 5;
      default:
        return 1;
    }
  }
}
