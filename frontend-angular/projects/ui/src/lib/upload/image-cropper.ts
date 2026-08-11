import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';
import { Spinner } from '../feedback/feedback';
import { Modal } from '../overlay/modal';

/**
 * File types that must be uploaded untouched.
 *
 * **SVG** is a vector document — rasterising it to crop would throw away the one
 * property it was chosen for, and a logo that stays crisp from a favicon to an
 * email header is exactly why the logo endpoints accept SVG at all.
 *
 * **GIF** may be animated, and a canvas can only ever capture the first frame.
 * Silently turning someone's animation into a still is worse than not offering
 * to crop it.
 */
const UNCROPPABLE = ['image/svg+xml', 'image/gif'];

/** Whether {@link ImageCropper} can do anything useful with this file. */
export function isCroppable(file: File): boolean {
  return !UNCROPPABLE.includes(file.type.toLowerCase());
}

/**
 * Crop-before-upload, so an image is framed at the size it will be shown at
 * rather than framed by `object-cover` after the fact.
 *
 * <h3>Why this exists</h3>
 * Every surface that displays one of these has a fixed shape — a square for a
 * logo, a tall panel for the sign-in artwork — and the browser cropped to it on
 * render. That meant an admin uploading a portrait photo saw the middle band of
 * it and had no way to say "keep the top". The crop moves to upload time, where
 * there is a picture to look at and a decision to make.
 *
 * <h3>Shown at the target ratio, always</h3>
 * The viewport is `aspect` exactly, and the image is scaled to *cover* it, so
 * what is inside the frame is what gets stored — there is no letterboxing and no
 * second crop later. Pan by dragging, zoom with the slider or the wheel; the
 * offsets are clamped so the frame can never show empty space.
 *
 * <h3>The size check runs after, not before</h3>
 * Cropping and re-encoding almost always shrinks a file, so a 4 MB phone
 * photograph can land inside a 1 MB logo cap. Rejecting it up front on its
 * original size would refuse a file this component was about to make acceptable
 * — so the caller checks the *type* before opening this, and the size after.
 *
 * ```html
 * @if (pending(); as file) {
 *   <tk-image-cropper
 *     [file]="file" [aspect]="1" [outputWidth]="512"
 *     [heading]="'admin.branding.cropLogo' | transloco"
 *     (cropped)="upload($event)" (cancelled)="pending.set(null)" />
 * }
 * ```
 */
@Component({
  selector: 'tk-image-cropper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, Modal, Spinner, TranslocoPipe],
  template: `
    <!-- Deliberately not persistent: Esc, the backdrop and the X all cancel.
         Losing a crop position costs one re-pick, and a dialog with a dead close
         button costs more than that. -->
    <tk-modal size="wide" [open]="open()" [heading]="heading()" (openChange)="onOpenChange($event)">
      <p class="mb-3 text-meta text-muted-foreground">{{ 'upload.crop.hint' | transloco }}</p>

      <div class="flex flex-col items-center gap-4">
        <!-- The frame IS the output. Anything outside it is discarded, which is
             why it is drawn as a hard edge rather than a hint. -->
        <div
          class="relative cursor-grab touch-none overflow-hidden rounded-xl border border-border bg-muted active:cursor-grabbing"
          [style.width.px]="viewportWidth()"
          [style.height.px]="viewportHeight()"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerUp($event)"
          (wheel)="onWheel($event)"
        >
          @if (source(); as src) {
            <img
              [src]="src"
              alt=""
              draggable="false"
              class="pointer-events-none absolute max-w-none select-none"
              [style.width.px]="drawWidth()"
              [style.height.px]="drawHeight()"
              [style.left.px]="offsetX()"
              [style.top.px]="offsetY()"
            />
          } @else {
            <span class="grid size-full place-items-center">
              <tk-spinner [size]="20" />
            </span>
          }
        </div>

        <label class="flex w-full max-w-[320px] items-center gap-3">
          <tk-icon name="image" [size]="14" class="shrink-0 text-muted-foreground" />
          <input
            type="range"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            min="1"
            max="4"
            step="0.01"
            [attr.aria-label]="'upload.crop.zoom' | transloco"
            [value]="zoom()"
            (input)="onZoom($event)"
          />
          <tk-icon name="image" [size]="20" class="shrink-0 text-muted-foreground" />
        </label>
      </div>

      @if (error(); as message) {
        <p class="field-error mt-3" role="alert">{{ message }}</p>
      }

      <div modal-footer>
        <button tkButton variant="ghost" type="button" [disabled]="busy()" (click)="cancel()">
          {{ 'common.cancel' | transloco }}
        </button>
        <button tkButton type="button" [disabled]="busy() || !source()" (click)="apply()">
          @if (busy()) {
            <tk-spinner [size]="16" />
          }
          {{ 'upload.crop.apply' | transloco }}
        </button>
      </div>
    </tk-modal>
  `,
})
export class ImageCropper {
  private readonly transloco = inject(TranslocoService);

  /** The picked file. Set it to open the cropper; it is never mutated. */
  readonly file = input.required<File>();
  /** Width ÷ height of the frame — 1 for a logo, 0.8 for the sign-in panel. */
  readonly aspect = input(1);
  /** Longest edge of the exported image. Height follows from `aspect`. */
  readonly outputWidth = input(512);
  readonly heading = input('');

  /** The cropped file, named after the original so the server logs still read. */
  readonly cropped = output<File>();
  readonly cancelled = output<void>();

