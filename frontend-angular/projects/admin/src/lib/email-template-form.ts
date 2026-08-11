import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EmailApi, errorMessage, settled, type EmailTemplateDetail } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Field,
  Icon,
  InputDirective,
  SkeletonDirective,
  Spinner,
  Switch,
  Tabs,
  ToastService,
  type TabItem,
} from '@trackly/ui';

/** The three fields a render depends on. */
interface Draft {
  readonly subject: string;
  readonly bodyHtml: string;
  readonly standalone: boolean;
}

/**
 * Admin → Email → Templates → one template.
 *
 * A plain `<textarea>` of HTML, on purpose. A WYSIWYG editor would have to
 * round-trip table layouts and inline styles that exist because Outlook needs
 * them, and it would quietly rewrite them — so the box shows exactly what will
 * be stored and the preview shows exactly what will be sent.
 *
 * **The preview is rendered by the server.** It goes through the same code path
 * as production mail, so it cannot drift; a JavaScript reimplementation would be
 * a second engine that started disagreeing with the first at the worst possible
 * moment. It lands in a sandboxed `<iframe>` rather than `[innerHTML]` because
 * Angular's sanitiser would strip the inline styles and show a preview that does
 * not match what customers receive — which is worse than no preview at all.
 */
@Component({
  selector: 'tk-admin-email-template-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Field,
    Icon,
    InputDirective,
    SkeletonDirective,
    Spinner,
    Switch,
    Tabs,
  ],
  template: `
    <div class="mx-auto max-w-[1180px]">
      <a
        class="mb-3 inline-flex items-center gap-1.5 text-meta font-semibold text-muted-foreground hover:text-foreground"
        routerLink="/admin/settings/email/templates"
      >
        <tk-icon name="arrow-left" [size]="14" />
        {{ 'admin.templates.title' | transloco }}
      </a>

      @if (loadedData(); as template) {
        <div class="mb-5 flex flex-wrap items-start gap-x-3 gap-y-2">
          <div class="min-w-0 flex-1">
            <h1 class="font-display text-page font-extrabold">{{ template.name }}</h1>
            <p class="mt-1 text-body text-muted-foreground">{{ template.description }}</p>
          </div>
          <tk-badge [tone]="template.source === 'custom' ? 'info' : 'neutral'">
            {{ (template.source === 'custom' ? 'admin.templates.custom' : 'admin.templates.builtIn') | transloco }}
          </tk-badge>
        </div>

        @if (saveError(); as failure) {
          <tk-alert class="mb-4 block" tone="danger" [heading]="'admin.templates.saveFailed' | transloco">{{ failure }}</tk-alert>
        }

        @if (testResult(); as outcome) {
          <tk-alert
            class="mb-4 block"
            [tone]="outcome.ok ? 'success' : 'danger'"
            [heading]="(outcome.ok ? 'admin.templates.testPassed' : 'admin.templates.testFailed') | transloco"
          >
            {{ outcome.ok ? ('admin.templates.testPassedBody' | transloco: { to: outcome.sentTo }) : outcome.error }}
          </tk-alert>
        }

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_264px]">
          <div class="min-w-0 space-y-4">
            <tk-card [heading]="'admin.templates.contentHeading' | transloco">
              <div class="space-y-4">
                @if (!template.isLayout) {
                  <tk-field [label]="'admin.templates.subject' | transloco" for="tpl-subject">
                    <input
                      tkInput
                      inset
                      id="tpl-subject"
                      #subjectInput
                      class="font-mono"
                      autocomplete="off"
                      [value]="subject()"
                      (focus)="focused.set('subject')"
                      (input)="onSubject($event)"
                    />
                  </tk-field>
                }

                <tk-field
                  [label]="'admin.templates.body' | transloco"
                  for="tpl-body"
                  [hint]="'admin.templates.bodyHint' | transloco"
                >
                  <textarea
                    tkInput
                    inset
                    id="tpl-body"
                    #bodyInput
                    rows="20"
                    spellcheck="false"
                    class="font-mono text-meta leading-relaxed"
                    [value]="bodyHtml()"
                    (focus)="focused.set('body')"
                    (input)="onBody($event)"
                  ></textarea>
                </tk-field>

                @if (!template.isLayout) {
                  <label class="flex items-center justify-between gap-3 border-t border-border pt-4">
                    <span>
                      <span class="block text-body">{{ 'admin.templates.standalone' | transloco }}</span>
                      <span class="block text-meta text-muted-foreground">{{ 'admin.templates.standaloneHint' | transloco }}</span>
                    </span>
                    <tk-switch
                      [checked]="standalone()"
                      [ariaLabel]="'admin.templates.standalone' | transloco"
                      (checkedChange)="onStandalone($event)"
                    />
                  </label>
                }

                <label class="flex items-center justify-between gap-3 border-t border-border pt-4">
                  <span>
                    <span class="block text-body">{{ 'admin.templates.useCustom' | transloco }}</span>
                    <span class="block text-meta text-muted-foreground">{{ 'admin.templates.useCustomHint' | transloco }}</span>
                  </span>
                  <tk-switch [(checked)]="isActive" [ariaLabel]="'admin.templates.useCustom' | transloco" />
                </label>
              </div>

              <div card-footer class="flex flex-wrap items-center gap-2 border-t border-border p-4">
                <button tkButton [disabled]="saving()" (click)="save(template)">
                  @if (saving()) {
                    <tk-spinner [size]="16" />
                  }
                  {{ 'common.save' | transloco }}
                </button>

                <button tkButton variant="ghost" [disabled]="!dirty(template)" (click)="revert(template)">
                  {{ 'admin.templates.revert' | transloco }}
                </button>

                <span class="flex-1"></span>

                @if (template.source === 'custom') {
                  <button tkButton variant="danger" [disabled]="saving()" (click)="reset(template)">
                    {{ 'admin.templates.reset' | transloco }}
                  </button>
                }
              </div>
            </tk-card>

            <tk-card
              [heading]="'admin.templates.previewHeading' | transloco"
              [subheading]="'admin.templates.previewHint' | transloco"
            >
              <tk-tabs class="mb-3" [tabs]="tabs()" [(active)]="tab" panelId="tpl-preview" />

              <div id="tpl-preview" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
                @if (loadedPreview(); as rendered) {
                  @if (rendered.error) {
                    <tk-alert tone="danger" [heading]="'admin.templates.previewFailed' | transloco">{{ rendered.error }}</tk-alert>
                  } @else {
                    @if (!template.isLayout) {
                      <p class="mb-2 truncate text-meta">
                        <span class="text-muted-foreground">{{ 'admin.templates.renderedSubject' | transloco }}</span>
                        <span class="ml-1 font-semibold">{{ rendered.subject }}</span>
                      </p>
                    }

                    @switch (tab()) {
                      @case ('text') {
                        <pre class="max-h-[560px] overflow-auto rounded-xl bg-muted p-4 font-mono text-meta whitespace-pre-wrap">{{ rendered.text }}</pre>
                      }
                      @default {
                        <!-- Sandboxed with no allow-scripts and no
                             allow-same-origin: the body was sanitised on the way
                             in, and this is what makes rendering it safe anyway. -->
                        <iframe
                          class="h-[560px] w-full rounded-xl border border-border bg-white"
                          sandbox=""
                          referrerpolicy="no-referrer"
                          [title]="'admin.templates.previewHeading' | transloco"
                          [srcdoc]="frame()"
                        ></iframe>
                      }
                    }
                  }
                } @else if (preview.error()) {
                  <tk-alert tone="danger" [heading]="'admin.templates.previewFailed' | transloco">
                    {{ previewError() }}
                    <button type="button" class="ml-1 font-semibold underline" (click)="preview.reload()">
                      {{ 'common.retry' | transloco }}
                    </button>
                  </tk-alert>
                } @else {
                  <span tkSkeleton class="block h-[560px] w-full"></span>
                }
              </div>

              <div card-footer class="flex flex-wrap items-end gap-3 border-t border-border p-4">
                <tk-field
                  class="min-w-[240px] flex-1"
                  [label]="'admin.templates.testTo' | transloco"
                  for="tpl-test-to"
                  [hint]="'admin.templates.testDraftHint' | transloco"
                >
                  <input tkInput inset id="tpl-test-to" type="email" autocomplete="off" placeholder="you@example.com" [(ngModel)]="testTo" />
                </tk-field>

                <button tkButton variant="outline" [disabled]="testing()" (click)="test()">
                  @if (testing()) {
                    <tk-spinner [size]="16" />
                  } @else {
                    <tk-icon name="send" [size]="16" />
                  }
                  {{ 'admin.templates.test' | transloco }}
                </button>
              </div>
            </tk-card>
          </div>

          <tk-card
            class="lg:sticky lg:top-4 lg:self-start"
            [heading]="'admin.templates.variablesHeading' | transloco"
            [subheading]="'admin.templates.variablesHint' | transloco"
          >
            @if (template.variables.length > 0) {
              <p class="mb-1.5 text-meta font-semibold text-muted-foreground">{{ 'admin.templates.thisTemplate' | transloco }}</p>
              <div class="mb-4 flex flex-wrap gap-1.5">
                @for (name of template.variables; track name) {
                  <button
                    type="button"
                    [class]="template.required.includes(name) ? requiredChip : chip"
                    [title]="
                      (template.required.includes(name) ? 'admin.templates.requiredHint' : 'admin.templates.insertHint') | transloco
                    "
                    (click)="insert(name)"
                  >
                    {{ name }}
                    @if (template.required.includes(name)) {
                      <span aria-hidden="true">*</span>
                    }
                  </button>
                }
              </div>
            }

            <p class="mb-1.5 text-meta font-semibold text-muted-foreground">{{ 'admin.templates.everywhere' | transloco }}</p>
            <div class="flex flex-wrap gap-1.5">
              @for (name of template.globalVariables; track name) {
                <button type="button" [class]="chip" [title]="'admin.templates.insertHint' | transloco" (click)="insert(name)">
                  {{ name }}
                </button>
              }
            </div>

            @if (template.required.length > 0) {
              <p class="mt-4 border-t border-border pt-3 text-meta text-muted-foreground">
                {{ 'admin.templates.requiredNote' | transloco: { names: requiredNames(template) } }}
              </p>
            }

            <p class="mt-3 text-meta text-muted-foreground">{{ 'admin.templates.escapingNote' | transloco }}</p>
          </tk-card>
        </div>
      } @else if (data.error()) {
        <tk-alert tone="danger" [heading]="'admin.templates.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="data.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_264px]">
          <span tkSkeleton class="h-[620px] w-full"></span>
          <span tkSkeleton class="h-64 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminEmailTemplateForm {
  private readonly api = inject(EmailApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly sanitizer = inject(DomSanitizer);

  /** Bound from the route by `withComponentInputBinding`. */
  readonly key = input.required<string>();

  protected readonly data = resource({
    params: () => ({ key: this.key() }),
    loader: ({ params }) => this.api.template(params.key),
  });

  protected readonly subject = signal('');
  protected readonly bodyHtml = signal('');
  protected readonly standalone = signal(false);
  protected readonly isActive = signal(true);

  /** `string`, not a union — `tk-tabs` owns a `model<string>` and writes into this. */
  protected readonly tab = signal('html');
  protected readonly testTo = signal('');
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly testResult = signal<{ ok: boolean; sentTo?: string; error?: string } | null>(null);

  /** Which box a variable click lands in. */
  protected readonly focused = signal<'subject' | 'body'>('body');

  private readonly subjectRef = viewChild<ElementRef<HTMLInputElement>>('subjectInput');
  private readonly bodyRef = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');

  /**
   * Literal strings, both of them. `'chip-' + state` compiles fine and emits no
   * CSS — Tailwind v4 only ever sees the literals in the source.
   */
  protected readonly chip =
    'rounded-md border border-border bg-muted px-2 py-1 font-mono text-meta text-muted-foreground transition hover:border-primary hover:text-foreground';
  protected readonly requiredChip =
    'rounded-md border border-primary bg-muted px-2 py-1 font-mono text-meta font-semibold text-primary transition hover:bg-accent';

  /** What the preview last asked for. Debounced, so typing doesn't flood the API. */
  private readonly previewDraft = signal<Draft | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly preview = resource({
    params: () => {
      const draft = this.previewDraft();
      return draft ? { key: this.key(), draft } : undefined;
    },
    loader: ({ params }) => this.api.previewTemplate(params.key, params.draft),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedData = settled(() => this.data);
  protected readonly loadedPreview = settled(() => this.preview);

  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly previewError = computed(() => errorMessage(this.preview.error()));

  protected readonly tabs = computed<TabItem[]>(() => [
    { id: 'html', label: this.transloco.translate('admin.templates.tabHtml'), icon: 'code' },
    { id: 'text', label: this.transloco.translate('admin.templates.tabText'), icon: 'file-text' },
  ]);

  /**
   * The rendered HTML, trusted for `srcdoc`.
   *
   * Trusted rather than sanitised because Angular's sanitiser strips the inline
   * styles an HTML email is made of, which would show a preview that does not
   * match what is sent. The body was already sanitised server-side on save, and
   * the `sandbox` attribute — no scripts, no same-origin — is what contains
   * anything that survived.
   */
  protected readonly frame = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.loadedPreview()?.html ?? ''),
  );

  constructor() {
    effect(() => {
      const template = this.loadedData();
      if (!template) return;
      this.hydrate(template);
    });
  }

  protected dirty(template: EmailTemplateDetail): boolean {
    return (
      this.subject() !== template.subject ||
      this.bodyHtml() !== template.bodyHtml ||
      this.standalone() !== template.standalone ||
      this.isActive() !== template.isActive
    );
  }

  protected requiredNames(template: EmailTemplateDetail): string {
    return template.required.map((name) => `{{${name}}}`).join(', ');
  }

  protected onSubject(event: Event): void {
    this.subject.set((event.target as HTMLInputElement).value);
    this.schedulePreview();
  }

  protected onBody(event: Event): void {
    this.bodyHtml.set((event.target as HTMLTextAreaElement).value);
    this.schedulePreview();
  }

  protected onStandalone(value: boolean): void {
    this.standalone.set(value);
    this.schedulePreview();
  }

  /**
   * Drops a variable in at the cursor of whichever box was last focused.
   *
   * The element's `value` is written before the signal so the caret can be
   * restored in the same tick — waiting for change detection to push the new
   * text down would put the cursor at the end of the body every time.
   */
  protected insert(name: string): void {
    const intoSubject = this.focused() === 'subject';
    const element = intoSubject ? this.subjectRef()?.nativeElement : this.bodyRef()?.nativeElement;
    if (!element) return;

    const token = `{{${name}}}`;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = element.value.slice(0, start) + token + element.value.slice(end);

    element.value = next;
    if (intoSubject) this.subject.set(next);
    else this.bodyHtml.set(next);

    const caret = start + token.length;
    element.focus();
    element.setSelectionRange(caret, caret);
    this.schedulePreview();
  }

  protected async save(template: EmailTemplateDetail): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.api.saveTemplate(template.key, {
        subject: template.isLayout ? null : this.subject(),
        bodyHtml: this.bodyHtml(),
        standalone: this.standalone(),
        isActive: this.isActive(),
      });
      this.toast.success(this.transloco.translate('admin.templates.saved'));
      this.data.reload();
    } catch (error) {
      // An alert, not a toast: the server's refusals here name a variable that
      // has to go back in, and that is a sentence worth re-reading.
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Throws away unsaved edits — the stored template, not the built-in. */
  protected revert(template: EmailTemplateDetail): void {
    this.hydrate(template);
    this.saveError.set(null);
  }

  protected async reset(template: EmailTemplateDetail): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.templates.resetHeading', { name: template.name }),
      message: this.transloco.translate('admin.templates.resetBody'),
      confirmLabel: this.transloco.translate('admin.templates.reset'),
      tone: 'danger',
    });
    if (!ok) return;

    this.saving.set(true);
    try {
      await this.api.resetTemplate(template.key);
      this.toast.success(this.transloco.translate('admin.templates.resetDone', { name: template.name }));
      await this.router.navigate(['/admin/settings/email/templates']);
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Sends what is on screen, saved or not — so a rewrite can be read in a real client first. */
  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      this.testResult.set(
        await this.api.testTemplate(this.key(), {
          to: this.testTo().trim() || undefined,
          subject: this.subject(),
          bodyHtml: this.bodyHtml(),
          standalone: this.standalone(),
        }),
      );
    } catch (error) {
      this.testResult.set({ ok: false, error: errorMessage(error) });
    } finally {
      this.testing.set(false);
    }
  }

  /**
   * Fills the form from a loaded template.
   *
   * Reads nothing off the signals it writes — deliberately. This runs inside the
   * effect that watches the resource, and a signal *read* there would make every
   * keystroke a dependency: the effect would re-run and put the stored text back
   * as fast as anyone could type over it.
   */
  private hydrate(template: EmailTemplateDetail): void {
    this.subject.set(template.subject);
    this.bodyHtml.set(template.bodyHtml);
    this.standalone.set(template.standalone);
    this.isActive.set(template.isActive);

    // Straight through, not debounced: there is nothing to wait for on load.
    clearTimeout(this.previewTimer);
    this.previewDraft.set({
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      standalone: template.standalone,
    });
  }

  private schedulePreview(): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.previewDraft.set(this.draft()), 400);
  }

  private draft(): Draft {
    return { subject: this.subject(), bodyHtml: this.bodyHtml(), standalone: this.standalone() };
  }
}
