import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UNASSIGNED_FACET, type FacetBucket, type TicketFacets } from '@trackly/core';
import { Checkbox, SkeletonDirective } from '@trackly/ui';

/** One collapsible group in the rail. */
interface Group {
  readonly key: FacetKey;
  readonly labelKey: string;
  readonly buckets: readonly FacetBucket[];
  readonly selected: readonly string[];
  /** Status values are Trackly's own four, so their labels are i18n keys. */
  readonly translate: boolean;
}

export type FacetKey = 'status' | 'priority' | 'channel' | 'team' | 'category' | 'assignee' | 'tag';

export interface FacetToggle {
  readonly key: FacetKey;
  readonly value: string;
}

/** How many buckets a group shows before "show all". */
const COLLAPSED_ROWS = 6;

/**
 * The filter rail: every value a ticket in the current result set actually
 * carries, with a count, as a checkbox.
 *
 * **Counts are computed excluding each group's own filter** (server-side). That
 * is what separates a facet from a filter list: with its own filter applied,
 * picking "Open" would leave every other status reading zero, so there would be
 * no way to see what else exists or to widen the selection. Filters narrow;
 * facets show you the shape of what you are narrowing.
 *
 * A value with a count of zero is simply not returned — the rail only ever
 * offers a click that leads somewhere, except for values already selected,
 * which stay so they can be turned off again.
 */
@Component({
  selector: 'tk-ticket-facets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [TranslocoPipe, Checkbox, SkeletonDirective],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-meta font-bold uppercase tracking-wide text-muted-foreground">
          {{ 'tickets.filters.heading' | transloco }}
        </h2>
        @if (anySelected()) {
          <button type="button" class="text-meta font-semibold text-primary hover:underline" (click)="clear.emit()">
            {{ 'tickets.clear' | transloco }}
          </button>
        }
      </div>

      @if (loading() && !facets()) {
        <div class="space-y-3">
          @for (row of skeletons; track row) {
            <span tkSkeleton class="h-4 w-full"></span>
          }
        </div>
      } @else {
        @for (group of groups(); track group.key) {
          @if (group.buckets.length) {
            <section>
              <h3 class="mb-1.5 text-meta font-bold text-foreground">{{ group.labelKey | transloco }}</h3>
              <ul class="space-y-0.5">
                @for (bucket of shown(group); track bucket.value) {
                  <li class="facet-row">
                    <tk-checkbox
                      class="min-w-0 flex-1"
                      [checked]="group.selected.includes(bucket.value)"
                      (checkedChange)="toggled.emit({ key: group.key, value: bucket.value })"
                    >
                      <span class="block truncate">
                        {{ group.translate ? (bucket.label | transloco) : bucket.label }}
                      </span>
                    </tk-checkbox>
                    <span class="facet-count">{{ bucket.count }}</span>
                  </li>
                }
              </ul>
              @if (group.buckets.length > collapsedRows) {
                <button
                  type="button"
                  class="mt-1 pl-6 text-meta font-semibold text-primary hover:underline"
                  (click)="toggleExpanded(group.key)"
                >
                  {{
                    (expanded().has(group.key) ? 'tickets.filters.showLess' : 'tickets.filters.showAll')
                      | transloco: { count: group.buckets.length }
                  }}
                </button>
              }
            </section>
          }
        } @empty {
          <p class="text-meta text-muted-foreground">{{ 'tickets.filters.none' | transloco }}</p>
        }
      }
    </div>
  `,
})
export class TicketFacetsRail {
  readonly facets = input<TicketFacets | undefined>(undefined);
  readonly loading = input(false);
  /** What is ticked, per group. Owned by the page (it lives in the URL). */
  readonly selected = input<Readonly<Partial<Record<FacetKey, readonly string[]>>>>({});

  readonly toggled = output<FacetToggle>();
  readonly clear = output<void>();

  protected readonly collapsedRows = COLLAPSED_ROWS;
  protected readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  private readonly expandedKeys = signal<ReadonlySet<FacetKey>>(new Set());
  protected readonly expanded = this.expandedKeys.asReadonly();

  protected readonly groups = computed<readonly Group[]>(() => {
    const f = this.facets();
    if (!f) return [];
    const pick = (key: FacetKey) => this.selected()[key] ?? [];
    return [
      // Status first because it is what nine filters out of ten start with.
      { key: 'status', labelKey: 'tickets.columns.status', buckets: f.status, selected: pick('status'), translate: true },
      { key: 'priority', labelKey: 'tickets.columns.priority', buckets: f.priority, selected: pick('priority'), translate: false },
      { key: 'assignee', labelKey: 'tickets.columns.assignee', buckets: f.assignee, selected: pick('assignee'), translate: false },
      { key: 'team', labelKey: 'tickets.new.department', buckets: f.team, selected: pick('team'), translate: false },
      { key: 'category', labelKey: 'tickets.new.category', buckets: f.category, selected: pick('category'), translate: false },
      { key: 'channel', labelKey: 'tickets.detail.channel', buckets: f.channel, selected: pick('channel'), translate: false },
      { key: 'tag', labelKey: 'tickets.new.tags', buckets: f.tag, selected: pick('tag'), translate: false },
    ];
  });

  protected readonly anySelected = computed(() =>
    Object.values(this.selected()).some((values) => (values?.length ?? 0) > 0),
  );

  /**
   * The first few, unless expanded — but always including everything currently
   * ticked. A selected value scrolled out of sight behind "show all" is a filter
   * the user cannot find to turn off.
   */
  protected shown(group: Group): readonly FacetBucket[] {
    if (this.expandedKeys().has(group.key) || group.buckets.length <= COLLAPSED_ROWS) {
      return group.buckets;
    }
    const head = group.buckets.slice(0, COLLAPSED_ROWS);
    const hiddenSelected = group.buckets
      .slice(COLLAPSED_ROWS)
      .filter((bucket) => group.selected.includes(bucket.value));
    return [...head, ...hiddenSelected];
  }

  protected toggleExpanded(key: FacetKey): void {
    this.expandedKeys.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
}

/** Re-exported so the page can special-case the "nobody" bucket. */
export { UNASSIGNED_FACET };
