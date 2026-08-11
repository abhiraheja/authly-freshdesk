import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { RELEASE_TONE, ReleasesApi, formatDate, settled, toneFor, type ReleaseSummary } from '@trackly/core';
import { Badge, Icon } from '@trackly/ui';

/** Shipped states, in the order a reader cares about them. */
const DONE = new Set(['released', 'rolled_back', 'cancelled']);

/**
 * "This ticket's fix is going out in 2.14, on the 14th" — said on the ticket,
 * before anybody has to go and ask a developer.
 *
 * This is the line that makes linking a ticket to a release worth doing at all.
 * Without it, an agent answering *"when is my fix coming?"* has to find someone
 * who knows; with it, the answer is already on the screen they are typing into.
 *
 * Renders nothing for the overwhelming majority of tickets, which are not in any
 * release. A banner that is always there is furniture, and furniture is not read.
 *
 * Agent-facing: the endpoint is behind the AgentOrAdmin policy, so this cannot
 * leak a release schedule onto a customer surface even if one imported it.
 */
@Component({
  selector: 'tk-ticket-release-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink, TranslocoPipe, Badge, Icon],
  template: `
    @for (release of releases(); track release.id) {
      <div class="rounded-xl border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <tk-icon name="rocket" [size]="15" class="shrink-0 text-primary" />
          <span class="text-body">
            <!-- Past tense once it has gone out. "Shipping in 2.14" on a release
                 that went out last week is a sentence that reads as a promise
                 and is actually history. -->
            {{ (isDone(release) ? 'tickets.release.shipped' : 'tickets.release.shipping') | transloco }}
          </span>
          <a class="font-semibold text-primary hover:underline" [routerLink]="['/dashboard/releases', release.id]">
            {{ release.version }}
          </a>
          <tk-badge [tone]="tone(release.status).tone">{{ tone(release.status).labelKey | transloco }}</tk-badge>

          @if (when(release); as date) {
            <span class="text-meta text-muted-foreground">{{ date }}</span>
          }
        </div>
      </div>
    }
  `,
})
export class TicketReleaseBanner {
  readonly ticketId = input.required<string>();

  private readonly api = inject(ReleasesApi);

  private readonly data = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.forTicket(params.id),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedData = settled(() => this.data);

  /**
   * Live releases first, and only the newest finished one.
   *
   * A ticket that has been reopened across three releases has three rows of
   * history and one row that matters; showing all four buries the answer to the
   * only question being asked.
   */
  protected readonly releases = computed(() => {
    const all = this.loadedData() ?? [];
    const live = all.filter((release) => !DONE.has(release.status));
    return live.length ? live : all.slice(0, 1);
  });

  protected isDone(release: ReleaseSummary): boolean {
    return DONE.has(release.status);
  }

  protected tone(status: string) {
    return toneFor(RELEASE_TONE, status);
  }

  /** The date that is true: when it went out, or when it is meant to. */
  protected when(release: ReleaseSummary): string | null {
    const iso = release.releasedAt ?? release.scheduledAt;
    return iso ? formatDate(iso) : null;
  }
}
