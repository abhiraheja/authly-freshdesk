import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AdminApi,
  EmailApi,
  errorMessage,
  formatDateTime,
  type EmailMode,
  type EmailProvider,
  type EmailProviderKind,
  type InboundConnector,
  type NotificationSettings,
  type Tone,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Drawer,
  Field,
  Icon,
  InputDirective,
  ProviderMark,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
} from '@trackly/ui';
import { EmailProviderForm } from './email-provider-form';

/** Which capability the grid is filtered to. */
type Capability = 'all' | 'send' | 'receive';

/**
 * Admin → Email.
 *
 * Every provider Trackly supports is a card, connected or not — a provider that
 * vanishes when unconfigured is one an admin goes hunting for. Several can hold
 * credentials at once, and *which one does the job* is a separate decision made
 * on this page, because a workspace that keeps a spare SMTP account should not
 * have to delete it to try Google for a week.
 *
 * **A provider test and the email test are different claims.** The per-card test
 * proves credentials authenticate; only a delivered message proves the
 * installation can reach a person, and only that satisfies invariant 8. So
 * changing anything here clears the delivery proof and the banner says to send
 * another test — otherwise an admin could turn off password sign-in on the
 * strength of a green tick about a relay nothing sends through.
 */
@Component({
  selector: 'tk-admin-email-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Drawer,
    Field,
    Icon,
    InputDirective,
    ProviderMark,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Switch,
    EmailProviderForm,
  ],
  template: `
    <div class="mx-auto max-w-[900px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.email.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.email.subtitle' | transloco }}</p>

      <!-- Value first, skeleton last: a reload after saving must not pull the
           page out from under whatever is being edited next. -->
      @if (data.value(); as saved) {
        <div class="space-y-4">
          @if (!saved.lastVerifiedAt) {
            <tk-alert tone="warning" [heading]="'admin.email.unprovenHeading' | transloco">
              {{ 'admin.email.unprovenBody' | transloco }}
            </tk-alert>
          }

          <tk-card [heading]="'admin.email.providers' | transloco" [subheading]="'admin.email.providersHint' | transloco">
            <!-- Static classes per branch, never 'bg-' + value: Tailwind v4
                 only sees literal strings and an interpolated class emits no
                 CSS at all. -->
            <div class="mb-4 flex flex-wrap gap-2">
              @for (chip of capabilities; track chip) {
                <button
                  type="button"
                  [class]="capability() === chip ? chipActiveClass : chipClass"
                  (click)="capability.set(chip)"
                >
                  {{ 'admin.email.filter.' + chip | transloco }}
                </button>
              }
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              @for (provider of visible(); track provider.provider) {
                <div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                  <div class="flex items-start gap-3">
                    <tk-provider-mark [name]="provider.provider" [size]="28" class="text-primary" />

                    <div class="min-w-0 flex-1">
                      <p class="flex flex-wrap items-center gap-2 font-semibold">
                        {{ provider.displayName }}
                        <tk-badge [tone]="provider.paid ? 'warning' : 'neutral'">
                          {{ (provider.paid ? 'admin.email.paid' : 'admin.email.free') | transloco }}
                        </tk-badge>
                      </p>
                      <p class="mt-0.5 truncate text-meta text-muted-foreground">
                        {{ provider.accountEmail || (capabilityLabel(provider) | transloco) }}
                      </p>
                    </div>

                    <!-- Only a configured provider can be switched on: an
                         enabled row with no credentials is a card that claims
                         to work and cannot. -->
                    <tk-switch
                      [checked]="provider.enabled"
                      [disabled]="!provider.configured || busy() === provider.provider"
                      [ariaLabel]="'admin.email.enableAria' | transloco: { name: provider.displayName }"
                      (checkedChange)="setEnabled(provider, $event)"
                    />
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <tk-badge [tone]="statusTone(provider)" dot>{{ statusLabel(provider) | transloco }}</tk-badge>

                    @if (roleLabel(saved, provider); as role) {
                      <tk-badge tone="info">{{ role | transloco }}</tk-badge>
                    }

                    <span class="flex-1"></span>

                    @if (provider.configured && provider.canReceive) {
                      <button
                        tkButton
                        variant="ghost"
                        size="sm"
                        [disabled]="busy() === provider.provider"
                        (click)="testProvider(provider)"
                      >
                        {{ 'admin.email.testProvider' | transloco }}
                      </button>
                    }

                    <button tkButton variant="outline" size="sm" (click)="configure(provider)">
                      {{ (provider.configured ? 'common.edit' : 'admin.email.connect') | transloco }}
                    </button>
                  </div>

                  @if (provider.lastError; as failure) {
                    <p class="text-meta text-danger">{{ failure }}</p>
                  }
                </div>
              }
            </div>
          </tk-card>

          <tk-card [heading]="'admin.email.roles' | transloco" [subheading]="'admin.email.rolesHint' | transloco">
            <div class="grid gap-4 sm:grid-cols-2">
              <tk-field [label]="'admin.email.sendVia' | transloco" [hint]="'admin.email.sendViaHint' | transloco">
                <tk-select
                  inset
                  [(value)]="sendingProvider"
                  [ariaLabel]="'admin.email.sendVia' | transloco"
                  (valueChange)="saveRoles()"
                >
                  <tk-option value="" [label]="'admin.email.sharedRelay' | transloco" />
                  @for (option of senders(); track option.provider) {
                    <tk-option [value]="option.provider" [label]="option.displayName" />
                  }
                </tk-select>
              </tk-field>

              <tk-field [label]="'admin.email.receiveVia' | transloco" [hint]="'admin.email.receiveViaHint' | transloco">
                <tk-select
                  inset
                  [(value)]="receivingProvider"
                  [ariaLabel]="'admin.email.receiveVia' | transloco"
                  (valueChange)="saveRoles()"
                >
                  <tk-option value="" [label]="'admin.email.noReceiving' | transloco" />
                  @for (option of receivers(); track option.provider) {
                    <tk-option [value]="option.provider" [label]="option.displayName" />
                  }
                </tk-select>
              </tk-field>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <button tkButton variant="outline" [disabled]="testing()" (click)="sendTest()">
                @if (testing()) {
                  <tk-spinner [size]="16" />
                } @else {
                  <tk-icon name="send" [size]="16" />
                }
                {{ 'admin.email.sendTest' | transloco }}
              </button>

              @if (saved.lastVerifiedAt) {
                <span class="inline-flex items-center gap-1.5 text-meta text-success">
                  <tk-icon name="check-circle" [size]="14" />
                  {{ 'admin.email.deliveredAt' | transloco: { date: when(saved.lastVerifiedAt) } }}
                </span>
              } @else {
                <span class="text-meta text-muted-foreground">{{ 'admin.email.neverDelivered' | transloco }}</span>
              }
            </div>

            @if (testResult(); as result) {
              <tk-alert
                class="mt-3 block"
                [tone]="result.ok ? 'success' : 'danger'"
                [heading]="(result.ok ? 'admin.email.testPassed' : 'admin.email.testFailed') | transloco"
              >
                {{ result.ok ? ('admin.email.testPassedBody' | transloco: { to: result.sentTo }) : result.error }}
              </tk-alert>
            }
          </tk-card>

          @if (config.value(); as cfg) {
            <tk-card [heading]="'admin.email.identity' | transloco">
              <div class="grid gap-4 sm:grid-cols-2">
                <tk-field [label]="'admin.email.fromName' | transloco" for="from-name">
                  <input tkInput inset id="from-name" [(ngModel)]="fromName" />
                </tk-field>

                <tk-field
                  [label]="'admin.email.fromEmail' | transloco"
                  for="from-email"
                  [hint]="'admin.email.fromEmailHint' | transloco"
                >
                  <input tkInput inset id="from-email" type="email" placeholder="support@acme.com" [(ngModel)]="fromEmail" />
                </tk-field>
              </div>
            </tk-card>

            <tk-card [heading]="'admin.email.replies' | transloco">
              <div class="space-y-4">
                <tk-field [label]="'admin.email.mode' | transloco" [hint]="'admin.email.modeHint' | transloco">
                  <tk-select inset [(value)]="emailMode" [ariaLabel]="'admin.email.mode' | transloco">
                    <tk-option value="notifications_only" [label]="'admin.email.modes.notificationsOnly' | transloco" />
                    <tk-option value="one_way" [label]="'admin.email.modes.oneWay' | transloco" />
                    <tk-option value="two_way" [label]="'admin.email.modes.twoWay' | transloco" />
                  </tk-select>
                </tk-field>

                <tk-field [label]="'admin.email.inbound' | transloco" [hint]="'admin.email.inboundHint' | transloco">
                  <tk-select inset [(value)]="inboundConnector" [ariaLabel]="'admin.email.inbound' | transloco">
                    <tk-option value="" [label]="'admin.email.inboundNone' | transloco" />
                    <tk-option value="mailbox_poll" [label]="'admin.email.inboundPoll' | transloco" />
                    <tk-option value="parse_webhook" [label]="'admin.email.inboundWebhook' | transloco" />
                  </tk-select>
                </tk-field>

                @if (inboundConnector() === 'parse_webhook') {
                  <tk-field
                    [label]="'admin.email.replyDomain' | transloco"
                    for="reply-domain"
                    [hint]="'admin.email.replyDomainHint' | transloco"
                  >
                    <input tkInput inset id="reply-domain" placeholder="tickets.acme.com" [(ngModel)]="inboundReplyDomain" />
                  </tk-field>

                  <tk-field
                    [label]="'admin.email.webhookSecret' | transloco"
                    for="webhook-secret"
                    [hint]="secretHint(cfg.hasInboundWebhookSecret)"
                  >
                    <input
                      tkInput
                      inset
                      id="webhook-secret"
                      type="password"
                      autocomplete="off"
                      [placeholder]="secretPlaceholder(cfg.hasInboundWebhookSecret)"
                      [(ngModel)]="inboundWebhookSecret"
                    />
                  </tk-field>

                  <div class="rounded-xl bg-muted p-3">
                    <p class="mb-1.5 text-meta font-semibold">{{ 'admin.email.webhookUrl' | transloco }}</p>
                    <code class="block break-all text-meta text-muted-foreground">{{ webhookUrl }}</code>
                  </div>
                }

                @if (inboundConnector() === 'mailbox_poll') {
                  <tk-field
                    [label]="'admin.email.pollInterval' | transloco"
                    for="poll-interval"
                    [hint]="'admin.email.pollIntervalHint' | transloco"
                  >
                    <input tkInput inset id="poll-interval" type="number" inputmode="numeric" [(ngModel)]="pollIntervalSeconds" />
                  </tk-field>
                }

                <label class="flex items-center justify-between gap-3 border-t border-border pt-4">
                  <span>
                    <span class="block text-body">{{ 'admin.email.newTicket' | transloco }}</span>
                    <span class="block text-meta text-muted-foreground">{{ 'admin.email.newTicketHint' | transloco }}</span>
                  </span>
                  <tk-switch [(checked)]="newTicketViaEmail" [ariaLabel]="'admin.email.newTicket' | transloco" />
                </label>

                <div class="border-t border-border pt-4">
                  <button tkButton [disabled]="savingConfig()" (click)="saveConfig()">
                    @if (savingConfig()) {
                      <tk-spinner [size]="16" />
                    }
                    {{ 'common.save' | transloco }}
                  </button>
                </div>
              </div>
            </tk-card>
          }

          @if (notifications.value(); as notif) {
            <tk-card [heading]="'admin.email.notifications' | transloco" [subheading]="'admin.email.notificationsHint' | transloco">
              <div class="divide-y divide-border">
                @for (toggle of notificationToggles; track toggle.key) {
                  <label class="flex items-center justify-between gap-3 py-2.5">
                    <span class="text-body">{{ 'admin.email.notify.' + toggle.key | transloco }}</span>
                    <tk-switch
                      [checked]="notif[toggle.key]"
                      [ariaLabel]="'admin.email.notify.' + toggle.key | transloco"
                      (checkedChange)="setNotification(notif, toggle.key, $event)"
                    />
                  </label>
                }
              </div>
            </tk-card>
          }

          <!-- Inside the data branch on purpose: resource.value() throws while
               the resource is in its error state, and the drawer reads the
               provider straight off it. -->
          <tk-drawer [(open)]="drawerOpen" [heading]="editing()?.displayName ?? ''">
            @if (editing(); as provider) {
              <tk-email-provider-form [provider]="provider" />
            }

            <div drawer-footer class="flex w-full flex-wrap items-center gap-2">
              @if (editing()?.configured) {
                <button tkButton variant="danger" [disabled]="savingProvider()" (click)="disconnect()">
                  {{ 'admin.email.disconnect' | transloco }}
                </button>
              }
              <span class="flex-1"></span>
              <button tkButton variant="ghost" (click)="drawerOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
              <button tkButton [disabled]="savingProvider()" (click)="saveProvider()">
                @if (savingProvider()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'common.save' | transloco }}
              </button>
            </div>
          </tk-drawer>
        </div>
      } @else if (data.error()) {
        <tk-alert tone="danger" [heading]="'admin.email.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="data.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-4">
          <span tkSkeleton class="h-64 w-full"></span>
          <span tkSkeleton class="h-40 w-full"></span>
          <span tkSkeleton class="h-32 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminEmailSettings {
  private readonly api = inject(EmailApi);
  private readonly admin = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly data = resource({ loader: () => this.api.providers() });
  protected readonly config = resource({ loader: () => this.api.config() });
  protected readonly notifications = resource({ loader: () => this.api.notificationSettings() });

  protected readonly capabilities: Capability[] = ['all', 'send', 'receive'];
  protected readonly capability = signal<Capability>('all');

  /**
   * Literal strings, both of them. `'chip-' + state` would compile fine and
   * emit no CSS — the single most common way styling fails silently here.
   */
  protected readonly chipClass =
    'rounded-full border border-border px-3 py-1 text-meta font-semibold text-muted-foreground transition hover:border-primary';
  protected readonly chipActiveClass =
    'rounded-full border border-primary bg-primary px-3 py-1 text-meta font-semibold text-primary-foreground';

  protected readonly notificationToggles: { key: keyof NotificationSettings }[] = [
    { key: 'notifyCustomerOnCreate' },
    { key: 'notifyCustomerOnReply' },
    { key: 'notifyCustomerOnStatus' },
    { key: 'notifyAgentOnAssign' },
    { key: 'notifyAgentOnReply' },
    { key: 'notifyAgentOnReassign' },
    { key: 'csatEnabled' },
  ];

  /** `''` is the wire value for "none" — a select cannot hold null. */
  protected readonly sendingProvider = signal<string>('');
  protected readonly receivingProvider = signal<string>('');

  protected readonly fromName = signal('');
  protected readonly fromEmail = signal('');
  protected readonly emailMode = signal<string>('notifications_only');
  protected readonly inboundConnector = signal<string>('');
  protected readonly inboundReplyDomain = signal('');
  protected readonly inboundWebhookSecret = signal('');
  protected readonly pollIntervalSeconds = signal(60);
  protected readonly newTicketViaEmail = signal(false);

  protected readonly drawerOpen = signal(false);
  protected readonly editing = signal<EmailProvider | null>(null);
  protected readonly savingProvider = signal(false);
  protected readonly savingConfig = signal(false);
  protected readonly testing = signal(false);
  protected readonly busy = signal<EmailProviderKind | null>(null);
  protected readonly testResult = signal<{ ok: boolean; sentTo?: string; error?: string } | null>(null);

  private readonly form = viewChild(EmailProviderForm);

  protected readonly errorText = computed(() => errorMessage(this.data.error()));

  /** Built once here rather than in the template, which cannot read `window`. */
  protected readonly webhookUrl = `${window.location.origin}/api/email/inbound`;

  protected readonly visible = computed(() => {
    const all = this.data.value()?.providers ?? [];
    const filter = this.capability();
    if (filter === 'all') return all;
    return all.filter((p) => (filter === 'send' ? p.canSend : p.canReceive));
  });

  /** Only a provider that is configured *and* on can be given a job. */
  protected readonly senders = computed(() =>
    (this.data.value()?.providers ?? []).filter((p) => p.canSend && p.configured && p.enabled),
  );

  protected readonly receivers = computed(() =>
    (this.data.value()?.providers ?? []).filter((p) => p.canReceive && p.configured && p.enabled),
  );

  constructor() {
    effect(() => {
      const saved = this.data.value();
      if (!saved) return;
      this.sendingProvider.set(saved.sendingProvider ?? '');
      this.receivingProvider.set(saved.receivingProvider ?? '');
    });

    effect(() => {
      const cfg = this.config.value();
      if (!cfg) return;
      this.fromName.set(cfg.fromName ?? '');
      this.fromEmail.set(cfg.fromEmail ?? '');
      this.emailMode.set(cfg.emailMode);
      this.inboundConnector.set(cfg.inboundConnector ?? '');
      this.inboundReplyDomain.set(cfg.inboundReplyDomain ?? '');
      this.pollIntervalSeconds.set(cfg.pollIntervalSeconds);
      this.newTicketViaEmail.set(cfg.newTicketViaEmail);
      // Blank means keep — the server never sent it back.
      this.inboundWebhookSecret.set('');
    });
  }

  protected when(value: string): string {
    return formatDateTime(value);
  }

  protected capabilityLabel(provider: EmailProvider): string {
    if (provider.canSend && provider.canReceive) return 'admin.email.capability.both';
    return provider.canSend ? 'admin.email.capability.send' : 'admin.email.capability.receive';
  }

  protected statusTone(provider: EmailProvider): Tone {
    if (!provider.configured) return 'neutral';
    if (provider.lastError) return 'danger';
    if (!provider.enabled) return 'neutral';
    return provider.lastVerifiedAt ? 'success' : 'warning';
  }

  protected statusLabel(provider: EmailProvider): string {
    if (!provider.configured) return 'admin.email.status.notConnected';
    if (provider.lastError) return 'admin.email.status.failing';
    if (!provider.enabled) return 'admin.email.status.off';
    return provider.lastVerifiedAt ? 'admin.email.status.working' : 'admin.email.status.untested';
  }

  /** The badge that says this provider is the one actually doing a job. */
  protected roleLabel(
    saved: { sendingProvider: EmailProviderKind | null; receivingProvider: EmailProviderKind | null },
    provider: EmailProvider,
  ): string | null {
    const sends = saved.sendingProvider === provider.provider;
    const receives = saved.receivingProvider === provider.provider;
    if (sends && receives) return 'admin.email.role.both';
    if (sends) return 'admin.email.role.sending';
    if (receives) return 'admin.email.role.receiving';
    return null;
  }

  protected secretHint(stored: boolean): string {
    return this.transloco.translate(stored ? 'admin.email.storedHint' : 'admin.email.notStoredHint');
  }

  protected secretPlaceholder(stored: boolean): string {
    return stored ? this.transloco.translate('admin.email.keepPlaceholder') : '';
  }

  protected configure(provider: EmailProvider): void {
    this.editing.set(provider);
    this.drawerOpen.set(true);
  }

  protected async setEnabled(provider: EmailProvider, enabled: boolean): Promise<void> {
    this.busy.set(provider.provider);
    try {
      await this.api.saveProvider(provider.provider, { enabled });
      this.toast.success(this.transloco.translate('admin.email.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Always: the switch has to end up where the server actually has it,
      // whether the save landed or not.
      this.data.reload();
      this.busy.set(null);
    }
  }

  protected async saveProvider(): Promise<void> {
    const form = this.form();
    const provider = this.editing();
    if (!form || !provider) return;

    const invalid = form.validationError();
    if (invalid) {
      this.toast.error(invalid);
      return;
    }

    this.savingProvider.set(true);
    try {
      // Enabled on save: an admin who just typed a working password meant to
      // use it, and a card that stays off afterwards reads as a failed save.
      await this.api.saveProvider(provider.provider, { ...form.body(), enabled: true });
      this.drawerOpen.set(false);
      this.data.reload();
      this.toast.success(this.transloco.translate('admin.email.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.savingProvider.set(false);
    }
  }

  protected async disconnect(): Promise<void> {
    const provider = this.editing();
    if (!provider) return;

    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('admin.email.disconnectHeading'),
      message: this.transloco.translate('admin.email.disconnectBody', { name: provider.displayName }),
      confirmLabel: this.transloco.translate('admin.email.disconnect'),
      tone: 'danger',
    });
    if (!confirmed) return;

    this.savingProvider.set(true);
    try {
      await this.api.disconnect(provider.provider);
      this.drawerOpen.set(false);
      this.data.reload();
      this.toast.success(this.transloco.translate('admin.email.disconnected'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.savingProvider.set(false);
    }
  }

  protected async testProvider(provider: EmailProvider): Promise<void> {
    this.busy.set(provider.provider);
    try {
      const result = await this.api.testProvider(provider.provider);
      if (result.ok) this.toast.success(this.transloco.translate('admin.email.providerTestPassed'));
      else this.toast.error(result.error ?? this.transloco.translate('admin.email.testFailed'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.data.reload();
      this.busy.set(null);
    }
  }

  protected async saveRoles(): Promise<void> {
    try {
      await this.api.setRoles({
        sendingProvider: (this.sendingProvider() || null) as EmailProviderKind | null,
        receivingProvider: (this.receivingProvider() || null) as EmailProviderKind | null,
      });
      this.toast.success(this.transloco.translate('admin.email.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Reload either way — the server refuses roles it cannot honour, and the
      // selects must show what it kept, not what was asked for.
      this.data.reload();
    }
  }

  protected async saveConfig(): Promise<void> {
    this.savingConfig.set(true);
    try {
      await this.api.saveConfig({
        fromName: this.fromName().trim() || null,
        fromEmail: this.fromEmail().trim() || null,
        emailMode: this.emailMode() as EmailMode,
        newTicketViaEmail: this.newTicketViaEmail(),
        inboundConnector: (this.inboundConnector() || null) as InboundConnector | null,
        inboundReplyDomain: this.inboundReplyDomain().trim() || null,
        // Undefined, not '': blank keeps the stored secret, '' deletes it.
        inboundWebhookSecret: this.inboundWebhookSecret() || undefined,
        pollIntervalSeconds: this.pollIntervalSeconds(),
      });
      this.config.reload();
      // The From address is part of what a delivered test proved, so the
      // server cleared the proof — the banner has to catch up.
      this.data.reload();
      this.toast.success(this.transloco.translate('admin.email.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.savingConfig.set(false);
    }
  }

  protected async setNotification(
    current: NotificationSettings,
    key: keyof NotificationSettings,
    value: boolean,
  ): Promise<void> {
    try {
      await this.api.saveNotificationSettings({ ...current, [key]: value });
      this.toast.success(this.transloco.translate('admin.email.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.notifications.reload();
    }
  }

  /**
   * The one test that counts: a real message, through whatever is designated,
   * to the admin's own address. Only this writes the delivery proof invariant 8
   * reads before it will let password sign-in be switched off.
   */
  protected async sendTest(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const result = await this.admin.testEmail();
      this.testResult.set(result);
      if (result.ok) this.data.reload();
    } catch (error) {
      this.testResult.set({ ok: false, error: errorMessage(error) });
    } finally {
      this.testing.set(false);
    }
  }
}
