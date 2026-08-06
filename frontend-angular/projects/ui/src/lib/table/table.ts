import { ChangeDetectionStrategy, Component, Directive, booleanAttribute, computed, input, model } from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * Styles a native `<table>`. Native markup on purpose — semantics, `scope`,
 * screen-reader table navigation and text selection all keep working, which a
 * div-grid throws away.
 *
 * The table must live inside a horizontally scrollable wrapper, and carry its
 * own `min-width`, so a wide table scrolls **inside its card** instead of making
 * the whole page scroll sideways:
 *
 * ```html
 * <tk-card flush>
 *   <div class="overflow-x-auto">
 *     <table tkTable hover class="min-w-[980px]"> … </table>
 *   </div>
 *   <tk-pagination [(page)]="page" [total]="total()" [pageSize]="20" card-footer />
 * </tk-card>
 * ```
 */
@Directive({
  selector: 'table[tkTable]',
  host: { '[class]': 'classes()' },
})
export class TableDirective {
  /** Row hover tint. Set it when rows are clickable, leave it off when they aren't. */
  readonly hover = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() =>
    ['table', this.hover() ? 'table-hover' : ''].filter(Boolean).join(' '),
  );
}

/**
 * Windowed pager.
 *
 * Keep `page` in the URL rather than component state — that makes a filtered,
 * paged view shareable, makes browser Back behave, and gives the data resource a
 * correct cache key for free.
 */
@Component({
  selector: 'tk-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-body',
  },
  template: `
    <p class="text-muted-foreground">
      Showing <b class="text-foreground">{{ from() }}–{{ to() }}</b> of {{ total() }}
    </p>

    <nav class="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        class="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label="Previous page"
        [disabled]="page() <= 1"
        (click)="go(page() - 1)"
      >
        <tk-icon name="chevron-left" [size]="16" />
      </button>

      @for (item of items(); track $index) {
        @if (item === null) {
          <span class="px-1 text-muted-foreground" aria-hidden="true">…</span>
        } @else {
          <button
            type="button"
            [class]="
              'grid size-9 place-items-center rounded-lg font-semibold ' +
              (item === page()
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent')
            "
            [attr.aria-current]="item === page() ? 'page' : null"
            (click)="go(item)"
          >
            {{ item }}
          </button>
        }
      }

      <button
        type="button"
        class="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label="Next page"
        [disabled]="page() >= pageCount()"
        (click)="go(page() + 1)"
      >
        <tk-icon name="chevron-right" [size]="16" />
      </button>
    </nav>
  `,
})
export class Pagination {
  readonly page = model(1);
  readonly total = input.required<number>();
  readonly pageSize = input(20);

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );

  protected readonly from = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );

  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));

  /** First, last, and a window around the current page; `null` renders an ellipsis. */
  protected readonly items = computed<(number | null)[]>(() => {
    const count = this.pageCount();
    const current = this.page();
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

    const pages = new Set<number>([1, count, current, current - 1, current + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);

    const result: (number | null)[] = [];
    let previous = 0;
    for (const page of sorted) {
      if (previous && page - previous > 1) result.push(null);
      result.push(page);
      previous = page;
    }
    return result;
  });

  protected go(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.pageCount());
    if (clamped !== this.page()) this.page.set(clamped);
  }
}
