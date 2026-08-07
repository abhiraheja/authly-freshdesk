import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  MAX_ATTACHMENT_BYTES,
  checkFile,
  formatBytes,
  type FileRejection,
} from '@trackly/core';
import { Icon } from '../icon/icon';

/**
 * The one file picker. Every upload in Trackly starts here.
 *
 * It owns the parts that were being re-written per screen and drifting: the
 * hidden input, drag-and-drop, the size/type check, the chip that shows what was
 * chosen, the remove button, and the progress bar. A caller supplies the rules
 * and receives files.
 *
 * ```html
 * <tk-file-picker [(files)]="files" [maxBytes]="MAX_ATTACHMENT_BYTES" multiple [progress]="progress()" />
 * <tk-file-picker variant="inline" [(files)]="files" accept="image/*" />
 * ```
 *
 * **It does not upload.** Uploading is an API concern and belongs in a typed
 * `*.api.ts` — this component only produces a validated `File[]`. Feed the
 * `onProgress` callback from `ApiService.upload` back in through `[progress]`.
 *
 * Client-side validation here is a courtesy, not a control: it turns a 10 MB
 * round trip ending in a 413 into an instant message. The API re-checks
 * everything, because a picker can be bypassed and a request cannot.
 */
@Component({
  selector: 'tk-file-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslocoPipe],
  host: { class: 'block' },
  template: `
    <!-- The input lives INSIDE the label, so the target is reachable by click
         and by keyboard with no JS at all. -->
    @if (showTrigger()) {
      @if (variant() === 'dropzone') {
        <label
          class="dropzone"
          [class.is-dragging]="dragging()"
          [class.is-disabled]="disabled()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
        >
          <input
            #field
            type="file"
            class="sr-only"
            [accept]="accept() ?? ''"
            [multiple]="multiple()"
            [disabled]="disabled()"
            (change)="onPick($event)"
          />
          <tk-icon name="upload-cloud" [size]="24" />
          <span class="text-body font-semibold">{{ label() || ('upload.dropHint' | transloco) }}</span>
          <span class="text-meta">{{ hintText() }}</span>
        </label>
      } @else {
        <label class="file-trigger" [class.is-disabled]="disabled()">
          <input
            #field
            type="file"
            class="sr-only"
            [accept]="accept() ?? ''"
            [multiple]="multiple()"
            [disabled]="disabled()"
            (change)="onPick($event)"
          />
          <tk-icon name="paperclip" [size]="16" />
          {{ label() || ('upload.browse' | transloco) }}
        </label>
      }
    }

    @if (files().length) {
      <ul class="file-list" [class.mt-2]="showTrigger()">
        @for (file of files(); track file) {
          <li class="file-chip">
            <tk-icon name="paperclip" [size]="15" class="shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body font-semibold">{{ file.name }}</span>
              <span class="block text-meta text-muted-foreground">{{ size(file) }}</span>
            </span>
            @if (!disabled()) {
              <button
                type="button"
                class="file-chip-remove"
                [attr.aria-label]="'upload.remove' | transloco"
                (click)="remove(file)"
              >
                <tk-icon name="x" [size]="16" />
              </button>
            }
          </li>
        }
      </ul>
    }

    <!-- -1 means the browser could not tell us a total (chunked body); an
         indeterminate bar is honest, a fake percentage is not. -->
    @if (progress() !== null) {
      <div
        class="upload-bar"
        [class.is-indeterminate]="progress()! < 0"
        role="progressbar"
        [attr.aria-valuenow]="progress()! < 0 ? null : progress()"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="100"
        [attr.aria-label]="'upload.uploading' | transloco"
      >
        <span class="upload-bar-fill" [style.width.%]="progress()! < 0 ? 100 : progress()"></span>
      </div>
    }

    @if (message()) {
      <p class="field-error" role="alert">{{ message() }}</p>
    }
  `,
})
export class FilePicker {
  private readonly transloco = inject(TranslocoService);

