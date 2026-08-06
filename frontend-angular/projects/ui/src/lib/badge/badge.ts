import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import type { Tone } from '@trackly/core';

/**
 * A soft status pill — the one way a coloured state is rendered.
 *
 * Never pick the tone by eye at the call site. Look the state up in the tone map
 * so it reads identically in the table, the detail rail, the portal and the
 * dashboard:
 *
 * ```html
 * @let s = statusTone(ticket.status);
 * <tk-badge [tone]="s.tone" dot>{{ s.label }}</tk-badge>
 * ```
 *
 * Both the tint and its foreground come from tokens that flip with the colour
 * scheme, so a badge stays legible in dark mode without any per-call override.
 */
@Component({
  selector: 'tk-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: `
    @if (dot()) {
      <span class="dot"></span>
    }
    <ng-content />
  `,
})
export class Badge {
  readonly tone = input<Tone>('neutral');
  /** Adds a leading dot, so the state is distinguishable without relying on colour. */
  readonly dot = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => `badge badge-${this.tone()}`);
}
