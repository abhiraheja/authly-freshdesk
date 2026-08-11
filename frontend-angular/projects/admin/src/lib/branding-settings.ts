import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  BrandingApi,
  LOGO_ACCEPT,
  LOGO_ASPECT,
  MAX_IMAGE_BYTES,
  MAX_SIGN_IN_IMAGE_BYTES,
  SIGN_IN_IMAGE_ACCEPT,
  SIGN_IN_IMAGE_ASPECT,
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
  ImageCropper,
  InputDirective,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
  isCroppable,
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
 * The text and colour fields save together on the button. Uploads save as soon
 * as the crop is confirmed — they are files, there is nothing to reconcile, and
 * an image that sat unsaved behind a button an admin never pressed would be a
 * worse surprise than one that lands immediately.
 *
 * <h3>Framed on the way in</h3>
 * Both assets go through {@link ImageCropper} before upload, at the ratio the
 * surface actually renders them at. Without it the browser cropped on display,
 * so an admin uploading a portrait photograph got its middle band and no say in
 * which band. SVG and GIF skip the cropper — see `isCroppable` for why.
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
    ImageCropper,
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
  protected readonly logoAspect = LOGO_ASPECT;
  protected readonly imageAspect = SIGN_IN_IMAGE_ASPECT;

  /** A picked file waiting to be framed. Non-null is what opens the cropper. */
  protected readonly pendingLogo = signal<File | null>(null);
  protected readonly pendingImage = signal<File | null>(null);

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
   * The mock's two shapes, mirroring `AuthLayout`.
   *
   * With artwork the panel is a fixed-width column the shape of the crop, so
   * `object-cover` fills it without trimming — 272 is 340 × the crop ratio, and
   * 340 is the row's minimum height. Without artwork it is the old even split,
   * which is what the gradient panel is drawn for.
   *
   * Literal strings, never assembled: Tailwind v4 emits only the classes it can
   * find written out.
   */
  protected readonly previewGridClass = computed(() =>
    this.signInImageUrl()
      ? 'grid bg-white sm:min-h-[340px] sm:grid-cols-[1fr_auto]'
      : 'grid bg-white sm:min-h-[340px] sm:grid-cols-2',
  );

  protected readonly previewPanelClass = computed(() =>
    this.signInImageUrl()
      ? 'relative hidden h-full w-[272px] sm:block'
      : 'relative hidden h-full min-h-[220px] sm:block',
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

  // ---- Uploads -------------------------------------------------------------
  //
  // Pick → crop → send. The crop step is what makes the stored image the shape
  // the UI renders it at, instead of leaving `object-cover` to take the middle
  // band of a portrait photograph at display time.
  //
  // The size cap is checked *after* the crop, not before: re-encoding a phone
  // photograph at 512px routinely takes 4 MB down to under 200 kB, so rejecting
  // it on its original size would refuse a file that was about to be fine. Type
  // is still checked up front, because no amount of cropping turns a PDF into a
  // logo.

  private readonly logoAsset = {
    busy: this.uploadingLogo,
    maxBytes: MAX_IMAGE_BYTES,
    types: 'PNG, SVG, JPEG, WEBP',
    send: (file: File) => this.api.uploadLogo(file),
  };

  private readonly imageAsset = {
    busy: this.uploadingImage,
    maxBytes: MAX_SIGN_IN_IMAGE_BYTES,
    types: 'PNG, JPEG, WEBP, GIF',
    send: (file: File) => this.api.uploadSignInImage(file),
  };

  protected pickLogo(event: Event): void {
    const file = this.take(event, LOGO_ACCEPT, this.logoAsset.types);
    if (!file) return;
    if (isCroppable(file)) this.pendingLogo.set(file);
    else void this.send(file, this.logoAsset);
  }

  protected pickSignInImage(event: Event): void {
    const file = this.take(event, SIGN_IN_IMAGE_ACCEPT, this.imageAsset.types);
    if (!file) return;
    if (isCroppable(file)) this.pendingImage.set(file);
    else void this.send(file, this.imageAsset);
  }

  protected croppedLogo(file: File): void {
    this.pendingLogo.set(null);
    void this.send(file, this.logoAsset);
  }

  protected croppedSignInImage(file: File): void {
    this.pendingImage.set(null);
    void this.send(file, this.imageAsset);
  }

  /** The picked file if its type is acceptable, else null with the reason shown. */
  private take(event: Event, accept: string, types: string): File | null {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset first: without it, re-picking the same file after an error is silent.
    input.value = '';
    if (!file) return null;

    const reason = checkFile(file, { accept });
    if (reason) {
      this.uploadError.set(
        this.transloco.translate(`upload.rejected.${reason}`, { name: file.name, types }),
      );
      return null;
    }
    this.uploadError.set(null);
    return file;
  }

  private async send(
    file: File,
    asset: {
      busy: ReturnType<typeof signal<boolean>>;
      maxBytes: number;
      types: string;
      send: (file: File) => Promise<WorkspaceBranding>;
    },
  ): Promise<void> {
    // A courtesy check — it turns a round trip ending in a 413 into an instant
    // message. The API re-checks regardless.
    if (file.size > asset.maxBytes) {
      this.uploadError.set(
        this.transloco.translate('upload.rejected.tooLarge', {
          name: file.name,
          limit: formatBytes(asset.maxBytes),
        }),
      );
      return;
    }

    this.uploadError.set(null);
    asset.busy.set(true);
    try {
      this.branding.set(await asset.send(file));
      this.toast.success(this.transloco.translate('admin.branding.uploaded'));
    } catch (error) {
      this.uploadError.set(errorMessage(error));
    } finally {
      asset.busy.set(false);
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
