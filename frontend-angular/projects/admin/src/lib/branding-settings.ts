import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  BrandingApi,
  LOGO_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_SIGN_IN_IMAGE_BYTES,
  SIGN_IN_IMAGE_ACCEPT,
  SessionStore,
  brandingAssetUrl,
  checkFile,
  errorMessage,
  formatBytes,
  settled,
  type WorkspaceBranding,
} from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  Field,
  Icon,
  InputDirective,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
} from '@trackly/ui';

/** Offered as a starting point; the hex box is still the source of truth. */
const SWATCHES = ['#2563EB', '#4F46E5', '#0EA5E9', '#059669', '#D97706', '#DC2626', '#DB2777', '#7C3AED'];

/**
 * Admin → Branding: the workspace's visual identity.
 *
 * <h3>One record, many surfaces</h3>
 * What this screen writes is worn by the sign-in and verify screens, the portal,
 * the knowledge base, guest ticket views and the header of every email Trackly
 * sends. That reach is the whole reason it is a screen of its own again — it was
 * folded into the widget editor's Branding tab (widget-plan § 4.2) on the
 * assumption that branding was a widget concern, and it is not. A widget can
 * still override its own colour and logo, and doing so never writes back here.
 *
 * <h3>Why the preview is not decoration</h3>
 * The single most common way to get this wrong is invisible: a colour that
 * looks fine in a swatch and illegible behind white button text, or a hero image
 * whose subject sits exactly where the headline lands. Both are obvious in a
 * preview and neither is obvious in a form, so the preview updates from what is
 * typed rather than from what is saved.
 *
 * <h3>Saves are split, deliberately</h3>
 * The text and colour fields save together on the button. Uploads save on pick —
 * they are files, there is nothing to reconcile, and an image that sat unsaved
 * behind a button an admin never pressed would be a worse surprise than one that
 * lands immediately.
 */
