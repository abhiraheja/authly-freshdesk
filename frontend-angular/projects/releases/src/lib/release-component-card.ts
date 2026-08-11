import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ApiError,
  RELEASE_RUN_TONE,
  RELEASE_TEST_STATUSES,
  RELEASE_TEST_TONE,
  ReleasesApi,
  errorMessage,
  formatDateTime,
  toneFor,
  type ReleaseComponent,
  type ReleaseDetail,
  type ReleaseStep,
  type ReleaseWorkItem,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmService,
  Icon,
  Select,
  SelectOption,
  type IconName,
} from '@trackly/ui';

/**
 * Step kind → icon. A static map: an interpolated Tailwind or icon name emits
 * nothing at all, silently.
 */
const KIND_ICON: Record<string, IconName> = {
  pipeline: 'workflow',
  db_script: 'server',
  env_change: 'sliders-horizontal',
  manual: 'clipboard-list',
  verify: 'check-circle',
};

/**
 * One deployable thing in a release, with its runbook and the tasks shipping
 * with it. This is the unit people actually work through on the night.
 *
 * Two different interaction styles on purpose, and the split is deliberate:
 *
 * - **Steps get buttons.** They are ticked during the deployment, often on a
 *   phone, often at speed. One tap per outcome.
 * - **Work items get a select.** Testing is a calm pre-deploy pass and has five
 *   honest outcomes, two of which (`blocked`, `skipped`) matter precisely
 *   because they are not "pass" and must not be hidden behind a fourth button
 *   nobody finds.
 */
