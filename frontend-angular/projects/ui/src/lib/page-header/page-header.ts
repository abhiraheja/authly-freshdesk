import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Every page starts with one of these — exactly one `<h1>` per page.
 *
 * The subtitle should carry live numbers where they exist ("248 total · 72 open
 * · 18 SLA at risk"), not restate the title. If there is nothing true and
 * specific to say, leave it out.
 *
 * ```html
 * <tk-page-header title="Tickets" [subtitle]="summary()">
 *   <button tkButton page-actions (click)="create()">New ticket</button>
 * </tk-page-header>
 * ```
 */
@Component({
  selector: 'tk-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between',
  },
  template: `
    <div class="min-w-0">
      <h1 class="font-display text-page font-extrabold">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="mt-1 text-body text-muted-foreground">{{ subtitle() }}</p>
      }
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ng-content select="[page-actions]" />
    </div>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
