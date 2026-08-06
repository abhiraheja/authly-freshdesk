import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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
 * Routes supply `titleKey` (a translation key). `from` is a source path —
 * developer text, not UI copy, so it stays literal and travels as a parameter.
 *
 * Delete each usage as its screen lands; when nothing imports this file, the
 * migration is done.
 */
@Component({
  selector: 'tk-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, EmptyState, TranslocoPipe],
  template: `
    <tk-page-header [title]="titleKey() | transloco" />
    <tk-empty-state
      icon="rocket"
      [heading]="'comingSoon.heading' | transloco"
      [description]="description()"
    />
  `,
})
export class ComingSoon {
  private readonly transloco = inject(TranslocoService);
  private readonly data = toSignal(inject(ActivatedRoute).data, {
    initialValue: {} as Record<string, unknown>,
  });
  /** Re-resolve the description when the active language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly titleKey = computed(
    () => (this.data()['titleKey'] as string) ?? 'common.appName',
  );

  /** Two whole-sentence keys rather than one glued together from fragments. */
  protected readonly description = computed(() => {
    this.lang();
    const from = this.data()['from'] as string | undefined;
    return from
      ? this.transloco.translate('comingSoon.bodyFrom', { from })
      : this.transloco.translate('comingSoon.body');
  });
}
