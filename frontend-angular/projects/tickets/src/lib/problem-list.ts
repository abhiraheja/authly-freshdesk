import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  PROBLEM_TONE,
  TicketsApi,
  errorMessage,
  fromQueryOr,
  timeAgo,
  toneFor,
  type ProblemSummary,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Icon,
  InputDirective,
  LabelDirective,
  PageHeader,
  SkeletonDirective,
  TableDirective,
  Tabs,
  ToastService,
  type TabItem,
} from '@trackly/ui';

/** Everything that is not finished. The tab default, because it is the work. */
const LIVE = ['investigating', 'identified', 'monitoring'];

/**
 * Problems — the root causes tickets get grouped under.
 *
 * A problem is what turns "nine people reported the same outage" from nine
 * separate conversations into one piece of work with nine people waiting on it.
 * Customers never see the grouping: they only ever see their own ticket, which is
 * why this screen is agent-only in the API and not just hidden from the rail.
 *
 * Creating is a drawer over the list — a new problem is usually raised *while*
 * looking at the ones that already exist, to check it is not one of them.
 */
@Component({
  selector: 'tk-problem-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    Drawer,
    EmptyState,
    Icon,
    InputDirective,
    LabelDirective,
    PageHeader,
    SkeletonDirective,
    TableDirective,
    Tabs,
  ],
  template: `
    <tk-page-header [title]="'problems.title' | transloco" [subtitle]="'problems.subtitle' | transloco">
      <button tkButton page-actions (click)="startCreate()">
        <tk-icon name="plus" [size]="16" />
        {{ 'problems.add' | transloco }}
      </button>
    </tk-page-header>

    <tk-tabs class="mb-4" [tabs]="tabs()" [active]="view()" (activeChange)="setView($event)" panelId="problem-list" />

    <div id="problem-list" role="region" [attr.aria-label]="'problems.title' | transloco">
      @if (problems.value()) {
        <tk-card flush>
          <div class="overflow-x-auto">
            <table tkTable hover class="min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">{{ 'problems.columns.problem' | transloco }}</th>
                  <th scope="col" class="w-[9rem]">{{ 'problems.columns.status' | transloco }}</th>
                  <th scope="col" class="w-[8rem]">{{ 'problems.columns.tickets' | transloco }}</th>
                  <th scope="col" class="w-[13rem]">{{ 'problems.columns.owner' | transloco }}</th>
                  <th scope="col" class="w-[8rem]">{{ 'problems.columns.updated' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (problem of rows(); track problem.id) {
                  <tr>
                    <td class="max-w-0">
                      <!-- The link is in the first cell rather than on the row, so
                           there is a keyboard path to the problem without giving
                           every cell a click handler. -->
                      <a
                        class="block truncate font-semibold hover:text-primary"
                        [routerLink]="['/dashboard/problems', problem.id]"
                      >
                        {{ problem.title }}
                      </a>
                    </td>
                    <td>
                      @let tone = statusTone(problem);
                      <tk-badge [tone]="tone.tone" dot>{{ tone.labelKey | transloco }}</tk-badge>
                    </td>
                    <td>
                      <span class="inline-flex items-center gap-1.5 text-body">
                        <tk-icon name="ticket" [size]="14" class="text-muted-foreground" />
                        {{ problem.ticketCount }}
                      </span>
                    </td>
                    <td>
                      @if (problem.assignee; as owner) {
                        <span class="flex items-center gap-1.5">
                          <tk-avatar [name]="owner.name || owner.email" [imageUrl]="owner.avatarUrl" [size]="22" round />
                          <span class="truncate text-body">{{ owner.name || owner.email }}</span>
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">{{ 'tickets.unassigned' | transloco }}</span>
                      }
                    </td>
                    <td class="text-meta text-muted-foreground">{{ age(problem) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="p-0">
                      <tk-empty-state
                        icon="puzzle"
                        [heading]="(filtered() ? 'problems.emptyTab' : 'problems.empty') | transloco"
                        [description]="(filtered() ? 'problems.emptyTabBody' : 'problems.emptyBody') | transloco"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </tk-card>
      } @else if (problems.error()) {
        <tk-alert tone="danger" [heading]="'problems.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="problems.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <tk-card flush>
          <div class="space-y-3 p-4">
            @for (row of skeletonRows; track row) {
              <span tkSkeleton class="block h-8 w-full"></span>
            }
          </div>
        </tk-card>
      }
    </div>

    <tk-drawer [(open)]="createOpen" [heading]="'problems.newHeading' | transloco">
      <div class="space-y-4">
        <div>
          <label tkLabel for="problem-title">{{ 'problems.form.title' | transloco }}</label>
          <input
            tkInput
            id="problem-title"
            name="problem-title"
            maxlength="200"
            [placeholder]="'problems.form.titlePlaceholder' | transloco"
            [(ngModel)]="draftTitle"
          />
        </div>

        <div>
          <label tkLabel for="problem-description">{{ 'problems.form.description' | transloco }}</label>
          <textarea
            tkInput
            id="problem-description"
            name="problem-description"
            rows="5"
            [placeholder]="'problems.form.descriptionPlaceholder' | transloco"
            [(ngModel)]="draftDescription"
          ></textarea>
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'problems.form.linkHint' | transloco }}</p>
        </div>

        @if (createError(); as message) {
          <tk-alert tone="danger" [heading]="'problems.createFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>

      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="createOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canCreate()" (click)="create()">{{ 'problems.create' | transloco }}</button>
      </div>
    </tk-drawer>
  `,
})
export class ProblemList {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  readonly view = input('open', { transform: fromQueryOr('open') });

  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly problems = resource({ loader: () => this.api.problems() });

