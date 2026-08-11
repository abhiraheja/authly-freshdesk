import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  RELEASE_TONE,
  ReleasesApi,
  SessionStore,
  errorMessage,
  formatDate,
  fromQueryOr,
  toneFor,
  type ReleaseSummary,
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

/**
 * The release board.
 *
 * Ordered by **what is going out next**, not by what changed last — the question
 * this screen answers is "when is the next deployment and is it ready", and a
 * recently-edited plan for next month is not the answer to it. Unscheduled
 * releases sort after the scheduled ones because they are still being written.
 *
 * Two numbers carry the row: how much of the plan is done, and how much of the
 * scope is tested. The second is the one that decides whether the release can go
 * at all, so it gets its own column rather than living inside the detail page.
 */
@Component({
  selector: 'tk-release-list',
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
    <tk-page-header [title]="'releases.title' | transloco" [subtitle]="'releases.subtitle' | transloco">
      <div page-actions class="flex items-center gap-2">
        @if (isAdmin()) {
          <button tkButton variant="outline" (click)="openSettings()">
            <tk-icon name="sliders-horizontal" [size]="16" />
            {{ 'releases.settings.open' | transloco }}
          </button>
        }
        <button tkButton (click)="startCreate()">
          <tk-icon name="plus" [size]="16" />
          {{ 'releases.add' | transloco }}
        </button>
      </div>
    </tk-page-header>

    <tk-tabs class="mb-4" [tabs]="tabs()" [active]="view()" (activeChange)="setView($event)" panelId="release-list" />

    <div id="release-list" role="region" [attr.aria-label]="'releases.title' | transloco">
      @if (releases.value()) {
        <tk-card flush>
          <div class="overflow-x-auto">
            <table tkTable class="min-w-[920px]">
              <thead>
                <tr>
                  <th scope="col">{{ 'releases.columns.release' | transloco }}</th>
                  <th scope="col" class="w-[10rem]">{{ 'releases.columns.scheduled' | transloco }}</th>
                  <th scope="col" class="w-[12rem]">{{ 'releases.columns.manager' | transloco }}</th>
                  <th scope="col" class="w-[9rem] col-right">{{ 'releases.columns.plan' | transloco }}</th>
                  <th scope="col" class="w-[9rem] col-right">{{ 'releases.columns.tested' | transloco }}</th>
                  <th scope="col" class="w-[9rem]">{{ 'releases.columns.status' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (release of rows(); track release.id) {
                  <tr>
                    <td class="max-w-0">
                      <a class="block truncate font-semibold hover:underline" [routerLink]="['/dashboard/releases', release.id]">
                        {{ release.version }}
                      </a>
                      @if (release.title) {
                        <span class="block truncate text-meta text-muted-foreground">{{ release.title }}</span>
                      }
                    </td>
                    <td>
                      @if (release.scheduledAt) {
                        {{ when(release.scheduledAt) }}
                      } @else {
                        <span class="text-meta text-muted-foreground">{{ 'releases.noDate' | transloco }}</span>
                      }
                    </td>
                    <td>
                      @if (release.releaseManager; as manager) {
                        <span class="flex items-center gap-2">
                          <tk-avatar [name]="manager.name || manager.email" [imageUrl]="manager.avatarUrl" [size]="22" round />
                          <span class="truncate">{{ manager.name || manager.email }}</span>
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">{{ 'releases.noManager' | transloco }}</span>
                      }
                    </td>
                    <td class="col-right font-mono text-body">{{ release.stepsDone }}/{{ release.stepCount }}</td>
                    <td class="col-right">
                      <span class="font-mono text-body">{{ release.workItemsTested }}/{{ release.workItemCount }}</span>
                      <!-- The one number that decides whether it can go out at
                           all, so it says so rather than making the reader
                           compare two figures in their head. -->
                      @if (untested(release); as count) {
                        <span class="block text-meta font-semibold text-warning">
                          {{ 'releases.untestedCount' | transloco: { count } }}
                        </span>
                      }
                    </td>
                    <td>
                      <tk-badge [tone]="tone(release.status).tone">{{ tone(release.status).labelKey | transloco }}</tk-badge>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="p-0">
                      <tk-empty-state
                        icon="rocket"
                        [heading]="'releases.empty.' + view() + 'Heading' | transloco"
                        [description]="'releases.empty.' + view() + 'Body' | transloco"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </tk-card>
      } @else if (releases.error()) {
        <tk-alert tone="danger" [heading]="'releases.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="releases.reload()">
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

    <tk-drawer [(open)]="createOpen" [heading]="'releases.newHeading' | transloco">
      <div class="space-y-4">
        <div>
          <label tkLabel for="rel-version">{{ 'releases.form.version' | transloco }}</label>
          <input
            tkInput
            id="rel-version"
            name="rel-version"
            maxlength="60"
            [placeholder]="'releases.form.versionPlaceholder' | transloco"
            [(ngModel)]="draftVersion"
          />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.form.versionHint' | transloco }}</p>
        </div>

        <div>
          <label tkLabel for="rel-title">{{ 'releases.form.title' | transloco }}</label>
          <input
            tkInput
            id="rel-title"
            name="rel-title"
            maxlength="200"
            [placeholder]="'releases.form.titlePlaceholder' | transloco"
            [(ngModel)]="draftTitle"
          />
        </div>

        <div>
          <label tkLabel for="rel-schedule">{{ 'releases.form.scheduled' | transloco }}</label>
          <input tkInput id="rel-schedule" name="rel-schedule" type="datetime-local" [(ngModel)]="draftSchedule" />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.form.scheduledHint' | transloco }}</p>
        </div>

        @if (createError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.createFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>

      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="createOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canCreate()" (click)="create()">{{ 'releases.form.submit' | transloco }}</button>
      </div>
    </tk-drawer>

    <tk-drawer [(open)]="settingsOpen" [heading]="'releases.settings.heading' | transloco">
      <div class="space-y-4">
        <p class="text-body text-muted-foreground">{{ 'releases.settings.intro' | transloco }}</p>
        <div>
          <label tkLabel for="rel-template">{{ 'releases.settings.template' | transloco }}</label>
          <input
            tkInput
            id="rel-template"
            name="rel-template"
            placeholder="https://dev.azure.com/org/project/_workitems/edit/&#123;id&#125;"
            [(ngModel)]="draftTemplate"
          />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.settings.templateHint' | transloco }}</p>
        </div>
        @if (settingsError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.settings.saveFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="settingsOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy()" (click)="saveSettings()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>
  `,
})
export class ReleaseList {
  /** Bound from `?view=` by `withComponentInputBinding()` — shareable, and Back works. */
  readonly view = input('open', { transform: fromQueryOr('open') });

  private readonly api = inject(ReleasesApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly transloco = inject(TranslocoService);

  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly isAdmin = this.session.isAdmin;

  protected readonly releases = resource({
    params: () => ({ view: this.view() }),
    loader: ({ params }) => this.api.list(params.view === 'all' ? undefined : params.view),
  });

  protected readonly rows = computed(() => this.releases.value() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.releases.error()));

  protected readonly busy = signal(false);
  protected readonly createOpen = signal(false);
  protected readonly draftVersion = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftSchedule = signal('');
  protected readonly createError = signal<string | null>(null);

  protected readonly settingsOpen = signal(false);
  protected readonly draftTemplate = signal('');
  protected readonly settingsError = signal<string | null>(null);

  protected readonly canCreate = computed(() => !this.busy() && this.draftVersion().trim().length > 0);

  protected readonly tabs = computed<TabItem[]>(() => [
    { id: 'open', label: this.transloco.translate('releases.tabs.open') },
    { id: 'released', label: this.transloco.translate('releases.tabs.released') },
    { id: 'all', label: this.transloco.translate('releases.tabs.all') },
  ]);

  protected setView(view: string): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'open' ? null : view },
      queryParamsHandling: 'merge',
    });
  }

  protected tone(status: string) {
    return toneFor(RELEASE_TONE, status);
  }

  protected when(iso: string): string {
    return formatDate(iso);
  }

  /** Zero returns undefined so `@if` skips it — a "0 untested" line is noise. */
  protected untested(release: ReleaseSummary): number | undefined {
    const remaining = release.workItemCount - release.workItemsTested;
    return remaining > 0 ? remaining : undefined;
  }

  protected startCreate(): void {
    this.draftVersion.set('');
    this.draftTitle.set('');
    this.draftSchedule.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) return;

    this.busy.set(true);
    this.createError.set(null);
    try {
      const release = await this.api.create({
        version: this.draftVersion().trim(),
        title: this.draftTitle().trim() || null,
        // `datetime-local` is local wall time with no zone; the Date makes it an
        // instant in the planner's own zone, which is the one they typed in.
        scheduledAt: this.draftSchedule() ? new Date(this.draftSchedule()).toISOString() : null,
      });
      this.createOpen.set(false);
      // Straight into the new plan: an empty release is not a thing anybody
      // wanted, it is a thing they are one step into filling in.
      void this.router.navigate(['/dashboard/releases', release.id]);
    } catch (error) {
      this.createError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async openSettings(): Promise<void> {
    this.settingsError.set(null);
    this.settingsOpen.set(true);
    try {
      const settings = await this.api.settings();
      this.draftTemplate.set(settings.workItemUrlTemplate ?? '');
    } catch (error) {
      this.settingsError.set(errorMessage(error));
    }
  }

  protected async saveSettings(): Promise<void> {
    this.busy.set(true);
    this.settingsError.set(null);
    try {
      await this.api.saveSettings({ workItemUrlTemplate: this.draftTemplate().trim() || null });
      this.settingsOpen.set(false);
      this.toast.success(this.transloco.translate('releases.settings.saved'));
    } catch (error) {
      this.settingsError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