@Component({
  selector: 'tk-release-component-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Avatar, Badge, Button, Card, Icon, Select, SelectOption],
  template: `
    <tk-card>
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-meta font-semibold text-muted-foreground"
              [attr.aria-label]="'releases.component.order' | transloco: { n: component().sequence }"
            >
              {{ component().sequence }}
            </span>
            <h3 class="truncate text-subtitle font-semibold">{{ component().name }}</h3>
            <tk-badge [tone]="runTone(component().status).tone">
              {{ runTone(component().status).labelKey | transloco }}
            </tk-badge>
            @if (component().buildVersion; as build) {
              <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-meta">{{ build }}</span>
            }
          </div>

          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
            @if (component().owner; as owner) {
              <span class="flex items-center gap-1.5">
                <tk-avatar [name]="owner.name || owner.email" [imageUrl]="owner.avatarUrl" [size]="18" round />
                {{ owner.name || owner.email }}
              </span>
            }
            @if (component().pipelineUrl; as url) {
              <a class="flex items-center gap-1 font-medium hover:underline" [href]="url" target="_blank" rel="noopener">
                <tk-icon name="workflow" [size]="13" />
                {{ 'releases.component.pipeline' | transloco }}
                <tk-icon name="external-link" [size]="12" />
              </a>
            }
            @if (component().completedAt; as at) {
              <span>{{ 'releases.component.finishedAt' | transloco: { when: when(at) } }}</span>
            }
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          @if (canEdit()) {
            <button tkButton variant="ghost" size="sm" (click)="addStep.emit(component())">
              <tk-icon name="plus" [size]="14" />
              {{ 'releases.step.add' | transloco }}
            </button>
            <button
              tkButton
              variant="ghost"
              size="sm"
              [attr.aria-label]="'releases.component.edit' | transloco"
              (click)="edit.emit(component())"
            >
              <tk-icon name="sliders-horizontal" [size]="14" />
            </button>
            <button
              tkButton
              variant="ghost"
              size="sm"
              [attr.aria-label]="'releases.component.remove' | transloco"
              (click)="remove()"
            >
              <tk-icon name="trash-2" [size]="14" />
            </button>
          }
        </div>
      </div>

      @if (error(); as message) {
        <tk-alert class="mb-3" tone="danger" [heading]="'releases.actionFailed' | transloco">{{ message }}</tk-alert>
      }

      <!-- ── The runbook ─────────────────────────────────────────────── -->
      @if (component().steps.length) {
        <ul class="divide-y divide-border">
          @for (step of component().steps; track step.id) {
            <li class="flex flex-wrap items-start gap-3 py-3 first:pt-0">
              <span
                class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
                [attr.aria-label]="'releases.step.kinds.' + step.kind | transloco"
              >
                <tk-icon [name]="kindIcon(step)" [size]="15" />
              </span>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium" [class.line-through]="isSettled(step)">{{ step.title }}</span>
                  @if (step.targetEnv; as env) {
                    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-meta">{{ env }}</span>
                  }
                  @if (step.url; as url) {
                    <a class="flex items-center gap-1 text-meta font-medium hover:underline" [href]="url" target="_blank" rel="noopener">
                      {{ 'releases.step.open' | transloco }}
                      <tk-icon name="external-link" [size]="12" />
                    </a>
                  }
                </div>

                @if (step.body; as body) {
                  <!-- Verbatim, and scrolling inside its own box rather than
                       widening the page. A migration you have to re-type from
                       memory at midnight is the thing this replaces. -->
                  <pre class="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2.5 text-meta font-mono whitespace-pre-wrap break-words">{{ body }}</pre>
                }

                @if (step.doneAt) {
                  <p class="mt-1.5 text-meta text-muted-foreground">
                    {{
                      'releases.step.doneBy'
                        | transloco: { who: step.doneBy?.name || step.doneBy?.email || ('common.someone' | transloco), when: when(step.doneAt) }
                    }}
                  </p>
                }
                @if (step.result; as result) {
                  <p class="mt-1 text-meta font-medium text-danger">{{ result }}</p>
                }
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                @if (step.status === 'pending') {
                  @if (canRun()) {
                    <button tkButton size="sm" [disabled]="busy()" (click)="setStep(step, 'done')">
                      <tk-icon name="check" [size]="14" />
                      {{ 'releases.step.markDone' | transloco }}
                    </button>
                    <button
                      tkButton
                      variant="outline"
                      size="sm"
                      [disabled]="busy()"
                      [attr.aria-label]="'releases.step.markFailed' | transloco"
                      (click)="setStep(step, 'failed')"
                    >
                      <tk-icon name="alert-triangle" [size]="14" />
                    </button>
                    <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="setStep(step, 'skipped')">
                      {{ 'releases.step.skip' | transloco }}
                    </button>
                  } @else {
                    <tk-badge tone="neutral">{{ 'releases.run.pending' | transloco }}</tk-badge>
                  }
                } @else {
                  <tk-badge [tone]="runTone(step.status).tone">{{ runTone(step.status).labelKey | transloco }}</tk-badge>
                  @if (canRun()) {
                    <button
                      tkButton
                      variant="ghost"
                      size="sm"
                      [disabled]="busy()"
                      [attr.aria-label]="'releases.step.undo' | transloco"
                      (click)="setStep(step, 'pending')"
                    >
                      <tk-icon name="refresh-cw" [size]="14" />
                    </button>
                  }
                }
                @if (canEdit()) {
                  <button
                    tkButton
                    variant="ghost"
                    size="sm"
                    [attr.aria-label]="'releases.step.remove' | transloco"
                    (click)="removeStep(step)"
                  >
                    <tk-icon name="trash-2" [size]="14" />
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="py-3 text-body text-muted-foreground">{{ 'releases.step.none' | transloco }}</p>
      }

      <!-- ── What ships with it, and whether it was tested ──────────── -->
      @if (component().workItems.length) {
        <div class="mt-4 border-t border-border pt-3">
          <h4 class="mb-2 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
            {{ 'releases.item.heading' | transloco: { count: component().workItems.length } }}
          </h4>
          <ul class="space-y-2">
            @for (item of component().workItems; track item.id) {
              <li class="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/40 p-2.5">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    @if (item.externalKey; as key) {
                      @if (item.url; as url) {
                        <a class="flex items-center gap-1 font-mono text-meta font-semibold hover:underline" [href]="url" target="_blank" rel="noopener">
                          {{ key }}
                          <tk-icon name="external-link" [size]="12" />
                        </a>
                      } @else {
                        <span class="font-mono text-meta font-semibold">{{ key }}</span>
                      }
                    }
                    <span class="truncate font-medium">{{ item.title }}</span>
                  </div>
                  @if (item.ticketId) {
                    <a class="mt-1 flex items-center gap-1 text-meta text-muted-foreground hover:underline" [href]="'/dashboard/tickets/' + item.ticketId">
                      <tk-icon name="ticket" [size]="12" />
                      #{{ item.ticketId.slice(0, 8) }} · {{ item.ticketSubject }}
                    </a>
                  }
                  @if (item.testedAt) {
                    <p class="mt-1 text-meta text-muted-foreground">
                      {{
                        'releases.item.testedBy'
                          | transloco: { who: item.testedBy?.name || item.testedBy?.email || ('common.someone' | transloco), when: when(item.testedAt) }
                      }}
                    </p>
                  }
                  @if (item.testNotes; as notes) {
                    <p class="mt-1 text-meta">{{ notes }}</p>
                  }
                </div>

                <div class="flex shrink-0 flex-col items-end gap-1.5">
                  <div class="flex items-center gap-1.5">
                    <span class="text-meta text-muted-foreground">{{ 'releases.item.test' | transloco }}</span>
                    @if (canTest()) {
                      <tk-select
                        class="w-36"
                        [inputId]="'test-' + item.id"
                        [value]="item.testStatus"
                        (valueChange)="setTest(item, $event)"
                      >
                        @for (status of testStatuses; track status) {
                          <tk-option [value]="status" [label]="'releases.test.' + camel(status) | transloco" />
                        }
                      </tk-select>
                    } @else {
                      <tk-badge [tone]="testTone(item.testStatus).tone">
                        {{ testTone(item.testStatus).labelKey | transloco }}
                      </tk-badge>
                    }
                  </div>

                  <!-- Only once the deployment is under way: production
                       verification before anything is on production is a tick
                       that means nothing. -->
                  @if (canVerify()) {
                    <div class="flex items-center gap-1.5">
                      <span class="text-meta text-muted-foreground">{{ 'releases.item.verify' | transloco }}</span>
                      <tk-select
                        class="w-36"
                        [inputId]="'verify-' + item.id"
                        [value]="item.verifyStatus"
                        (valueChange)="setVerify(item, $event)"
                      >
                        @for (status of testStatuses; track status) {
                          <tk-option [value]="status" [label]="'releases.test.' + camel(status) | transloco" />
                        }
                      </tk-select>
                    </div>
                  } @else if (item.verifyStatus !== 'not_tested') {
                    <tk-badge [tone]="testTone(item.verifyStatus).tone">
                      {{ 'releases.item.verifiedAs' | transloco: { status: testTone(item.verifyStatus).labelKey | transloco } }}
                    </tk-badge>
                  }
                </div>
              </li>
            }
          </ul>
        </div>
      }

      @if (component().notes; as notes) {
        <p class="mt-3 border-t border-border pt-3 text-body text-muted-foreground whitespace-pre-wrap">{{ notes }}</p>
      }
    </tk-card>
  `,
})
export class ReleaseComponentCard {
  readonly component = input.required<ReleaseComponent>();
  /** Structural edits — off once the release is closed. */
  readonly canEdit = input(false);
  /** Ticking steps — the deployment is under way, or about to start. */
  readonly canRun = input(false);
  /** Pre-deploy testing — open until the release closes. */
  readonly canTest = input(false);
  /** Post-deploy verification — only once something is actually on production. */
  readonly canVerify = input(false);