  private readonly all = computed(() => this.problems.value() ?? []);
  private readonly live = computed(() => this.all().filter((p) => LIVE.includes(p.status)));
  private readonly closed = computed(() => this.all().filter((p) => !LIVE.includes(p.status)));

  protected readonly rows = computed(() => {
    switch (this.view()) {
      case 'resolved':
        return this.closed();
      case 'all':
        return this.all();
      default:
        return this.live();
    }
  });

  /** Whether an empty table means "none at all" or "none in this tab". */
  protected readonly filtered = computed(() => this.view() !== 'all' && this.all().length > 0);

  protected readonly loadError = computed(() => errorMessage(this.problems.error()));

  protected readonly tabs = computed<readonly TabItem[]>(() => {
    this.lang();
    return [
      { id: 'open', label: this.transloco.translate('problems.tabs.open'), count: this.live().length },
      { id: 'resolved', label: this.transloco.translate('problems.tabs.resolved'), count: this.closed().length },
      { id: 'all', label: this.transloco.translate('problems.tabs.all'), count: this.all().length },
    ];
  });

  protected readonly createOpen = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftDescription = signal('');
  protected readonly createError = signal<string | null>(null);
  private readonly creating = signal(false);

  protected readonly canCreate = computed(() => !this.creating() && this.draftTitle().trim().length > 0);

  protected statusTone(problem: ProblemSummary) {
    return toneFor(PROBLEM_TONE, problem.status);
  }

  protected age(problem: ProblemSummary): string {
    return timeAgo(problem.updatedAt);
  }

  protected startCreate(): void {
    this.draftTitle.set('');
    this.draftDescription.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  /**
   * Creates, then opens it. A brand-new problem has no tickets under it, and
   * linking them is the next thing anybody does — so the list would be the wrong
   * place to leave them.
   */
  protected async create(): Promise<void> {
    if (!this.canCreate()) return;

    this.creating.set(true);
    this.createError.set(null);
    try {
      const problem = await this.api.createProblem({
        title: this.draftTitle().trim(),
        description: this.draftDescription().trim() || undefined,
      });
      this.createOpen.set(false);
      this.toast.success(this.transloco.translate('problems.created', { title: problem.title }));
      await this.router.navigate(['/dashboard/problems', problem.id]);
    } catch (error) {
      this.createError.set(errorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected setView(view: string): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'open' ? null : view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
