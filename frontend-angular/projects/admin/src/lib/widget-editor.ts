import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  TicketsApi,
  WidgetAdminApi,
  errorMessage,
  type Team,
  type VerifyJwtResult,
  type WidgetDetail,
  type WorkspaceBranding,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Field,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Switch,
  Tabs,
  ToastService,
  type TabItem,
} from '@trackly/ui';
import { WidgetPreview } from './widget-preview';

type Tab = 'configuration' | 'branding' | 'integration';

/**
 * Admin → Widget → one widget (docs/widget-plan.md § 8.2).
 *
 * <h3>One screen, two records</h3>
 * Configuration and Integration edit the **widget** row. Branding edits
 * `workspace_branding`, which the login page, the portal, the knowledge base and
 * the header of every outbound email also wear — so that tab says so in plain
 * words. Per-widget branding was rejected in § 4.2 because none of those surfaces
 * has a widget token to resolve, and "which widget brands the emails?" is a worse
 * question than the one screen it would save.
 *
 * The one field that spans both: **Widget theme** overrides the workspace's
 * primary colour for this widget alone. Empty means inherit.
 */
@Component({
  selector: 'tk-admin-widget-editor',
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
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Switch,
    Tabs,
    WidgetPreview,
  ],
  templateUrl: './widget-editor.html',
})
export class AdminWidgetEditor {
  readonly id = input.required<string>();

  private readonly api = inject(WidgetAdminApi);
  private readonly tickets = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  protected readonly widget = signal<WidgetDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly branding = signal<WorkspaceBranding | null>(null);
  protected readonly teams = signal<Team[]>([]);

  protected readonly tab = signal<Tab>('configuration');
  protected readonly tabs = computed<TabItem[]>(() => {
    this.transloco.getActiveLang();
    return [
      { id: 'configuration', label: this.transloco.translate('admin.widget.tabs.configuration'), icon: 'settings' },
      { id: 'branding', label: this.transloco.translate('admin.widget.tabs.branding'), icon: 'palette' },
      { id: 'integration', label: this.transloco.translate('admin.widget.tabs.integration'), icon: 'code' },
    ];
  });

  // ---- Configuration form --------------------------------------------------

  protected readonly name = signal('');
  protected readonly tagline = signal('');
  protected readonly greeting = signal('');
  protected readonly teamId = signal('');
  protected readonly primaryColor = signal('');
  protected readonly isActive = signal(true);
  protected readonly hideLauncher = signal(false);
  protected readonly launchWidget = signal(false);
  protected readonly showWidgetForm = signal(true);
  protected readonly showCloseButton = signal(true);
  protected readonly showSendButton = signal(true);
  protected readonly identityVerificationEnabled = signal(false);
  protected readonly requireEmailVerification = signal(false);
  protected readonly allowedOrigins = signal('');

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  // ---- Branding form -------------------------------------------------------

  protected readonly brandColor = signal('#2563EB');
  protected readonly pageTitle = signal('');
  protected readonly welcomeText = signal('');
  protected readonly footerText = signal('');
  protected readonly hidePoweredBy = signal(false);
  protected readonly savingBranding = signal(false);
  protected readonly uploadingLogo = signal(false);

  // ---- Secret key ----------------------------------------------------------

  /**
   * The plaintext key, shown once and never fetched again. Arrives either in the
   * navigation state (straight after Create) or from Regenerate.
   */
  protected readonly plainSecret = signal<string | null>(null);
  protected readonly regenerating = signal(false);

  protected readonly jwtInput = signal('');
  protected readonly jwtResult = signal<VerifyJwtResult | null>(null);
  protected readonly verifying = signal(false);

  /** Web or the mobile SDK — the Integration tab's inner switch. */
  protected readonly platform = signal<'web' | 'mobile'>('web');

  // Literal strings. `'chip-' + state` compiles to no CSS at all in Tailwind v4.
  protected readonly chipClass =
    'rounded-full border border-border px-3 py-1 text-meta font-semibold text-muted-foreground transition hover:border-primary';
  protected readonly chipActiveClass =
    'rounded-full border border-primary bg-primary px-3 py-1 text-meta font-semibold text-primary-foreground';

  /** What the preview should paint: the widget's own colour, else the workspace's. */
  protected readonly effectiveColour = computed(
    () => this.primaryColor().trim() || this.brandColor() || '#2563EB',
  );

  constructor() {
    const state = (this.router.getCurrentNavigation()?.extras.state
      ?? (typeof history !== 'undefined' ? history.state : null)) as Record<string, unknown> | null;
    const secret = state?.['secretKey'];
    if (typeof secret === 'string') this.plainSecret.set(secret);

    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loadError.set(null);
    try {
      const [widget, branding, teams] = await Promise.all([
        this.api.get(id),
        this.api.branding(),
        this.tickets.teams().catch(() => [] as Team[]),
      ]);
      this.widget.set(widget);
      this.branding.set(branding);
      this.teams.set(teams);
      this.fill(widget, branding);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    }
  }

