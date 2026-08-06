import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Charts, without a charting library.
 *
 * These three primitives cover every chart in the design and add zero bytes of
 * dependency. Reach for a real library only when a genuinely new chart type is
 * needed — and price the bundle first.
 *
 * Colours come from `--chart-1..5` so a series keeps its slot across screens and
 * flips correctly in dark mode.
 */

export interface Segment {
  readonly key: string;
  /** Translation key — resolved where it renders. */
  readonly labelKey: string;
  readonly value: number;
  /** 1–5, indexing the chart series ramp. */
  readonly series: 1 | 2 | 3 | 4 | 5;
}

/**
 * Donut built from stroked circles.
 *
 * The trick: a circle of radius 15.9155 has a circumference of ~100, so
 * `stroke-dasharray="42 100"` is literally "42 percent" — no arc maths, no
 * path generation, and it stays exact at any size.
 */
@Component({
  selector: 'tk-donut',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  host: { class: 'flex items-center gap-6' },
  template: `
    <div class="relative shrink-0" [style.width.px]="size()" [style.height.px]="size()">
      <svg viewBox="0 0 36 36" class="-rotate-90" [attr.width]="size()" [attr.height]="size()">
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          stroke-width="4"
          class="text-muted"
          stroke="currentColor"
        />
        @for (arc of arcs(); track arc.key) {
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke-width="4"
            stroke-linecap="round"
            [attr.stroke]="'rgb(var(--chart-' + arc.series + '))'"
            [attr.stroke-dasharray]="arc.percent + ' 100'"
            [attr.stroke-dashoffset]="-arc.offset"
          />
        }
      </svg>
      <div class="absolute inset-0 grid place-items-center text-center">
        <div>
          <p class="font-display text-page font-extrabold">{{ total() }}</p>
          <p class="text-meta text-muted-foreground">{{ centerLabel() }}</p>
        </div>
      </div>
    </div>

    <ul class="min-w-0 flex-1 space-y-2.5 text-body">
      @for (segment of segments(); track segment.key) {
        <li class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="size-2.5 shrink-0 rounded-full"
              [style.background]="'rgb(var(--chart-' + segment.series + '))'"
            ></span>
            <span class="truncate">{{ segment.labelKey | transloco }}</span>
          </span>
          <b class="shrink-0">{{ segment.value }}</b>
        </li>
      }
    </ul>
  `,
})
export class Donut {
  readonly segments = input.required<readonly Segment[]>();
  readonly size = input(144);
  readonly centerLabel = input('');

  protected readonly total = computed(() =>
    this.segments().reduce((sum, s) => sum + s.value, 0),
  );

  /** Percent + cumulative offset per arc; a zero total renders an empty ring. */
  protected readonly arcs = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    let offset = 0;
    return this.segments()
      .filter((s) => s.value > 0)
      .map((s) => {
        const percent = (s.value / total) * 100;
        const arc = { key: s.key, series: s.series, percent, offset };
        offset += percent;
        return arc;
      });
  });
}

export interface BarGroup {
  /** Axis label. Caller-supplied; pass an already-translated string. */
  readonly label: string;
  readonly values: readonly number[];
}

/**
 * Grouped bars — flexbox, not SVG, so the bars inherit token colours and resize
 * with the container for free.
 *
 * The legend belongs in the enclosing card's header slot, never underneath the
 * chart: a legend below competes with the axis labels for the same scan line.
 */
@Component({
  selector: 'tk-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-stretch gap-3' },
  template: `
    @for (group of data(); track group.label) {
      <div class="flex flex-1 flex-col items-center gap-2">
        <div class="flex w-full min-h-0 flex-1 items-end justify-center gap-1">
          @for (value of group.values; track $index) {
            <div
              class="w-1/2 rounded-t transition-[height] duration-[var(--motion-slow)]"
              [style.height.%]="height(value)"
              [style.background]="'rgb(var(--chart-' + ($index + 1) + '))'"
              [attr.title]="value + ' ' + (seriesNames()[$index] ?? '')"
            ></div>
          }
        </div>
        <span class="text-meta text-muted-foreground">{{ group.label }}</span>
      </div>
    }
  `,
})
export class Bars {
  readonly data = input.required<readonly BarGroup[]>();
  readonly seriesNames = input<readonly string[]>([]);

  private readonly max = computed(() => {
    const values = this.data().flatMap((g) => g.values);
    return values.length ? Math.max(...values) : 0;
  });

  protected height(value: number): number {
    const max = this.max();
    // A 2% floor keeps a zero bar visible as a baseline tick rather than
    // vanishing, which otherwise reads as missing data.
    return max <= 0 ? 2 : Math.max(2, (value / max) * 100);
  }
}

/**
 * Labelled progress row — priority mixes, department performance, agent load.
 * Repeat inside a `<div class="space-y-4">`.
 */
@Component({
  selector: 'tk-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-1.5 flex items-center justify-between text-body">
      <span class="flex min-w-0 items-center gap-2">
        <span
          class="size-2 shrink-0 rounded-full"
          [style.background]="'rgb(var(--chart-' + series() + '))'"
        ></span>
        <span class="truncate">{{ label() }}</span>
      </span>
      <b class="shrink-0">{{ value() }}</b>
    </div>
    <div class="progress">
      <span
        [style.width.%]="percent()"
        [style.background]="'rgb(var(--chart-' + series() + '))'"
      ></span>
    </div>
  `,
})
export class Meter {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly percent = input.required<number>();
  readonly series = input<1 | 2 | 3 | 4 | 5>(1);
}
