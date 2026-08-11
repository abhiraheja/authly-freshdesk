import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  BrandingApi,
  LOGO_ACCEPT,
  MAX_IMAGE_BYTES,
  TicketsApi,
  WidgetAdminApi,
  brandingAssetUrl,
  checkFile,
  errorMessage,
  formatBytes,
  widgetLogoUrl,
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
 * <h3>One record — this widget's</h3>
 * Every tab here writes `widget_configs` and nothing else. The Branding tab used
 * to edit `workspace_branding` in place (§ 4.2), which meant changing a colour
 * for one embedded widget silently repainted the sign-in page, the portal, the
 * knowledge base and the header of every outbound email. That is reversed: the
 * workspace record is edited at `/admin/settings/branding`, and this screen can
 * only ever override the two fields a widget genuinely owns — its colour and its
 * logo.
 *
 * <h3>Null means inherit</h3>
 * Both overrides are nullable, and empty is a real state rather than a default
 * copied down: an unset colour follows the workspace's forever, including after
 * someone changes it. So the workspace values are loaded read-only, shown
 * underneath each field as what you would get by clearing it, and never written.
 * A failure to load them must not take the editor down — hence `.catch`.
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
  /** Read-only here. The workspace record is written on its own screen. */
  private readonly brandingApi = inject(BrandingApi);
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

  // ---- Branding (this widget's own) ----------------------------------------

  protected readonly uploadingLogo = signal(false);
  protected readonly logoError = signal<string | null>(null);

  protected readonly logoAccept = LOGO_ACCEPT;
  protected readonly logoLimit = computed(() => {
    this.transloco.getActiveLang();
    return this.transloco.translate('admin.widget.logoHint', { limit: formatBytes(MAX_IMAGE_BYTES) });
  });

  /** What the workspace would give this widget if both overrides were cleared. */
  protected readonly workspaceColour = computed(() => this.branding()?.primaryColor ?? '#2563EB');

  protected readonly workspaceLogoUrl = computed(() => {
    const record = this.branding();
    return record?.hasLogo ? brandingAssetUrl('logo', record.updatedAt) : null;
  });

  protected readonly widgetLogoUrl = computed(() => {
    const w = this.widget();
    return w?.hasLogo ? widgetLogoUrl(w.publicToken, w.updatedAt) : null;
  });

  /** Whatever the visitor actually sees, override or inherited. */
  protected readonly effectiveLogoUrl = computed(() => this.widgetLogoUrl() ?? this.workspaceLogoUrl());

  /**
   * Read-only, and only so the preview tells the truth. "Powered by Trackly" is
   * workspace-wide — a widget cannot turn it off for itself.
   */
  protected readonly hidePoweredBy = computed(() => this.branding()?.hidePoweredBy ?? false);

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
    () => this.primaryColor().trim() || this.workspaceColour(),
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
      // Only the widget itself is load-bearing. The workspace defaults and the
      // team list are context: without them the fields still edit correctly, and
      // failing the whole screen over "what colour would I inherit" would be a
      // worse trade than showing the fallback.
      const [widget, branding, teams] = await Promise.all([
        this.api.get(id),
        this.brandingApi.get().catch(() => null),
        this.tickets.teams().catch(() => [] as Team[]),
      ]);
      this.widget.set(widget);
      this.branding.set(branding);
      this.teams.set(teams);
      this.fill(widget);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    }
  }

  private fill(widget: WidgetDetail): void {
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

  // ---- This widget's logo --------------------------------------------------
  // Writes `widget_configs.logo_storage_key` and nothing else. Removing it here
  // falls back to the workspace logo; it never deletes the workspace's.
  //
  // Files save on pick rather than waiting for Update, matching the branding
  // screen: there is nothing to reconcile, and an image sitting unsaved behind a
  // button is a worse surprise than one that lands straight away.

  protected async uploadLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset first, or re-picking the same file after an error does nothing.
    input.value = '';
    if (!file) return;

    const reason = checkFile(file, { maxBytes: MAX_IMAGE_BYTES, accept: LOGO_ACCEPT });
    if (reason) {
      this.logoError.set(
        this.transloco.translate(`upload.rejected.${reason}`, {
          name: file.name,
          limit: formatBytes(MAX_IMAGE_BYTES),
          types: 'PNG, SVG, JPEG, WEBP',
        }),
      );
      return;
    }

    this.logoError.set(null);
    this.uploadingLogo.set(true);
    try {
      this.widget.set(await this.api.uploadLogo(this.id(), file));
      this.toast.success(this.transloco.translate('admin.widget.logoUploaded'));
    } catch (error) {
      this.logoError.set(errorMessage(error));
    } finally {
      this.uploadingLogo.set(false);
    }
  }

  protected async removeLogo(): Promise<void> {
    this.logoError.set(null);
    this.uploadingLogo.set(true);
    try {
      this.widget.set(await this.api.removeLogo(this.id()));
      this.toast.success(this.transloco.translate('admin.widget.logoCleared'));
    } catch (error) {
      this.logoError.set(errorMessage(error));
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
