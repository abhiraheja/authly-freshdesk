import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore, TicketsApi, errorMessage } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  Donut,
  Icon,
  PageHeader,
  StatCard,
  type Segment,
} from '@trackly/ui';

/**
 * Agent dashboard — the "Overview" page shape: KPI row → chart row → panel row.
 *
 * Everything here is derived from `/api/dashboard/stats`. The KPIs the reference
 * design also shows — resolved-today, average resolution, CSAT, and the
 * period-over-period deltas — are deliberately absent: those fields do not exist
 * on the endpoint yet, and rendering them from invented numbers would make the
 * screen lie. They land with the API change, not before.
 */
@Component({
  selector: 'tk-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Alert, Button, Card, Donut, Icon, PageHeader, StatCard],
  template: `
    <tk-page-header [title]="greeting()" subtitle="Here's what's happening across your support desk today.">
      <a tkButton page-actions routerLink="/dashboard/tickets">
        <tk-icon name="ticket" [size]="16" />
        Open ticket workspace
      </a>
    </tk-page-header>

    @if (stats.error()) {
      <tk-alert tone="danger" heading="Couldn't load your dashboard">
        {{ errorText() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="stats.reload()">
          Try again
        </button>
      </tk-alert>
    }

    <div class="space-y-6">
      <!-- KPI row -->
      <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <tk-stat-card
          label="Total tickets"
          icon="ticket"
          tone="primary"
          [value]="value('total')"
          clickable
          routerLink="/dashboard/tickets"
        />
        <tk-stat-card label="Open" icon="folder-open" tone="info" [value]="value('open')" />
        <tk-stat-card label="Pending" icon="clock" tone="warning" [value]="value('pending')" />
        <tk-stat-card
          label="Unassigned"
          icon="user-x"
          [tone]="(value('unassigned') ?? 0) > 0 ? 'danger' : 'success'"
          [value]="value('unassigned')"
        />
        <tk-stat-card
          label="Open problems"
          icon="puzzle"
          [tone]="(value('openProblems') ?? 0) > 0 ? 'warning' : 'success'"
          [value]="value('openProblems')"
        />
      </div>

      <!-- Breakdown + queue -->
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <tk-card class="xl:col-span-2" heading="Status breakdown" subheading="Every ticket in this workspace">
          @if (stats.isLoading()) {
            <div class="h-36 w-full rounded-xl bg-muted"></div>
          } @else if (hasTickets()) {
            <tk-donut [segments]="segments()" />
          } @else {
            <p class="py-10 text-center text-body text-muted-foreground">
              No tickets yet — this fills in as they arrive.
            </p>
          }
        </tk-card>

        <tk-card heading="Your queue">
          <ul class="space-y-3.5">
            @for (row of queue(); track row.label) {
              <li class="flex items-center justify-between">
                <span class="text-body text-muted-foreground">{{ row.label }}</span>
                <b class="font-display text-section font-extrabold">{{ row.value }}</b>
              </li>
            }
          </ul>
          <a tkButton variant="secondary" routerLink="/dashboard/tickets" class="mt-5 w-full">
            View all tickets
          </a>
        </tk-card>
      </div>
    </div>
  `,
})
export class Dashboard {
  private readonly api = inject(TicketsApi);
  private readonly session = inject(SessionStore);

  protected readonly stats = resource({ loader: () => this.api.stats() });

  protected readonly greeting = computed(() => {
    const name = this.session.user()?.name?.split(' ')[0];
    return name ? `Welcome back, ${name}` : 'Welcome back';
  });

  protected readonly errorText = computed(() => errorMessage(this.stats.error()));

  protected value(key: keyof NonNullable<ReturnType<typeof this.stats.value>>): number | undefined {
    return this.stats.value()?.[key];
  }

  protected readonly hasTickets = computed(() => (this.stats.value()?.total ?? 0) > 0);

  protected readonly segments = computed<Segment[]>(() => {
    const stats = this.stats.value();
    if (!stats) return [];
    return [
      { key: 'open', label: 'Open', value: stats.open, series: 4 },
      { key: 'pending', label: 'Pending', value: stats.pending, series: 3 },
      { key: 'resolved', label: 'Resolved', value: stats.resolved, series: 2 },
      { key: 'closed', label: 'Closed', value: stats.closed, series: 5 },
    ];
  });

  protected readonly queue = computed(() => {
    const stats = this.stats.value();
    return [
      { label: 'Assigned to you', value: stats?.assignedToMe ?? '—' },
      { label: 'Unassigned', value: stats?.unassigned ?? '—' },
      { label: 'Waiting on a reply', value: stats?.pending ?? '—' },
    ];
  });
}
