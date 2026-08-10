import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WidgetAdminApi, errorMessage, timeAgo, type WidgetSummary } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  SkeletonDirective,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Widget. Every embeddable widget the workspace runs
 * (docs/widget-plan.md § 8.2).
 *
 * A workspace runs as many widgets as it has surfaces to embed one on — the
 * marketing site and the signed-in app usually want different greetings, and a
 * staging site wants its own token so it can be revoked without touching
 * production. So this is a list, not a settings page.
 *
 * **Last used is derived**, from the visitor rows rather than a stored column,
 * which is what makes "never used" trustworthy: a widget nobody has embedded
 * says so instead of showing the date somebody last opened this screen.
 */
@Component({
  selector: 'tk-admin-widget-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    SkeletonDirective,
    TableDirective,
  ],
  template: `
    <div class="mx-auto max-w-[1100px]">
      <tk-page-header
        [title]="'admin.widget.title' | transloco"
        [subtitle]="'admin.widget.subtitle' | transloco"
      >
        <button page-actions tkButton [disabled]="creating()" (click)="create()">
          <tk-icon name="plus" [size]="18" />
          {{ 'admin.widget.new' | transloco }}
        </button>
      </tk-page-header>

      @if (widgets.hasValue()) {
        @if (rows().length) {
          <tk-card flush>
            <div class="overflow-x-auto">
              <table tkTable hover class="min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.widget.columns.name' | transloco }}</th>
                    <th scope="col">{{ 'admin.widget.columns.token' | transloco }}</th>
                    <th scope="col">{{ 'admin.widget.columns.status' | transloco }}</th>
                    <th scope="col">{{ 'admin.widget.columns.lastUsed' | transloco }}</th>
                    <th scope="col"><span class="sr-only">{{ 'common.edit' | transloco }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (widget of rows(); track widget.id) {
                    <tr>
                      <td>
                        <a
                          class="font-semibold text-foreground hover:text-primary"
                          [routerLink]="['/admin/widget', widget.id]"
                        >
                          {{ widget.name }}
                        </a>
                        @if (widget.tagline) {
                          <p class="text-meta text-muted-foreground">{{ widget.tagline }}</p>
                        }
                      </td>
                      <td><code class="text-meta">{{ widget.publicToken }}</code></td>
                      <td>
                        <tk-badge [tone]="widget.isActive ? 'success' : 'neutral'" dot>
                          {{ (widget.isActive ? 'admin.widget.active' : 'admin.widget.inactive') | transloco }}
                        </tk-badge>
                      </td>
                      <td class="text-muted-foreground">
                        {{ widget.lastUsedAt ? ago(widget.lastUsedAt) : ('admin.widget.neverUsed' | transloco) }}
                      </td>
                      <td class="text-right">
                        <a tkButton variant="ghost" size="sm" [routerLink]="['/admin/widget', widget.id]">
                          {{ 'common.edit' | transloco }}
                        </a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </tk-card>
        } @else {
          <tk-card>
            <tk-empty-state
              icon="globe"
              [heading]="'admin.widget.emptyHeading' | transloco"
              [description]="'admin.widget.emptyBody' | transloco"
            />
          </tk-card>
        }
      } @else if (widgets.error()) {
        <tk-alert tone="danger" [heading]="'admin.widget.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="widgets.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-3">
          <span tkSkeleton class="block h-12 w-full"></span>
          <span tkSkeleton class="block h-12 w-full"></span>
          <span tkSkeleton class="block h-12 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminWidgetList {
  private readonly api = inject(WidgetAdminApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly widgets = resource({ loader: () => this.api.list() });

  // `hasValue()` rather than reading `value()` behind a truthiness check:
  // `value()` throws in the error state, which would blank the page instead of
  // reaching the error branch below it.
  protected readonly rows = computed<WidgetSummary[]>(() =>
    this.widgets.hasValue() ? this.widgets.value() : [],
  );
  protected readonly loadError = computed(() => errorMessage(this.widgets.error()));
  protected readonly creating = signal(false);

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  /**
   * Creates the widget and goes straight to it. The response carries the secret
   * key in plaintext for the only time it ever exists outside the database, so
   * the editor is where it has to be shown — a list row could not.
   */
  protected async create(): Promise<void> {
    this.creating.set(true);
    try {
      const created = await this.api.create({
        name: this.transloco.translate('admin.widget.defaultName'),
      });
      await this.router.navigate(['/admin/widget', created.widget.id], {
        state: { secretKey: created.secretKey },
      });
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }
}
