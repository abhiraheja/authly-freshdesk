import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { Badge } from '../badge/badge';
import { Icon, type IconName } from '../icon/icon';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Count shown as a chip — omit rather than passing 0, which reads as data. */
  readonly count?: number;
}

/**
 * A tab rail. Presentational only: it renders the buttons and owns the roving
 * focus, while the caller renders the panel with a `@switch` on the active id.
 *
 * Keeping the panel outside is what makes this usable with lazy content. If the
 * tabs projected their own panels, every panel's bindings would evaluate on
 * every change detection run whether or not it was the visible one.
 *
 * ```html
 * <tk-tabs [tabs]="tabs" [(active)]="tab" panelId="config-panel" />
 * <div id="config-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
 *   @switch (tab()) { @case ('a') { … } }
 * </div>
 * ```
 */
@Component({
  selector: 'tk-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  host: { class: 'block' },
  template: `
    <div class="tablist" role="tablist">
      <!-- Only the selected tab is in the tab order; the arrow keys move between
           them. A rail of ten tabs should cost one Tab press to skip, not ten. -->
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          class="tab"
          role="tab"
          [id]="'tab-' + tab.id"
          [attr.aria-selected]="tab.id === active()"
          [attr.aria-controls]="panelId()"
          [attr.tabindex]="tab.id === active() ? 0 : -1"
          (click)="active.set(tab.id)"
          (keydown)="onKeydown($event)"
        >
          @if (tab.icon) {
            <tk-icon [name]="tab.icon" [size]="16" />
          }
          {{ tab.label }}
          @if (tab.count !== undefined) {
            <tk-badge tone="neutral">{{ tab.count }}</tk-badge>
          }
        </button>
      }
    </div>
  `,
})
export class Tabs {
  readonly tabs = input<readonly TabItem[]>([]);
  readonly active = model('');
  /** id of the element this rail controls, for `aria-controls`. */
  readonly panelId = input<string>();

  protected onKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;

    const tabs = this.tabs();
    const current = tabs.findIndex((tab) => tab.id === this.active());
    if (current < 0) return;

    event.preventDefault();
    const next = tabs[(current + step + tabs.length) % tabs.length];
    this.active.set(next.id);

    // Focus has to follow selection, or the next arrow press comes from the old
    // button and the rail walks backwards.
    const target = event.target as HTMLElement;
    (target.parentElement?.querySelector(`#tab-${CSS.escape(next.id)}`) as HTMLElement | null)?.focus();
  }
}
