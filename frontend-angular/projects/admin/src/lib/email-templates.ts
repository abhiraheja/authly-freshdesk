import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EmailApi, errorMessage, formatDateTime, settled, type EmailTemplateSummary } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  EmptyState,
  Field,
  Icon,
  InputDirective,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Email → Templates.
 *
 * Every message Trackly sends, listed. **A row is built-in until somebody edits
 * it** — nothing is seeded, so `custom` here literally means a database row
 * exists, Reset means deleting it, and a default improved in a later release
 * still reaches an install that never touched it.
 *
 * The shared layout sits in its own card above the messages because it is not
 * one of them: it is the frame the other thirteen render into, so editing it
 * changes every email at once. Filing it in the same list as "Sign-in link"
 * would invite someone to reword it the way they'd reword a message.
 *
 * **Test sends the saved template, not a built-in.** The list has no body to
 * post, so it posts none, and the server renders what is stored — see the
 * `Render` helper in `EmailTemplatesController`.
 */
@Component({
  selector: 'tk-admin-email-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Icon,
    InputDirective,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <div class="mx-auto max-w-[900px]">
      <a class="mb-3 inline-flex items-center gap-1.5 text-meta font-semibold text-muted-foreground hover:text-foreground" routerLink="/admin/settings/email">
        <tk-icon name="arrow-left" [size]="14" />
        {{ 'admin.email.title' | transloco }}
      </a>

      <h1 class="font-display text-page font-extrabold">{{ 'admin.templates.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.templates.subtitle' | transloco }}</p>

      <!-- Value first, skeleton last: a reload after a reset must not pull the
           list out from under the next click. -->
      @if (loadedData(); as all) {
        @if (all.length === 0) {
          <tk-card>
            <tk-empty-state
              icon="mail"
              [heading]="'admin.templates.emptyHeading' | transloco"
              [description]="'admin.templates.emptyBody' | transloco"
            >
              <button tkButton variant="outline" (click)="data.reload()">{{ 'common.retry' | transloco }}</button>
            </tk-empty-state>
          </tk-card>
        } @else {
          <div class="space-y-4">
            @if (result(); as outcome) {
              <tk-alert
                [tone]="outcome.ok ? 'success' : 'danger'"
                [heading]="(outcome.ok ? 'admin.templates.testPassed' : 'admin.templates.testFailed') | transloco"
              >
                {{ outcome.ok ? ('admin.templates.testPassedBody' | transloco: { to: outcome.sentTo }) : outcome.error }}
              </tk-alert>
            }

            <tk-card [heading]="'admin.templates.testHeading' | transloco" [subheading]="'admin.templates.testHint' | transloco">
              <tk-field [label]="'admin.templates.testTo' | transloco" for="test-to" [hint]="'admin.templates.testToHint' | transloco">
                <input tkInput inset id="test-to" type="email" autocomplete="off" placeholder="you@example.com" [(ngModel)]="testTo" />
              </tk-field>
            </tk-card>

            @if (layout(); as frame) {
              <tk-card [heading]="'admin.templates.layoutHeading' | transloco" [subheading]="'admin.templates.layoutHint' | transloco">
                <div class="flex flex-wrap items-center gap-2">
                  <tk-badge [tone]="frame.source === 'custom' ? 'info' : 'neutral'">{{ sourceLabel(frame) | transloco }}</tk-badge>
                  @if (frame.source === 'custom' && !frame.isActive) {
                    <tk-badge tone="warning">{{ 'admin.templates.switchedOff' | transloco }}</tk-badge>
                  }
                  @if (frame.updatedAt; as when) {
                    <span class="text-meta text-muted-foreground">{{ 'admin.templates.edited' | transloco: { date: at(when) } }}</span>
                  }

                  <span class="flex-1"></span>

                  <button tkButton variant="ghost" size="sm" [disabled]="busy() === frame.key" (click)="test(frame)">
                    @if (busy() === frame.key) {
                      <tk-spinner [size]="14" />
                    }
                    {{ 'admin.templates.test' | transloco }}
                  </button>

                  @if (frame.source === 'custom') {
                    <button tkButton variant="ghost" size="sm" [disabled]="busy() === frame.key" (click)="reset(frame)">
                      {{ 'admin.templates.reset' | transloco }}
                    </button>
                  }

                  <a tkButton variant="outline" size="sm" [routerLink]="['/admin/settings/email/templates', frame.key]">
                    {{ 'common.edit' | transloco }}
                  </a>
                </div>
              </tk-card>
            }

            <tk-card flush [heading]="'admin.templates.messagesHeading' | transloco" [subheading]="'admin.templates.messagesHint' | transloco">
              <ul class="divide-y divide-border">
                @for (template of messages(); track template.key) {
                  <li class="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
                    <div class="min-w-0 flex-1">
                      <p class="flex flex-wrap items-center gap-2 font-semibold">
                        {{ template.name }}
                        <tk-badge [tone]="template.source === 'custom' ? 'info' : 'neutral'">
                          {{ sourceLabel(template) | transloco }}
                        </tk-badge>
                        @if (template.source === 'custom' && !template.isActive) {
                          <tk-badge tone="warning">{{ 'admin.templates.switchedOff' | transloco }}</tk-badge>
                        }
                        @if (template.standalone) {
                          <tk-badge tone="neutral">{{ 'admin.templates.standaloneBadge' | transloco }}</tk-badge>
                        }
                      </p>

                      <p class="mt-0.5 text-meta text-muted-foreground">{{ template.description }}</p>

                      <!-- The subject as it is written, braces and all. Rendering
                           it would need sample data the list does not have, and a
                           half-substituted subject reads as a bug. -->
                      <p class="mt-1.5 truncate font-mono text-meta text-muted-foreground">{{ template.subject }}</p>
                    </div>

                    <div class="flex shrink-0 flex-wrap items-center gap-2">
                      <button tkButton variant="ghost" size="sm" [disabled]="busy() === template.key" (click)="test(template)">
                        @if (busy() === template.key) {
                          <tk-spinner [size]="14" />
                        }
                        {{ 'admin.templates.test' | transloco }}
                      </button>

                      @if (template.source === 'custom') {
                        <button tkButton variant="ghost" size="sm" [disabled]="busy() === template.key" (click)="reset(template)">
                          {{ 'admin.templates.reset' | transloco }}
                        </button>
                      }

                      <a tkButton variant="outline" size="sm" [routerLink]="['/admin/settings/email/templates', template.key]">
                        {{ 'common.edit' | transloco }}
                      </a>
                    </div>
                  </li>
                }
              </ul>
            </tk-card>
          </div>
        }
      } @else if (data.error()) {
        <tk-alert tone="danger" [heading]="'admin.templates.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="data.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-4">
          <span tkSkeleton class="h-28 w-full"></span>
          <span tkSkeleton class="h-24 w-full"></span>
          <span tkSkeleton class="h-96 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminEmailTemplates {
  private readonly api = inject(EmailApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly data = resource({ loader: () => this.api.templates() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedData = settled(() => this.data);

  /** Blank means the signed-in admin's own address — the server fills it in. */
  protected readonly testTo = signal('');
  protected readonly busy = signal<string | null>(null);
  protected readonly result = signal<{ ok: boolean; sentTo?: string; error?: string } | null>(null);

  protected readonly errorText = computed(() => errorMessage(this.data.error()));

  protected readonly layout = computed(() => this.loadedData()?.find((t) => t.isLayout) ?? null);
  protected readonly messages = computed(() => (this.loadedData() ?? []).filter((t) => !t.isLayout));

  protected at(value: string): string {
    return formatDateTime(value);
  }

  protected sourceLabel(template: EmailTemplateSummary): string {
    return template.source === 'custom' ? 'admin.templates.custom' : 'admin.templates.builtIn';
  }

  /**
   * Sends this template with sample data.
   *
   * The result is an alert rather than a toast: a bounce message from a relay is
   * several lines long and worth reading twice, and a toast is gone before the
   * second read.
   */
  protected async test(template: EmailTemplateSummary): Promise<void> {
    this.busy.set(template.key);
    this.result.set(null);
    try {
      // No subject and no body on purpose — that is what tells the server to
      // render what is stored rather than substituting an empty draft.
      const outcome = await this.api.testTemplate(template.key, { to: this.testTo().trim() || undefined });
      this.result.set(outcome);
    } catch (error) {
      this.result.set({ ok: false, error: errorMessage(error) });
    } finally {
      this.busy.set(null);
    }
  }

  /** Deletes the customisation. Confirmed, because it discards somebody's work. */
  protected async reset(template: EmailTemplateSummary): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.templates.resetHeading', { name: template.name }),
      message: this.transloco.translate('admin.templates.resetBody'),
      confirmLabel: this.transloco.translate('admin.templates.reset'),
      tone: 'danger',
    });
    if (!ok) return;

    this.busy.set(template.key);
    try {
      await this.api.resetTemplate(template.key);
      this.toast.success(this.transloco.translate('admin.templates.resetDone', { name: template.name }));
      this.data.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(null);
    }
  }
}
