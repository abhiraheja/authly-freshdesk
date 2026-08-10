import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  RELEASE_STEP_KINDS,
  RELEASE_TEST_TONE,
  RELEASE_TONE,
  ReleasesApi,
  TicketsApi,
  errorMessage,
  formatDateTime,
  timeAgo,
  toneFor,
  valueOr,
  type BusinessService,
  type ReleaseComponent,
  type ReleaseDetail as ReleaseDetailModel,
  type UserSummary,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmService,
  Drawer,
  EmptyState,
  Icon,
  InputDirective,
  LabelDirective,
  PageHeader,
  Select,
  SelectOption,
  SkeletonDirective,
  ToastService,
} from '@trackly/ui';
import { ReleaseComponentCard } from './release-component-card';

/** Blocker code → the icon that carries its severity. Static, never interpolated. */
const BLOCKER_ORDER = ['no_components', 'no_rollback_plan', 'failed_items', 'untested_items'];

/**
 * One release plan — the screen that replaces the wiki page.
 *
 * It deliberately reads top to bottom like the document it replaces: version,
 * date, who is driving, then a section per service with its runbook and the
 * tasks shipping with it, then the rollback plan. The difference is that every
 * line carries a tick, a name and a timestamp, so the same page is also the
 * instrument the deployment is run from. Two renderings of one object beats a
 * document and a checklist that drift apart.
 *
 * The readiness banner sits above everything while the release is open, because
 * the only cheap time to fix a missing rollback plan or an untested task is
 * before the night it matters.
 */