  private fill(widget: WidgetDetail, branding: WorkspaceBranding): void {
    this.name.set(widget.name);
    this.tagline.set(widget.tagline ?? '');
    this.greeting.set(widget.greeting ?? '');
    this.teamId.set(widget.teamId ?? '');
    this.primaryColor.set(widget.primaryColor ?? '');
    this.isActive.set(widget.isActive);
    this.hideLauncher.set(widget.hideLauncher);
    this.launchWidget.set(widget.launchWidget);
    this.showWidgetForm.set(widget.showWidgetForm);
    this.showCloseButton.set(widget.showCloseButton);
    this.showSendButton.set(widget.showSendButton);
    this.identityVerificationEnabled.set(widget.identityVerificationEnabled);
    this.requireEmailVerification.set(widget.requireEmailVerification);
    this.allowedOrigins.set(widget.allowedOrigins.join('\n'));

    this.brandColor.set(branding.primaryColor);
    this.pageTitle.set(branding.pageTitle ?? '');
    this.welcomeText.set(branding.welcomeText ?? '');
    this.footerText.set(branding.footerText ?? '');
    this.hidePoweredBy.set(branding.hidePoweredBy);
  }

  // ---- Saving --------------------------------------------------------------

  protected async save(): Promise<void> {
    if (!this.name().trim()) {
      this.saveError.set(this.transloco.translate('admin.widget.nameRequired'));
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const colour = this.primaryColor().trim();
      const updated = await this.api.update(this.id(), {
        name: this.name().trim(),
        tagline: this.tagline().trim() || null,
        greeting: this.greeting().trim() || null,
        isActive: this.isActive(),
        teamId: this.teamId() || undefined,
        clearTeam: !this.teamId(),
        primaryColor: colour || undefined,
        clearPrimaryColor: !colour,
        hideLauncher: this.hideLauncher(),
        launchWidget: this.launchWidget(),
        showWidgetForm: this.showWidgetForm(),
        showCloseButton: this.showCloseButton(),
        showSendButton: this.showSendButton(),
        identityVerificationEnabled: this.identityVerificationEnabled(),
        requireEmailVerification: this.requireEmailVerification(),
        // One per line in the box, because a comma is a legal character almost
        // everywhere else and an admin pasting a list should not have to think.
        allowedOrigins: this.allowedOrigins()
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      this.widget.set(updated);
      this.toast.success(this.transloco.translate('admin.widget.saved'));
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async saveBranding(): Promise<void> {
    this.savingBranding.set(true);
    try {
      this.branding.set(
        await this.api.saveBranding({
          primaryColor: this.brandColor(),
          pageTitle: this.pageTitle().trim() || null,
          welcomeText: this.welcomeText().trim() || null,
          footerText: this.footerText().trim() || null,
          hidePoweredBy: this.hidePoweredBy(),
        }),
      );
      this.toast.success(this.transloco.translate('admin.widget.brandingSaved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.savingBranding.set(false);
    }
  }

  protected async uploadLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploadingLogo.set(true);
    try {
      this.branding.set(await this.api.uploadLogo(file));
      this.toast.success(this.transloco.translate('admin.widget.logoUploaded'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.uploadingLogo.set(false);
    }
  }

  // ---- Secret --------------------------------------------------------------

  protected async regenerate(): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.widget.regenerateHeading'),
      message: this.transloco.translate('admin.widget.regenerateBody'),
      confirmLabel: this.transloco.translate('admin.widget.regenerate'),
      tone: 'danger',
    });
    if (!ok) return;

    this.regenerating.set(true);
    try {
      const result = await this.api.regenerateSecret(this.id());
      this.widget.set(result.widget);
      this.plainSecret.set(result.secretKey);
      this.jwtResult.set(null);
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.regenerating.set(false);
    }
  }

  protected async verifyJwt(): Promise<void> {
    const token = this.jwtInput().trim();
    if (!token) return;
    this.verifying.set(true);
    try {
      this.jwtResult.set(await this.api.verifyJwt(this.id(), token));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.verifying.set(false);
    }
  }

  protected claimRows(result: VerifyJwtResult): { key: string; value: string }[] {
    return Object.entries(result.claims).map(([key, value]) => ({ key, value }));
  }

  // ---- Delete --------------------------------------------------------------

  protected async remove(): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.widget.deleteHeading'),
      message: this.transloco.translate('admin.widget.deleteBody', { name: this.name() }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await this.api.remove(this.id());
      this.toast.success(this.transloco.translate('admin.widget.deleted'));
      await this.router.navigate(['/admin/widget']);
    } catch (error) {
      this.toast.error(errorMessage(error));
    }
  }

  // ---- Clipboard -----------------------------------------------------------

  protected async copy(value: string | null | undefined): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.transloco.translate('common.copied'));
    } catch {
      this.toast.error(this.transloco.translate('common.copyFailed'));
    }
  }
}