  readonly updated = output<ReleaseDetail>();
  readonly edit = output<ReleaseComponent>();
  readonly addStep = output<ReleaseComponent>();

  private readonly api = inject(ReleasesApi);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly testStatuses = RELEASE_TEST_STATUSES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected kindIcon(step: ReleaseStep): IconName {
    return KIND_ICON[step.kind] ?? 'clipboard-list';
  }

  protected runTone(status: string) {
    return toneFor(RELEASE_RUN_TONE, status);
  }

  protected testTone(status: string) {
    return toneFor(RELEASE_TEST_TONE, status);
  }

  protected isSettled(step: ReleaseStep): boolean {
    return step.status === 'done' || step.status === 'skipped';
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  /** `not_tested` → `notTested`, so one snake_case vocabulary maps onto camelCase keys. */
  protected camel(value: string): string {
    return value.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  }

  /**
   * The out-of-order case is a 409, not a failure: an earlier step is still
   * pending and the API wants that confirmed. Asking here — rather than blocking
   * — is what keeps the override inside the tool, where it gets logged.
   */
  protected async setStep(step: ReleaseStep, status: string): Promise<void> {
    await this.run(async () => {
      try {
        return await this.api.setStepStatus(step.id, status);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const ok = await this.confirm.ask({
            heading: this.transloco.translate('releases.step.outOfOrderHeading'),
            message: this.transloco.translate('releases.step.outOfOrderBody', { title: step.title }),
            confirmLabel: this.transloco.translate('releases.step.outOfOrderConfirm'),
            tone: 'primary',
          });
          if (!ok) return null;
          return await this.api.setStepStatus(step.id, status, { force: true });
        }
        throw error;
      }
    });
  }

  protected async removeStep(step: ReleaseStep): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('releases.step.removeHeading'),
      message: this.transloco.translate('releases.step.removeBody', { title: step.title }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    await this.run(() => this.api.removeStep(step.id));
  }

  protected async remove(): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('releases.component.removeHeading'),
      message: this.transloco.translate('releases.component.removeBody', { name: this.component().name }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    await this.run(() => this.api.removeComponent(this.component().id));
  }

  protected async setTest(item: ReleaseWorkItem, status: string): Promise<void> {
    if (status === item.testStatus) return;
    await this.run(() => this.api.setWorkItemTest(item.id, status));
  }

  protected async setVerify(item: ReleaseWorkItem, status: string): Promise<void> {
    if (status === item.verifyStatus) return;
    await this.run(() => this.api.setWorkItemVerify(item.id, status));
  }

  /**
   * Every mutation returns the whole release, so the parent replaces its state
   * outright rather than patching a row — one tick can move the step, the
   * component and the release at once.
   */
  private async run(action: () => Promise<ReleaseDetail | null>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const release = await action();
      if (release) this.updated.emit(release);
    } catch (error) {
      // Inline, next to the thing that failed — a toast would be gone in four
      // seconds and this is the screen people stare at while it matters.
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