@Component({
  selector: 'tk-release-detail',
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
    Select,
    SelectOption,
    SkeletonDirective,
    ReleaseComponentCard,
  ],
  template: `
    @if (release(); as rel) {
      <tk-page-header [title]="rel.version" [subtitle]="rel.title || ('releases.detail.noTitle' | transloco)">
        <div page-actions class="flex flex-wrap items-center gap-2">
          @for (action of actions(); track action.status) {
            <button
              tkButton
              [variant]="action.variant"
              [disabled]="busy() || action.blocked"
              [attr.title]="action.blocked ? ('releases.readiness.heading' | transloco) : null"
              (click)="setStatus(action.status)"
            >
              {{ action.labelKey | transloco }}
            </button>
          }
          <button tkButton variant="outline" [disabled]="busy()" (click)="startClone()">
            <tk-icon name="copy" [size]="16" />
            {{ 'releases.detail.clone' | transloco }}
          </button>
          @if (canEdit()) {
            <button tkButton variant="ghost" (click)="startEdit()">
              <tk-icon name="sliders-horizontal" [size]="16" />
              {{ 'common.edit' | transloco }}
            </button>
          }
        </div>
      </tk-page-header>

      <a class="mb-4 inline-flex items-center gap-1 text-meta font-medium hover:underline" routerLink="/dashboard/releases">
        <tk-icon name="arrow-left" [size]="14" />
        {{ 'releases.detail.back' | transloco }}
      </a>

      @if (actionError(); as message) {
        <tk-alert class="mb-4" tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
      }

      <!-- What still stands between this plan and a deployment. Shown while
           there is still time to do something about it. -->
      @if (!isClosed() && rel.readiness.blockers.length) {
        <tk-alert class="mb-4" tone="warning" [heading]="'releases.readiness.heading' | transloco">
          <ul class="mt-1 list-inside list-disc space-y-0.5">
            @for (blocker of blockers(); track blocker.code) {
              <li>{{ 'releases.readiness.' + camel(blocker.code) | transloco: { count: blocker.count } }}</li>
            }
          </ul>
        </tk-alert>
      } @else if (!isClosed() && rel.status === 'planning') {
        <tk-alert class="mb-4" tone="success" [heading]="'releases.readiness.okHeading' | transloco">
          {{ 'releases.readiness.okBody' | transloco }}
        </tk-alert>
      }

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="space-y-4">
          <!-- ── Services in this release ─────────────────────────── -->
          <section class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-subtitle font-semibold">
                {{ 'releases.detail.components' | transloco: { count: rel.components.length } }}
              </h2>
              @if (canEdit()) {
                <button tkButton variant="outline" size="sm" (click)="startAddComponent()">
                  <tk-icon name="plus" [size]="14" />
                  {{ 'releases.component.add' | transloco }}
                </button>
              }
            </div>

            @for (component of rel.components; track component.id) {
              <tk-release-component-card
                [component]="component"
                [canEdit]="canEdit()"
                [canRun]="canRun()"
                [canTest]="canTest()"
                [canVerify]="canVerify()"
                (updated)="apply($event)"
                (edit)="startEditComponent($event)"
                (addStep)="startAddStep($event)"
              />
            } @empty {
              <tk-card>
                <tk-empty-state
                  icon="server"
                  [heading]="'releases.component.emptyHeading' | transloco"
                  [description]="'releases.component.emptyBody' | transloco"
                />
              </tk-card>
            }
          </section>

          <!-- ── Tasks not filed under a service ──────────────────── -->
          <tk-card [heading]="'releases.item.looseHeading' | transloco">
            <button tkButton card-actions variant="outline" size="sm" [disabled]="!canEdit()" (click)="startAddItem()">
              <tk-icon name="plus" [size]="14" />
              {{ 'releases.item.add' | transloco }}
            </button>

            @if (rel.looseWorkItems.length) {
              <ul class="space-y-2">
                @for (item of rel.looseWorkItems; track item.id) {
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2.5">
                    <span class="flex min-w-0 items-center gap-2">
                      @if (item.externalKey; as key) {
                        @if (item.url; as url) {
                          <a class="font-mono text-meta font-semibold hover:underline" [href]="url" target="_blank" rel="noopener">{{ key }}</a>
                        } @else {
                          <span class="font-mono text-meta font-semibold">{{ key }}</span>
                        }
                      }
                      <span class="truncate">{{ item.title }}</span>
                    </span>
                    <span class="flex items-center gap-2">
                      <tk-badge [tone]="testTone(item.testStatus).tone">
                        {{ testTone(item.testStatus).labelKey | transloco }}
                      </tk-badge>
                      @if (canEdit()) {
                        <button
                          tkButton
                          variant="ghost"
                          size="sm"
                          [attr.aria-label]="'releases.item.assign' | transloco"
                          (click)="startAssignItem(item.id, item.title)"
                        >
                          <tk-icon name="link" [size]="14" />
                        </button>
                      }
                    </span>
                  </li>
                }
              </ul>
              <p class="mt-2 text-meta text-muted-foreground">{{ 'releases.item.looseHint' | transloco }}</p>
            } @else {
              <p class="text-body text-muted-foreground">{{ 'releases.item.looseEmpty' | transloco }}</p>
            }
          </tk-card>

          <!-- ── Rollback ─────────────────────────────────────────── -->
          <tk-card [heading]="'releases.detail.rollback' | transloco">
            @if (canEdit()) {
              <!-- The blocker banner names this field; the fix has to be one
                   click from where it is named, not buried behind Edit. -->
              <button tkButton card-actions variant="outline" size="sm" (click)="startEdit()">
                {{ (rel.rollbackPlan ? 'common.edit' : 'releases.detail.rollbackAdd') | transloco }}
              </button>
            }
            @if (rel.rollbackPlan) {
              <p class="whitespace-pre-wrap text-body">{{ rel.rollbackPlan }}</p>
            } @else {
              <p class="text-body text-warning">{{ 'releases.detail.rollbackMissing' | transloco }}</p>
            }
          </tk-card>

          @if (rel.notes) {
            <tk-card [heading]="'releases.detail.notes' | transloco">
              <p class="whitespace-pre-wrap text-body">{{ rel.notes }}</p>
            </tk-card>
          }
        </div>

        <!-- ── Side rail ──────────────────────────────────────────── -->
        <div class="space-y-4">
          <tk-card [heading]="'releases.detail.summary' | transloco">
            <dl class="space-y-2.5 text-body">
              <div class="flex items-center justify-between gap-2">
                <dt class="text-muted-foreground">{{ 'releases.columns.status' | transloco }}</dt>
                <dd><tk-badge [tone]="tone(rel.status).tone">{{ tone(rel.status).labelKey | transloco }}</tk-badge></dd>
              </div>
              <div class="flex items-center justify-between gap-2">
                <dt class="text-muted-foreground">{{ 'releases.columns.scheduled' | transloco }}</dt>
                <dd>{{ rel.scheduledAt ? at(rel.scheduledAt) : ('releases.noDate' | transloco) }}</dd>
              </div>
              <div class="flex items-center justify-between gap-2">
                <dt class="text-muted-foreground">{{ 'releases.columns.manager' | transloco }}</dt>
                <dd>
                  @if (rel.releaseManager; as manager) {
                    <span class="flex items-center gap-1.5">
                      <tk-avatar [name]="manager.name || manager.email" [imageUrl]="manager.avatarUrl" [size]="18" round />
                      {{ manager.name || manager.email }}
                    </span>
                  } @else {
                    {{ 'releases.noManager' | transloco }}
                  }
                </dd>
              </div>
              @if (rel.startedAt) {
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-muted-foreground">{{ 'releases.detail.started' | transloco }}</dt>
                  <dd>{{ at(rel.startedAt) }}</dd>
                </div>
              }
              @if (rel.releasedAt) {
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-muted-foreground">{{ 'releases.detail.releasedAt' | transloco }}</dt>
                  <dd>{{ at(rel.releasedAt) }}</dd>
                </div>
              }
            </dl>
          </tk-card>

          <tk-card [heading]="'releases.detail.activity' | transloco">
            @if (rel.activity.length) {
              <ol class="space-y-2.5">
                @for (entry of rel.activity; track entry.id) {
                  <li class="text-meta">
                    <span class="font-medium">{{ entry.actor?.name || entry.actor?.email || ('common.someone' | transloco) }}</span>
                    {{ 'releases.activity.' + camel(entry.action) | transloco }}
                    @if (entry.detail) {
                      <span class="font-mono">{{ entry.detail }}</span>
                    }
                    <span class="block text-muted-foreground">{{ ago(entry.createdAt) }}</span>
                  </li>
                }
              </ol>
            } @else {
              <p class="text-body text-muted-foreground">{{ 'releases.detail.activityEmpty' | transloco }}</p>
            }
          </tk-card>
        </div>
      </div>
    } @else if (detail.error()) {
      <tk-alert tone="danger" [heading]="'releases.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="detail.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-4">
        <span tkSkeleton class="block h-10 w-64"></span>
        <span tkSkeleton class="block h-40 w-full"></span>
        <span tkSkeleton class="block h-40 w-full"></span>
      </div>
    }

    <!-- ── Release settings drawer ─────────────────────────────────── -->
    <tk-drawer [(open)]="editOpen" [heading]="'releases.detail.editHeading' | transloco">
      <div class="space-y-4">
        <div>
          <label tkLabel for="edit-version">{{ 'releases.form.version' | transloco }}</label>
          <input tkInput id="edit-version" name="edit-version" maxlength="60" [(ngModel)]="draftVersion" />
        </div>
        <div>
          <label tkLabel for="edit-title">{{ 'releases.form.title' | transloco }}</label>
          <input tkInput id="edit-title" name="edit-title" maxlength="200" [(ngModel)]="draftTitle" />
        </div>
        <div>
          <label tkLabel for="edit-schedule">{{ 'releases.form.scheduled' | transloco }}</label>
          <input tkInput id="edit-schedule" name="edit-schedule" type="datetime-local" [(ngModel)]="draftSchedule" />
        </div>
        <div>
          <label tkLabel for="edit-manager">{{ 'releases.form.manager' | transloco }}</label>
          <tk-select inputId="edit-manager" [(value)]="draftManager">
            <tk-option value="" [label]="'releases.noManager' | transloco" />
            @for (agent of agentList(); track agent.id) {
              <tk-option [value]="agent.id" [label]="agent.name || agent.email || ''" />
            }
          </tk-select>
        </div>
        <div>
          <label tkLabel for="edit-rollback">{{ 'releases.form.rollback' | transloco }}</label>
          <textarea tkInput id="edit-rollback" name="edit-rollback" rows="5" [(ngModel)]="draftRollback"></textarea>
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.form.rollbackHint' | transloco }}</p>
        </div>
        <div>
          <label tkLabel for="edit-notes">{{ 'releases.form.notes' | transloco }}</label>
          <textarea tkInput id="edit-notes" name="edit-notes" rows="4" [(ngModel)]="draftNotes"></textarea>
        </div>
        @if (formError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="editOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy()" (click)="saveEdit()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>

    <!-- ── Add / edit a service ────────────────────────────────────── -->
    <tk-drawer [(open)]="componentOpen" [heading]="componentHeading() | transloco">
      <div class="space-y-4">
        @if (!editingComponentId()) {
          <div>
            <label tkLabel for="comp-service">{{ 'releases.component.service' | transloco }}</label>
            <tk-select inputId="comp-service" [(value)]="draftServiceId">
              <tk-option value="" [label]="'releases.component.serviceCustom' | transloco" />
              @for (service of serviceList(); track service.id) {
                <tk-option [value]="service.id" [label]="service.name" />
              }
            </tk-select>
            <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.component.serviceHint' | transloco }}</p>
          </div>
        }

        <div>
          <label tkLabel for="comp-name">{{ 'releases.component.name' | transloco }}</label>
          <input tkInput id="comp-name" name="comp-name" maxlength="120" [(ngModel)]="draftComponentName" />
        </div>

        <div>
          <label tkLabel for="comp-build">{{ 'releases.component.build' | transloco }}</label>
          <input tkInput id="comp-build" name="comp-build" maxlength="80" [(ngModel)]="draftBuild" />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.component.buildHint' | transloco }}</p>
        </div>

        <div>
          <label tkLabel for="comp-pipeline">{{ 'releases.component.pipelineUrl' | transloco }}</label>
          <input tkInput id="comp-pipeline" name="comp-pipeline" [(ngModel)]="draftPipeline" />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.component.pipelineHint' | transloco }}</p>
        </div>

        <div>
          <label tkLabel for="comp-owner">{{ 'releases.component.owner' | transloco }}</label>
          <tk-select inputId="comp-owner" [(value)]="draftComponentOwner">
            <tk-option value="" [label]="'releases.component.noOwner' | transloco" />
            @for (agent of agentList(); track agent.id) {
              <tk-option [value]="agent.id" [label]="agent.name || agent.email || ''" />
            }
          </tk-select>
        </div>

        @if (formError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="componentOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy()" (click)="saveComponent()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>

    <!-- ── Add a runbook step ──────────────────────────────────────── -->
    <tk-drawer [(open)]="stepOpen" [heading]="'releases.step.addHeading' | transloco">
      <div class="space-y-4">
        <div>
          <label tkLabel for="step-kind">{{ 'releases.step.kind' | transloco }}</label>
          <tk-select inputId="step-kind" [(value)]="draftStepKind">
            @for (kind of stepKinds; track kind) {
              <tk-option [value]="kind" [label]="'releases.step.kinds.' + kind | transloco" />
            }
          </tk-select>
        </div>

        <div>
          <label tkLabel for="step-title">{{ 'releases.step.title' | transloco }}</label>
          <input tkInput id="step-title" name="step-title" maxlength="200" [(ngModel)]="draftStepTitle" />
        </div>

        <div>
          <label tkLabel for="step-env">{{ 'releases.step.env' | transloco }}</label>
          <input
            tkInput
            id="step-env"
            name="step-env"
            [placeholder]="'releases.step.envPlaceholder' | transloco"
            [(ngModel)]="draftStepEnv"
          />
        </div>

        <div>
          <label tkLabel for="step-url">{{ 'releases.step.url' | transloco }}</label>
          <input tkInput id="step-url" name="step-url" [(ngModel)]="draftStepUrl" />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.step.urlHint' | transloco }}</p>
        </div>

        <div>
          <label tkLabel for="step-body">{{ bodyLabel() | transloco }}</label>
          <textarea
            tkInput
            id="step-body"
            name="step-body"
            rows="7"
            class="font-mono"
            [placeholder]="bodyPlaceholder() | transloco"
            [(ngModel)]="draftStepBody"
          ></textarea>
          <!-- The env-change warning is not decoration. A release plan needs to
               record THAT a variable changes — the part people forget — never
               what it is, which the vault already holds and which becomes a
               thing to rotate the moment it is written down anywhere else. -->
          @if (draftStepKind() === 'env_change') {
            <tk-alert class="mt-2" tone="warning" [heading]="'releases.step.secretHeading' | transloco">
              {{ 'releases.step.secretBody' | transloco }}
            </tk-alert>
          }
        </div>

        @if (formError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="stepOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy() || !draftStepTitle().trim()" (click)="saveStep()">
          {{ 'common.save' | transloco }}
        </button>
      </div>
    </tk-drawer>

    <!-- ── Add a task ──────────────────────────────────────────────── -->
    <tk-drawer [(open)]="itemOpen" [heading]="itemHeading() | transloco">
      <div class="space-y-4">
        @if (!assigningItemId()) {
          <div>
            <label tkLabel for="item-key">{{ 'releases.item.key' | transloco }}</label>
            <input
              tkInput
              id="item-key"
              name="item-key"
              [placeholder]="'releases.item.keyPlaceholder' | transloco"
              [(ngModel)]="draftItemKey"
            />
            <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.item.keyHint' | transloco }}</p>
          </div>

          <div>
            <label tkLabel for="item-title">{{ 'releases.item.title' | transloco }}</label>
            <input tkInput id="item-title" name="item-title" maxlength="200" [(ngModel)]="draftItemTitle" />
          </div>

          <div>
            <label tkLabel for="item-url">{{ 'releases.item.url' | transloco }}</label>
            <input tkInput id="item-url" name="item-url" [(ngModel)]="draftItemUrl" />
            <p class="mt-1.5 text-meta text-muted-foreground">{{ 'releases.item.urlHint' | transloco }}</p>
          </div>
        }

        <div>
          <label tkLabel for="item-component">{{ 'releases.item.component' | transloco }}</label>
          <tk-select inputId="item-component" [(value)]="draftItemComponent">
            <tk-option value="" [label]="'releases.item.noComponent' | transloco" />
            @for (component of componentOptions(); track component.id) {
              <tk-option [value]="component.id" [label]="component.name" />
            }
          </tk-select>
        </div>

        @if (formError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="itemOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy() || !canSaveItem()" (click)="saveItem()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>

    <!-- ── Clone into the next release ─────────────────────────────── -->
    <tk-drawer [(open)]="cloneOpen" [heading]="'releases.clone.heading' | transloco">
      <div class="space-y-4">
        <p class="text-body text-muted-foreground">{{ 'releases.clone.intro' | transloco }}</p>
        <div>
          <label tkLabel for="clone-version">{{ 'releases.form.version' | transloco }}</label>
          <input tkInput id="clone-version" name="clone-version" maxlength="60" [(ngModel)]="draftCloneVersion" />
        </div>
        <div>
          <label tkLabel for="clone-schedule">{{ 'releases.form.scheduled' | transloco }}</label>
          <input tkInput id="clone-schedule" name="clone-schedule" type="datetime-local" [(ngModel)]="draftCloneSchedule" />
        </div>
        @if (formError(); as message) {
          <tk-alert tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>
      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="cloneOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="busy() || !draftCloneVersion().trim()" (click)="clone()">
          {{ 'releases.clone.submit' | transloco }}
        </button>
      </div>
    </tk-drawer>
  `,
})
export class ReleaseDetail {
  readonly id = input.required<string>();