  protected readonly open = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly source = signal<string | null>(null);
  private readonly natural = signal<{ width: number; height: number } | null>(null);

  protected readonly zoom = signal(1);
  protected readonly offsetX = signal(0);
  protected readonly offsetY = signal(0);

  /** 420 on the long edge — big enough to judge a face, small enough to fit. */
  protected readonly viewportWidth = computed(() =>
    this.aspect() >= 1 ? 420 : Math.round(420 * this.aspect()),
  );
  protected readonly viewportHeight = computed(() =>
    this.aspect() >= 1 ? Math.round(420 / this.aspect()) : 420,
  );

  /**
   * The scale at which the image exactly covers the frame. Everything else is a
   * multiple of it, so zoom 1 is always "no empty space" rather than a number
   * that means something different for every picture.
   */
  private readonly coverScale = computed(() => {
    const size = this.natural();
    if (!size) return 1;
    return Math.max(this.viewportWidth() / size.width, this.viewportHeight() / size.height);
  });

  protected readonly drawWidth = computed(() =>
    Math.round((this.natural()?.width ?? 0) * this.coverScale() * this.zoom()),
  );
  protected readonly drawHeight = computed(() =>
    Math.round((this.natural()?.height ?? 0) * this.coverScale() * this.zoom()),
  );

  private drag: { pointerId: number; x: number; y: number } | null = null;

  /** Kept for the canvas draw — re-decoding on apply would be a second load. */
  private readonly decoded = new Image();
  private objectUrl: string | null = null;

  constructor() {
    // An object URL is a document-lifetime handle on the file's bytes; nothing
    // frees it automatically, so a cancelled crop would leak the whole image.
    inject(DestroyRef).onDestroy(() => this.revoke());

    // An effect rather than the constructor body: a required input has no value
    // until the first change detection has run. Re-running on a new `file` is
    // the correct behaviour anyway, so nothing has to guard against it.
    effect(() => {
      const file = this.file();
      this.revoke();

      const url = URL.createObjectURL(file);
      this.objectUrl = url;
      this.decoded.onload = () => {
        this.natural.set({ width: this.decoded.naturalWidth, height: this.decoded.naturalHeight });
        this.source.set(url);
        this.centre();
      };
      this.decoded.onerror = () =>
        this.error.set(this.transloco.translate('upload.crop.decodeFailed'));
      this.decoded.src = url;
    });
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  // ---- Framing -------------------------------------------------------------

  private centre(): void {
    this.offsetX.set(Math.round((this.viewportWidth() - this.drawWidth()) / 2));
    this.offsetY.set(Math.round((this.viewportHeight() - this.drawHeight()) / 2));
  }

  /** Never let the frame show past an edge — that would export empty pixels. */
  private clamp(): void {
    this.offsetX.update((x) => Math.min(0, Math.max(this.viewportWidth() - this.drawWidth(), x)));
    this.offsetY.update((y) => Math.min(0, Math.max(this.viewportHeight() - this.drawHeight(), y)));
  }

  protected onZoom(event: Event): void {
    this.setZoom(Number((event.target as HTMLInputElement).value));
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setZoom(this.zoom() * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  /** Zooms about the centre of the frame, so the subject does not drift away. */
  private setZoom(next: number): void {
    const clamped = Math.min(4, Math.max(1, next));
    const before = { w: this.drawWidth(), h: this.drawHeight() };
    this.zoom.set(clamped);
    this.offsetX.update((x) => x - (this.drawWidth() - before.w) / 2);
    this.offsetY.update((y) => y - (this.drawHeight() - before.h) / 2);
    this.clamp();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.source()) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.offsetX.update((x) => x + event.clientX - drag.x);
    this.offsetY.update((y) => y + event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.clamp();
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
  }

  // ---- Export --------------------------------------------------------------

  protected async apply(): Promise<void> {
    const size = this.natural();
    if (!size || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      this.cropped.emit(await this.render(size));
      this.open.set(false);
    } catch {
      this.error.set(this.transloco.translate('upload.crop.renderFailed'));
      this.busy.set(false);
    }
  }

  private render(size: { width: number; height: number }): Promise<File> {
    const outWidth = this.outputWidth();
    const outHeight = Math.round(outWidth / this.aspect());

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('no 2d context'));

    // Screen pixels back to source pixels: the frame's top-left in image space,
    // and how much of the image the frame spans.
    const factor = this.drawWidth() / size.width;
    const sx = -this.offsetX() / factor;
    const sy = -this.offsetY() / factor;
    const sw = this.viewportWidth() / factor;
    const sh = this.viewportHeight() / factor;

    context.imageSmoothingQuality = 'high';
    context.drawImage(this.decoded, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

    // PNG in, PNG out: a logo's transparency is the whole point of the format,
    // and re-encoding it to JPEG would put a white box behind every mark.
    const original = this.file();
    const png = original.type.toLowerCase() === 'image/png';
    const type = png ? 'image/png' : 'image/jpeg';

    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(new File([blob], this.renamed(original.name, png), { type }))
            : reject(new Error('toBlob returned null')),
        type,
        0.92,
      ),
    );
  }

  /** Keeps the original stem so an admin recognises what they uploaded. */
  private renamed(name: string, png: boolean): string {
    const stem = name.replace(/\.[^.]+$/, '') || 'image';
    return `${stem}.${png ? 'png' : 'jpg'}`;
  }

  protected cancel(): void {
    this.open.set(false);
  }

  protected onOpenChange(open: boolean): void {
    this.open.set(open);
    if (!open && !this.busy()) this.cancelled.emit();
  }
}
