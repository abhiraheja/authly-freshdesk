import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { EmptyState } from '../feedback/feedback';
import { PageHeader } from '../page-header/page-header';

/**
 * Placeholder for a screen still being migrated from the React app.
 *
 * It exists so every sidebar link and route resolves to something real during
 * the migration — a dead link reads as a bug, while this reads as a queue. It
 * names the React file to port, so the remaining work is visible in the product
 * rather than only in a tracker.
 *
 * Delete each usage as its screen lands; when `app.routes.ts` no longer
 * references this file, the migration is done.
 */
@Component({
  selector: 'tk-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, EmptyState],
  template: `
    <tk-page-header [title]="title()" />
    <tk-empty-state
      icon="rocket"
      heading="Not migrated yet"
      [description]="description()"
    />
  `,
})
export class ComingSoon {
  private readonly data = toSignal(inject(ActivatedRoute).data, { initialValue: {} as Record<string, unknown> });

  protected readonly title = computed(() => (this.data()['title'] as string) ?? 'Trackly');

  protected readonly description = computed(() => {
    const from = this.data()['from'] as string | undefined;
    return from
      ? `This screen is being ported to Angular. The React implementation is at ${from}.`
      : 'This screen is being ported to Angular.';
  });
}
