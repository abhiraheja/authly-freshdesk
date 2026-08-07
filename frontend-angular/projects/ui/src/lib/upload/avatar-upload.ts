import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, checkFile, formatBytes } from '@trackly/core';
import { Avatar } from '../avatar/avatar';
import { Spinner } from '../feedback/feedback';
import { Icon } from '../icon/icon';

/**
 * A person's photo, with the picker built into the avatar itself.
 *
 * Clicking the avatar opens the file dialog — the same target that already shows
 * the current photo, so there is nothing to hunt for. The camera badge is the
 * affordance; it stays visible rather than appearing on hover, because on a
 * touch screen there is no hover and the control would be invisible.
 *
 * ```html
 * <tk-avatar-upload
 *   [name]="displayName()" [imageUrl]="person.avatarUrl"
 *   [uploading]="uploadingPhoto()"
 *   (selected)="uploadPhoto($event)" (removed)="removePhoto()" />
 * ```
 *
 * The parent uploads. This shows the chosen file immediately as a local preview
 * so the new photo lands the instant it is picked, then hands back to
 * `imageUrl` once `uploading` goes false — success or failure, the preview is
 * dropped and whatever the server says is true wins.
 */
@Component({
  selector: 'tk-avatar-upload',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon, Spinner, TranslocoPipe],
  host: { class: 'inline-block' },
  template: `
    <div class="avatar-upload">
      <label
        class="avatar-upload-target"
        [class.is-disabled]="disabled()"
        [attr.aria-label]="'upload.changePhoto' | transloco"
      >
        <input
          type="file"
          class="sr-only"
          [accept]="accept()"
          [disabled]="disabled() || uploading()"
          (change)="onPick($event)"
        />
        <tk-avatar [name]="name()" [imageUrl]="shown()" [size]="size()" round />

        @if (uploading()) {
          <span class="avatar-upload-veil">
            <tk-spinner [size]="20" />
          </span>
        } @else if (!disabled()) {
          <span class="avatar-upload-badge" aria-hidden="true">
            <tk-icon name="camera" [size]="14" />
          </span>
        }
      </label>

      @if (shown() && !disabled() && !uploading()) {
        <button type="button" class="avatar-upload-remove" (click)="removed.emit()">
          {{ 'upload.removePhoto' | transloco }}
        </button>
      }
    </div>

    @if (message()) {
      <p class="field-error text-center" role="alert">{{ message() }}</p>
    }
  `,
})
export class AvatarUpload {
  private readonly transloco = inject(TranslocoService);

  readonly name = input<string | null>('');
  readonly imageUrl = input<string | null>(null);
  readonly size = input(96);
  readonly accept = input(IMAGE_ACCEPT);
  readonly maxBytes = input(MAX_IMAGE_BYTES);
  readonly uploading = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Server-side failure, shown in place of any local validation message. */
  readonly error = input<string>();

  readonly selected = output<File>();
  readonly removed = output<void>();

  private readonly preview = signal<string | null>(null);
  private readonly localError = signal<string | null>(null);

  protected readonly message = computed(() => this.error() || this.localError());
  protected readonly shown = computed(() => this.preview() ?? this.imageUrl());

  constructor() {
    // An object URL is a document-lifetime handle on the file's bytes. Nothing
    // frees it automatically, so navigating away mid-upload would leak the whole
    // image until a reload.
    inject(DestroyRef).onDestroy(() => this.revoke());

    // The upload has settled. Whether it saved or failed, the server's answer is
    // now the truth and the optimistic copy has to go.
    effect(() => {
      if (!this.uploading() && this.preview()) this.revoke();
    });
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset first: without it, re-picking the same file after an error is silent.
    input.value = '';
    if (!file) return;

    const reason = checkFile(file, { maxBytes: this.maxBytes(), accept: this.accept() });
    if (reason) {
      this.localError.set(
        this.transloco.translate(`upload.rejected.${reason}`, {
          name: file.name,
          limit: formatBytes(this.maxBytes()),
          types: 'PNG, JPEG, WEBP',
        }),
      );
      return;
    }

    this.localError.set(null);
    this.revoke();
    this.preview.set(URL.createObjectURL(file));
    this.selected.emit(file);
  }

  private revoke(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
  }
}