  /** Two-way. Always an array, even in single mode — one shape to handle. */
  readonly files = model<File[]>([]);

  readonly variant = input<'dropzone' | 'inline'>('dropzone');
  /** An `accept` attribute value: `image/*`, `.pdf`, `image/png,image/jpeg`. */
  readonly accept = input<string>();
  readonly maxBytes = input(MAX_ATTACHMENT_BYTES);
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Overrides the default trigger text. */
  readonly label = input<string>();
  /** Overrides the computed "PNG, JPEG up to 1 MB" line. */
  readonly hint = input<string>();
  /** 0-100 to show a bar, -1 for indeterminate, null to hide it. */
  readonly progress = input<number | null>(null);
  /** Shown in place of any internal rejection message — for a server error. */
  readonly error = input<string>();

  /** Fires per rejected file, after the message has already been shown. */
  readonly rejected = output<{ file: File; reason: FileRejection }>();

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly localError = signal<string | null>(null);

  protected readonly dragging = signal(false);
  protected readonly message = computed(() => this.error() || this.localError());

  /** In single mode the trigger gives way to the chip; in multi it stays. */
  protected readonly showTrigger = computed(() => this.multiple() || this.files().length === 0);

  protected readonly hintText = computed(() => {
    const custom = this.hint();
    if (custom) return custom;
    const limit = formatBytes(this.maxBytes());
    const types = describeAccept(this.accept());
    return types
      ? this.transloco.translate('upload.limitTypes', { types, limit })
      : this.transloco.translate('upload.limit', { limit });
  });

  protected size(file: File): string {
    return formatBytes(file.size);
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.take(input.files);
    // Without this, picking the same file again after removing it fires no
    // change event and the picker looks broken.
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    this.dragging.set(false);
    this.take(event.dataTransfer?.files ?? null);
  }

  protected remove(file: File): void {
    this.files.update((current) => current.filter((existing) => existing !== file));
    this.localError.set(null);
  }

  /** Drops the selection and any message. For a caller resetting a form. */
  clear(): void {
    this.files.set([]);
    this.localError.set(null);
    const input = this.field()?.nativeElement;
    if (input) input.value = '';
  }

  private take(list: FileList | null): void {
    const incoming = Array.from(list ?? []);
    if (incoming.length === 0) return;

    const accepted: File[] = [];
    const problems: string[] = [];

    for (const file of this.multiple() ? incoming : incoming.slice(0, 1)) {
      const reason = checkFile(file, { maxBytes: this.maxBytes(), accept: this.accept() });
      if (reason === null) {
        accepted.push(file);
        continue;
      }
      problems.push(
        this.transloco.translate(`upload.rejected.${reason}`, {
          name: file.name,
          limit: formatBytes(this.maxBytes()),
          types: describeAccept(this.accept()),
        }),
      );
      this.rejected.emit({ file, reason });
    }

    // Only the first problem is shown. A dropped folder can produce forty, and a
    // wall of red is less use than the one line that names a file to fix.
    this.localError.set(problems[0] ?? null);
    if (accepted.length === 0) return;

    this.files.update((current) => (this.multiple() ? [...current, ...accepted] : accepted));
  }
}

/**
 * "image/png,image/jpeg" → "PNG, JPEG". Extensions and wildcards are skipped —
 * ".pdf" reads fine already and "image/*" has no short name worth printing.
 */
function describeAccept(accept: string | undefined): string {
  const names = (accept ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.endsWith('/*'))
    .map((entry) => (entry.startsWith('.') ? entry.slice(1) : entry.split('/').pop() ?? ''))
    // "svg+xml" → "SVG": the suffix is a serialisation detail, not a file type.
    .map((entry) => entry.split('+')[0].toUpperCase())
    .filter(Boolean);
  return [...new Set(names)].join(', ');
}
