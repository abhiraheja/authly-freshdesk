import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { STATUS_TONE, toneFor, type LinkedTicket, type TicketRelationSummary } from '@trackly/core';
import { Badge, Icon } from '@trackly/ui';

/**
 * "This ticket is not on its own" — said at the top of the ticket, before the
 * agent starts typing.
 *
 * The whole point is timing. All of this was already reachable from the Related
 * tab, and being reachable was not enough: an agent opens a ticket, reads the
 * customer's message and starts working, and never learns that two other people
 * reported the same thing or that the fix is waiting on somebody else's ticket.
 * By the time they click Related they have already done the work twice.
 *
 * **Three different statements, ranked by what they cost to miss.**
 * <ul>
 *   <li><b>Blocked by</b> is a stop sign: the work cannot finish, so it leads and
 *       it is the only part that gets a warning tone.</li>
 *   <li><b>Duplicates</b> is a saving: somebody else's ticket is the same issue,
 *       and resolving one can resolve both.</li>
 *   <li><b>Blocking</b> is a responsibility: other people are waiting on this.</li>
 * </ul>
 *
 * Renders nothing at all when there are no links, which is most tickets. A banner
 * that is always there is furniture, and furniture is not read.
 *
 * Agent-facing: the API sends `relations` as null to every non-agent caller, so
 * this cannot appear on a customer surface even if one imported it (invariant 5).
 */
@Component({
  selector: 'tk-ticket-relation-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink, TranslocoPipe, Badge, Icon],
  template: `
    @if (summary(); as data) {
      @if (data.total) {
        <!-- Warning tone only when something is actually stuck. A ticket with
             three harmless "relates" links is information, not a problem, and
             painting it amber would teach agents to ignore the colour. -->
        <div class="rounded-xl border p-3" [class]="frameClass()">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <tk-icon [name]="headlineIcon()" [size]="15" class="shrink-0" [class]="accentClass()" />
            <span class="text-body font-semibold">{{ headline() | transloco: headlineArgs() }}</span>

            <!-- The way through to the detail. The banner says what is true; the
                 tab is where it is changed. -->
            <button
              type="button"
              class="ml-auto shrink-0 text-meta font-semibold text-primary hover:underline"
              (click)="openRelated.emit()"
            >
              {{ 'tickets.relations.banner.view' | transloco }}
            </button>
          </div>

          @if (data.blockers.length) {
            <div class="mt-2">
              <p class="mb-1 text-meta font-semibold text-warning-ink">
                {{ 'tickets.relations.banner.blockedBy' | transloco }}
              </p>
              <ul class="space-y-1">
                @for (blocker of data.blockers; track blocker.id) {
                  <li>
                    <a
                      class="flex flex-wrap items-center gap-2 text-meta hover:underline"
                      [routerLink]="['/dashboard/tickets', blocker.id]"
                    >
                      <span class="font-mono text-muted-foreground">#{{ number(blocker.id) }}</span>
                      <span class="min-w-0 max-w-[24rem] truncate font-semibold">{{ blocker.subject }}</span>
                      <tk-badge [tone]="statusTone(blocker).tone" dot>{{ blocker.statusName }}</tk-badge>
                      @if (blocker.assignee; as who) {
                        <span class="text-muted-foreground">{{ who.name || who.email }}</span>
                      } @else {
                        <span class="text-muted-foreground">{{ 'tickets.unassigned' | transloco }}</span>
                      }
                    </a>
                  </li>
                }
              </ul>
            </div>
          }

          @if (data.blocking.length) {
            <p class="mt-2 text-meta text-muted-foreground">
              {{ 'tickets.relations.banner.blocking' | transloco: { count: data.blocking.length } }}
              @for (waiting of data.blocking; track waiting.id) {
                <a
                  class="ml-1 font-mono font-semibold text-primary hover:underline"
                  [routerLink]="['/dashboard/tickets', waiting.id]"
                >#{{ number(waiting.id) }}</a>
              }
            </p>
          }
        </div>
      }
    }
  `,
})
export class TicketRelationBanner {
  /** Null on a customer surface, and on a ticket with no links. */
  readonly summary = input<TicketRelationSummary | null>(null);

  /** Asks the parent to switch to the Related tab — it owns the tab state. */
  readonly openRelated = output<void>();

  protected number(id: string): string {
    return id.slice(0, 8);
  }

  protected statusTone(ticket: LinkedTicket) {
    return toneFor(STATUS_TONE, ticket.statusCategory);
  }

  private readonly blocked = computed(() => (this.summary()?.blockers.length ?? 0) > 0);

  /**
   * The one sentence, chosen by what matters most.
   *
   * Blocked wins over duplicates, and duplicates over a plain count: an agent gets
   * one line of attention here, and it should be spent on the thing that changes
   * what they do next.
   */
  protected readonly headline = computed(() => {
    const data = this.summary();
    if (!data) return '';
    if (this.blocked()) return 'tickets.relations.banner.headlineBlocked';
    if (data.duplicateCount > 0) return 'tickets.relations.banner.headlineDuplicates';
    return 'tickets.relations.banner.headlineLinked';
  });

  protected readonly headlineArgs = computed(() => {
    const data = this.summary();
    return {
      count: data?.total ?? 0,
      blockers: data?.blockers.length ?? 0,
      duplicates: data?.duplicateCount ?? 0,
    };
  });

  /** Static class strings only — see the note on EFFECT_CLASS in ticket-relations. */
  protected readonly frameClass = computed(() =>
    this.blocked() ? 'border-warning/50 bg-warning/10' : 'border-border bg-card',
  );

  protected readonly accentClass = computed(() =>
    this.blocked() ? 'text-warning-ink' : 'text-primary',
  );

  protected readonly headlineIcon = computed(() => (this.blocked() ? 'octagon-alert' : 'link'));
}