@Component({
  selector: 'tk-admin-branding-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Button,
    Card,
    Field,
    Icon,
    InputDirective,
    SkeletonDirective,
    Spinner,
    Switch,
  ],
  templateUrl: './branding-settings.html',
})
export class AdminBrandingSettings {
  private readonly api = inject(BrandingApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly branding = resource({ loader: () => this.api.get() });

  // ---- Form ----------------------------------------------------------------

  protected readonly primaryColor = signal('#2563EB');
  protected readonly pageTitle = signal('');
  protected readonly welcomeText = signal('');
  protected readonly footerText = signal('');
  protected readonly hidePoweredBy = signal(false);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly uploadingLogo = signal(false);
  protected readonly uploadingImage = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly swatches = SWATCHES;
  protected readonly logoAccept = LOGO_ACCEPT;
  protected readonly imageAccept = SIGN_IN_IMAGE_ACCEPT;

  protected readonly loadError = computed(() => errorMessage(this.branding.error()));

  /** The workspace's own name, which is what the preview falls back to. */
  protected readonly workspaceName = computed(() => this.session.workspace()?.name ?? 'Trackly');

  /**
   * A colour Trackly will actually accept — the API insists on `#rrggbb`.
   * Anything else leaves the preview on the last good value rather than painting
   * the page with a half-typed hex.
   */
  protected readonly colourValid = computed(() => /^#[0-9a-fA-F]{6}$/.test(this.primaryColor().trim()));
  protected readonly previewColour = computed(() =>
    this.colourValid() ? this.primaryColor().trim() : '#2563EB',
  );

  protected readonly colourError = computed(() =>
    this.primaryColor().trim().length > 0 && !this.colourValid()
      ? this.transloco.translate('admin.branding.colourInvalid')
      : undefined,
  );

  /**
   * The gradient the sign-in panel derives from one colour, so an admin only
   * ever picks one. Mirrors `AuthLayout.panelBackground` — if that changes, this
   * preview stops telling the truth.
   */
  protected readonly previewPanel = computed(() => {
    const colour = this.previewColour();
    return `linear-gradient(135deg, ${colour}, color-mix(in oklab, ${colour} 55%, white))`;
  });

  /**
   * Asset URLs, versioned on `updatedAt`.
   *
   * The public endpoints answer `max-age=300`, so without the version an admin
   * would replace a logo, see the old one for five minutes, and reasonably
   * conclude the upload had failed.
   */
  protected readonly logoUrl = computed(() => {
    const saved = this.saved();
    return saved?.hasLogo ? brandingAssetUrl('logo', saved.updatedAt) : null;
  });

  protected readonly signInImageUrl = computed(() => {
    const saved = this.saved();
    return saved?.hasSignInImage ? brandingAssetUrl('sign-in-image', saved.updatedAt) : null;
  });

  /** Guarded: `resource.value()` throws while the resource is in its error state. */
  protected readonly saved = settled(() => this.branding);

  protected readonly logoLimit = computed(() =>
    this.transloco.translate('admin.branding.logoHint', { limit: formatBytes(MAX_IMAGE_BYTES) }),
  );

  protected readonly imageLimit = computed(() =>
    this.transloco.translate('admin.branding.imageHint', { limit: formatBytes(MAX_SIGN_IN_IMAGE_BYTES) }),
  );

  constructor() {
    // Re-seeds after every save, so the form is measured against fresh truth
    // rather than against what was typed.
    effect(() => {
      const saved = this.saved();
      if (!saved) return;
      this.primaryColor.set(saved.primaryColor);
      this.pageTitle.set(saved.pageTitle ?? '');
      this.welcomeText.set(saved.welcomeText ?? '');
      this.footerText.set(saved.footerText ?? '');
      this.hidePoweredBy.set(saved.hidePoweredBy);
    });
  }

  // ---- Writes --------------------------------------------------------------

  protected async save(): Promise<void> {
    if (!this.colourValid()) {
      this.saveError.set(this.transloco.translate('admin.branding.colourInvalid'));
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      this.branding.set(
        await this.api.save({
          primaryColor: this.primaryColor().trim(),
          pageTitle: this.pageTitle().trim() || null,
          welcomeText: this.welcomeText().trim() || null,
          footerText: this.footerText().trim() || null,
          hidePoweredBy: this.hidePoweredBy(),
        }),
      );
      this.toast.success(this.transloco.translate('admin.branding.saved'));
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected uploadLogo(event: Event): void {
    void this.upload(event, {
      busy: this.uploadingLogo,
      maxBytes: MAX_IMAGE_BYTES,
      accept: LOGO_ACCEPT,
      types: 'PNG, SVG, JPEG, WEBP',
      send: (file) => this.api.uploadLogo(file),
    });
  }

  protected uploadSignInImage(event: Event): void {
    void this.upload(event, {
      busy: this.uploadingImage,
      maxBytes: MAX_SIGN_IN_IMAGE_BYTES,
      accept: SIGN_IN_IMAGE_ACCEPT,
      types: 'PNG, JPEG, WEBP, GIF',
      send: (file) => this.api.uploadSignInImage(file),
    });
  }

  private async upload(
    event: Event,
    options: {
      busy: ReturnType<typeof signal<boolean>>;
      maxBytes: number;
      accept: string;
      types: string;
      send: (file: File) => Promise<WorkspaceBranding>;
    },
  ): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset first: without it, re-picking the same file after an error is silent.
    input.value = '';
    if (!file) return;

    // Checked here as a courtesy — it turns a 5 MB round trip ending in a 413
    // into an instant message. The API re-checks regardless.
    const reason = checkFile(file, { maxBytes: options.maxBytes, accept: options.accept });
    if (reason) {
      this.uploadError.set(
        this.transloco.translate(`upload.rejected.${reason}`, {
          name: file.name,
          limit: formatBytes(options.maxBytes),
          types: options.types,
        }),
      );
      return;
    }

    this.uploadError.set(null);
    options.busy.set(true);
    try {
      this.branding.set(await options.send(file));
      this.toast.success(this.transloco.translate('admin.branding.uploaded'));
    } catch (error) {
      this.uploadError.set(errorMessage(error));
    } finally {
      options.busy.set(false);
    }
  }

  protected async removeLogo(): Promise<void> {
    await this.clear(this.uploadingLogo, () => this.api.removeLogo());
  }

  protected async removeSignInImage(): Promise<void> {
    await this.clear(this.uploadingImage, () => this.api.removeSignInImage());
  }

  private async clear(
    busy: ReturnType<typeof signal<boolean>>,
    send: () => Promise<WorkspaceBranding>,
  ): Promise<void> {
    busy.set(true);
    this.uploadError.set(null);
    try {
      this.branding.set(await send());
      this.toast.success(this.transloco.translate('admin.branding.removed'));
    } catch (error) {
      this.uploadError.set(errorMessage(error));
    } finally {
      busy.set(false);
    }
  }
}