  private readonly api = inject(ReleasesApi);
  private readonly tickets = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly stepKinds = RELEASE_STEP_KINDS;

  protected readonly detail = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.get(params.id),
  });

  private readonly agents = resource({ loader: () => this.tickets.agents() });
  private readonly services = resource({ loader: () => this.tickets.services() });

  protected readonly release = computed(() => this.detail.value() ?? null);
  protected readonly loadError = computed(() => errorMessage(this.detail.error()));
  protected readonly agentList = computed(() => valueOr<UserSummary[]>(this.agents, []));
  protected readonly serviceList = computed(() =>
    valueOr<BusinessService[]>(this.services, []).filter((service) => service.isActive),
  );

  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected readonly isClosed = computed(() => {
    const status = this.release()?.status;
    return status === 'released' || status === 'rolled_back' || status === 'cancelled';
  });

  /** Structural edits stop the moment a release closes: it becomes a record. */
  protected readonly canEdit = computed(() => !!this.release() && !this.isClosed());
  /** Ticking a step from `ready` starts the release, so both states allow it. */
  protected readonly canRun = computed(() => {
    const status = this.release()?.status;
    return status === 'ready' || status === 'in_progress';
  });
  protected readonly canTest = computed(() => !!this.release() && !this.isClosed());
  protected readonly canVerify = computed(() => {
    const status = this.release()?.status;
    return status === 'in_progress' || status === 'released';
  });

  /** Sorted so the same two blockers never swap places between reloads. */
  protected readonly blockers = computed(() =>
    [...(this.release()?.readiness.blockers ?? [])].sort(
      (a, b) => BLOCKER_ORDER.indexOf(a.code) - BLOCKER_ORDER.indexOf(b.code),
    ),
  );

  /**
   * Only the transitions the API will actually accept, so a button never offers
   * something that comes back as an error.
   *
   * The two that run the readiness check are **disabled rather than hidden**
   * while it fails. Hiding them would leave somebody looking for the button that
   * ships a release; disabled with the blocker list already open above it says
   * both that the action exists and what has to happen first.
   */
  protected readonly actions = computed<
    { status: string; labelKey: string; variant: 'primary' | 'outline'; blocked: boolean }[]
  >(() => {
    const gated = !(this.release()?.readiness.canMarkReady ?? false);
    switch (this.release()?.status) {
      case 'planning':
        return [{ status: 'ready', labelKey: 'releases.actions.markReady', variant: 'primary', blocked: gated }];
      case 'ready':
        return [
          { status: 'in_progress', labelKey: 'releases.actions.start', variant: 'primary', blocked: gated },
          { status: 'planning', labelKey: 'releases.actions.reopen', variant: 'outline', blocked: false },
        ];
      case 'in_progress':
        return [
          { status: 'released', labelKey: 'releases.actions.markReleased', variant: 'primary', blocked: false },
          { status: 'rolled_back', labelKey: 'releases.actions.rollBack', variant: 'outline', blocked: false },
        ];
      case 'released':
        return [{ status: 'rolled_back', labelKey: 'releases.actions.rollBack', variant: 'outline', blocked: false }];
      default:
        return [];
    }
  });

  protected readonly componentOptions = computed(() => this.release()?.components ?? []);

  // ── Drawer state ─────────────────────────────────────────────────────────
  protected readonly editOpen = signal(false);
  protected readonly draftVersion = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftSchedule = signal('');
  protected readonly draftManager = signal('');
  protected readonly draftRollback = signal('');
  protected readonly draftNotes = signal('');

  protected readonly componentOpen = signal(false);
  protected readonly editingComponentId = signal<string | null>(null);
  protected readonly draftServiceId = signal('');
  protected readonly draftComponentName = signal('');
  protected readonly draftBuild = signal('');
  protected readonly draftPipeline = signal('');
  protected readonly draftComponentOwner = signal('');

  protected readonly stepOpen = signal(false);
  private readonly stepComponentId = signal<string | null>(null);
  protected readonly draftStepKind = signal<string>('pipeline');
  protected readonly draftStepTitle = signal('');
  protected readonly draftStepEnv = signal('');
  protected readonly draftStepUrl = signal('');
  protected readonly draftStepBody = signal('');

  protected readonly itemOpen = signal(false);
  protected readonly assigningItemId = signal<string | null>(null);
  protected readonly draftItemKey = signal('');
  protected readonly draftItemTitle = signal('');
  protected readonly draftItemUrl = signal('');
  protected readonly draftItemComponent = signal('');

  protected readonly cloneOpen = signal(false);
  protected readonly draftCloneVersion = signal('');
  protected readonly draftCloneSchedule = signal('');

  protected readonly componentHeading = computed(() =>
    this.editingComponentId() ? 'releases.component.editHeading' : 'releases.component.addHeading',
  );
  protected readonly itemHeading = computed(() =>
    this.assigningItemId() ? 'releases.item.assignHeading' : 'releases.item.addHeading',
  );

  /** The body field changes meaning with the kind, so its label and hint do too. */
  protected readonly bodyLabel = computed(() =>
    this.draftStepKind() === 'env_change' ? 'releases.step.bodyEnv' : 'releases.step.body',
  );
  protected readonly bodyPlaceholder = computed(() => `releases.step.bodyPlaceholder.${this.draftStepKind()}`);

  protected readonly canSaveItem = computed(() =>
    this.assigningItemId() ? true : this.draftItemTitle().trim().length > 0,
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  protected tone(status: string) {
    return toneFor(RELEASE_TONE, status);
  }

  protected testTone(status: string) {
    return toneFor(RELEASE_TEST_TONE, status);
  }

  protected at(iso: string): string {
    return formatDateTime(iso);
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  protected camel(value: string): string {
    return value.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  }

  /** Every mutation returns the whole release — replace, never patch. */
  protected apply(release: ReleaseDetailModel): void {
    this.detail.value.set(release);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  protected async setStatus(status: string): Promise<void> {
    // Only where it is hard to undo. Marking ready is a claim you can retract;
    // shipping and rolling back are not.
    if (status === 'released' || status === 'rolled_back') {
      const ok = await this.confirm.ask({
        heading: this.transloco.translate(`releases.confirm.${this.camel(status)}Heading`),
        message: this.transloco.translate(`releases.confirm.${this.camel(status)}Body`),
        confirmLabel: this.transloco.translate(`releases.actions.${status === 'released' ? 'markReleased' : 'rollBack'}`),
        tone: status === 'released' ? 'primary' : 'danger',
      });
      if (!ok) return;
    }

    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.apply(await this.api.setStatus(this.id(), status));
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  // ── Release settings ─────────────────────────────────────────────────────

  protected startEdit(): void {
    const rel = this.release();
    if (!rel) return;
    this.draftVersion.set(rel.version);
    this.draftTitle.set(rel.title ?? '');
    this.draftSchedule.set(toLocalInput(rel.scheduledAt));
    this.draftManager.set(rel.releaseManager?.id ?? '');
    this.draftRollback.set(rel.rollbackPlan ?? '');
    this.draftNotes.set(rel.notes ?? '');
    this.formError.set(null);
    this.editOpen.set(true);
  }

  protected async saveEdit(): Promise<void> {
    await this.submit(
      () =>
        this.api.update(this.id(), {
          version: this.draftVersion().trim(),
          title: this.draftTitle().trim() || null,
          scheduledAt: this.draftSchedule() ? new Date(this.draftSchedule()).toISOString() : null,
          clearSchedule: !this.draftSchedule(),
          releaseManagerId: this.draftManager() || null,
          clearManager: !this.draftManager(),
          rollbackPlan: this.draftRollback().trim() || null,
          notes: this.draftNotes().trim() || null,
        }),
      this.editOpen,
    );
  }

  // ── Components ───────────────────────────────────────────────────────────

  protected startAddComponent(): void {
    this.editingComponentId.set(null);
    this.draftServiceId.set('');
    this.draftComponentName.set('');
    this.draftBuild.set('');
    this.draftPipeline.set('');
    this.draftComponentOwner.set('');
    this.formError.set(null);
    this.componentOpen.set(true);
  }

  protected startEditComponent(component: ReleaseComponent): void {
    this.editingComponentId.set(component.id);
    this.draftComponentName.set(component.name);
    this.draftBuild.set(component.buildVersion ?? '');
    this.draftPipeline.set(component.pipelineUrl ?? '');
    this.draftComponentOwner.set(component.owner?.id ?? '');
    this.formError.set(null);
    this.componentOpen.set(true);
  }

  protected async saveComponent(): Promise<void> {
    const editing = this.editingComponentId();
    await this.submit(
      () =>
        editing
          ? this.api.updateComponent(editing, {
              name: this.draftComponentName().trim(),
              buildVersion: this.draftBuild().trim() || null,
              pipelineUrl: this.draftPipeline().trim() || null,
              ownerId: this.draftComponentOwner() || null,
              clearOwner: !this.draftComponentOwner(),
            })
          : this.api.addComponent(this.id(), {
              serviceId: this.draftServiceId() || null,
              name: this.draftComponentName().trim() || null,
              buildVersion: this.draftBuild().trim() || null,
              pipelineUrl: this.draftPipeline().trim() || null,
              ownerId: this.draftComponentOwner() || null,
            }),
      this.componentOpen,
    );
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  protected startAddStep(component: ReleaseComponent): void {
    this.stepComponentId.set(component.id);
    this.draftStepKind.set('pipeline');
    this.draftStepTitle.set('');
    this.draftStepEnv.set('');
    // Pre-filled from the service catalogue, so the commonest step is one field.
    this.draftStepUrl.set(component.pipelineUrl ?? '');
    this.draftStepBody.set('');
    this.formError.set(null);
    this.stepOpen.set(true);
  }

  protected async saveStep(): Promise<void> {
    const componentId = this.stepComponentId();
    if (!componentId) return;
    await this.submit(
      () =>
        this.api.addStep(componentId, {
          kind: this.draftStepKind(),
          title: this.draftStepTitle().trim(),
          body: this.draftStepBody().trim() || null,
          targetEnv: this.draftStepEnv().trim() || null,
          url: this.draftStepUrl().trim() || null,
        }),
      this.stepOpen,
    );
  }

  // ── Work items ───────────────────────────────────────────────────────────

  protected startAddItem(): void {
    this.assigningItemId.set(null);
    this.draftItemKey.set('');
    this.draftItemTitle.set('');
    this.draftItemUrl.set('');
    this.draftItemComponent.set('');
    this.formError.set(null);
    this.itemOpen.set(true);
  }

  protected startAssignItem(itemId: string, title: string): void {
    this.assigningItemId.set(itemId);
    this.draftItemTitle.set(title);
    this.draftItemComponent.set('');
    this.formError.set(null);
    this.itemOpen.set(true);
  }

  protected async saveItem(): Promise<void> {
    const assigning = this.assigningItemId();
    await this.submit(
      () =>
        assigning
          ? this.api.updateWorkItem(assigning, {
              componentId: this.draftItemComponent() || null,
              clearComponent: !this.draftItemComponent(),
            })
          : this.api.addWorkItem(this.id(), {
              title: this.draftItemTitle().trim(),
              externalKey: this.draftItemKey().trim() || null,
              externalUrl: this.draftItemUrl().trim() || null,
              componentId: this.draftItemComponent() || null,
            }),
      this.itemOpen,
    );
  }

  // ── Clone ────────────────────────────────────────────────────────────────

  protected startClone(): void {
    this.draftCloneVersion.set('');
    this.draftCloneSchedule.set('');
    this.formError.set(null);
    this.cloneOpen.set(true);
  }

  protected async clone(): Promise<void> {
    this.busy.set(true);
    this.formError.set(null);
    try {
      const next = await this.api.clone(this.id(), {
        version: this.draftCloneVersion().trim(),
        scheduledAt: this.draftCloneSchedule() ? new Date(this.draftCloneSchedule()).toISOString() : null,
      });
      this.cloneOpen.set(false);
      this.toast.success(this.transloco.translate('releases.clone.created', { version: next.version }));
      void this.router.navigate(['/dashboard/releases', next.id]);
    } catch (error) {
      this.formError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Runs a drawer's save. The error stays in the drawer next to the field that
   * caused it — a toast would take the only copy of it away in four seconds.
   */
  private async submit(
    action: () => Promise<ReleaseDetailModel>,
    drawer: { set(value: boolean): void },
  ): Promise<void> {
    this.busy.set(true);
    this.formError.set(null);
    try {
      this.apply(await action());
      drawer.set(false);
    } catch (error) {
      this.formError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * ISO instant → the value a `datetime-local` input wants, in the reader's own
 * zone. `toISOString()` would hand it UTC and quietly shift the time somebody
 * typed by however many hours they are from Greenwich.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
