import { TranslocoPipe } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { formatBytes } from '@trackly/core';
import { Icon } from '../icon/icon';

/**
 * One attachment as this component needs it.
 *
 * Deliberately not the `Attachment` API type: the design system stays free of
 * the ticket domain, and the caller is the only thing that knows how to turn an
 * id into a URL (a session route, a guest route with a token). Map at the call
 * site.
 */
export interface AttachmentItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Where the bytes are. Used for both the thumbnail and the download. */
  url: string;
}

/**
 * Attachments under a message, or as a list. **One presentation everywhere:** a
 * compact row — thumbnail, name, size — that opens the image full size.
 *
 * There used to be a second one: images rendered as large inline previews under
 * the message, on the argument that a filename says nothing about a screenshot.
 * True, and a 14rem picture beside the word "test" still turned a reply into an
 * attachment with a caption. The row keeps the useful half — you can see at a
 * glance that it is a screenshot rather than a PDF — and costs one line instead
 * of ten. The picture is a click away, which is where it belongs.
 *
 * ```html
 * <tk-attachment-list [items]="attachmentsOf(comment)" [dark]="isAgentReply(comment)" />
 * ```
 */
@Component({
  selector: 'tk-attachment-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslocoPipe],
  host: { class: 'block' },
  template: `
    @if (items().length) {
      <div class="attachment-rows">
        @for (file of items(); track file.id) {
          <!-- Still a real <a> even though a plain click is intercepted: that is
               what keeps Ctrl/⌘-click, middle-click and "copy link address"
               working, which a <button> would silently take away. -->
          <a
            class="attachment-row"
            [class.is-image]="showsImage(file)"
            [class.on-dark]="dark()"
            [href]="file.url"
            [title]="file.fileName"
            target="_blank"
            rel="noopener"
            (click)="onRowClick(file, $event)"
          >
            @if (showsImage(file)) {
              <img
                class="attachment-row-thumb"
                [src]="file.url"
                [alt]="file.fileName"
                loading="lazy"
                (error)="onImageError(file)"
              />
            } @else {
              <span class="attachment-row-icon">
                <tk-icon name="paperclip" [size]="16" />
              </span>
            }

            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{{ file.fileName }}</span>
              <span class="attachment-row-size">{{ size(file) }}</span>
            </span>

            <!-- Only on images: it is the one kind that opens here rather than
                 downloading, and an eye beside a PDF would promise a viewer
                 Trackly does not have. -->
            @if (showsImage(file)) {
              <tk-icon name="eye" [size]="16" class="attachment-row-action" />
            }
          </a>
        }
      </div>
    }

    <!-- Full-size viewer. Its own overlay rather than tk-modal: a modal's card
         chrome, padding and heading are all things an image viewer has to fight,
         and the point here is to give the picture the whole screen. -->
    @if (viewing(); as file) {
      <div
        #viewer
        class="lightbox"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="file.fileName"
        tabindex="-1"
        (click)="viewing.set(null)"
        (keydown.escape)="viewing.set(null)"
      >
        <img class="lightbox-image" [src]="file.url" [alt]="file.fileName" (click)="$event.stopPropagation()" />
        <div class="lightbox-bar" (click)="$event.stopPropagation()">
          <span class="min-w-0 flex-1 truncate">{{ file.fileName }} · {{ size(file) }}</span>
          <a class="lightbox-action" [href]="file.url" target="_blank" rel="noopener">
            <tk-icon name="download" [size]="15" />
            {{ 'upload.openOriginal' | transloco }}
          </a>
          <button type="button" class="lightbox-action" (click)="viewing.set(null)">
            <tk-icon name="x" [size]="15" />
            {{ 'common.close' | transloco }}
          </button>
        </div>
      </div>
    }
  `,
})
export class AttachmentList {
  readonly items = input<readonly AttachmentItem[]>([]);
  /**
   * Set on a coloured message bubble so the chip stays legible.
   *
   * Named `dark`, not `onDark`: Angular rejects `on*` bindings as event handlers
   * unless the directive is already resolved, which turns a missing import into
   * a security error instead of the usual "not a known property".
   */
  readonly dark = input(false);

  protected readonly viewing = signal<AttachmentItem | null>(null);

  /**
   * Images whose bytes did not decode.
   *
   * A thumbnail can fail for reasons the content type never revealed — a
   * truncated upload, a `.png` that is really a PDF, an expired guest token. The
   * broken-image glyph is worse than no preview, so a failure demotes that file
   * to a chip, which still downloads.
   */
  private readonly broken = signal<ReadonlySet<string>>(new Set());

  private readonly viewer = viewChild<ElementRef<HTMLElement>>('viewer');

  constructor() {
    // Focus the overlay so Esc reaches it — without this the key goes to
    // whatever was focused behind and the viewer can only be closed by mouse.
    effect(() => {
      if (this.viewing()) this.viewer()?.nativeElement.focus();
    });
  }

  protected size(file: AttachmentItem): string {
    return formatBytes(file.sizeBytes);
  }

  protected showsImage(file: AttachmentItem): boolean {
    return isImage(file) && !this.broken().has(file.id);
  }

  /** Images open in the viewer; anything else the browser handles as a link. */
  protected onRowClick(file: AttachmentItem, event: MouseEvent): void {
    if (!this.showsImage(file)) return;
    // A modified click is the user asking for a new tab. Honour it.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    this.viewing.set(file);
  }

  protected onImageError(file: AttachmentItem): void {
    this.broken.update((current) => new Set(current).add(file.id));
    // Close the viewer if the failure was the image it is showing, rather than
    // leaving an empty black screen.
    if (this.viewing()?.id === file.id) this.viewing.set(null);
  }
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg'];

/**
 * Content type first, extension as the fallback.
 *
 * The fallback earns its place: files that arrive by email or from a messaging
 * connector routinely carry `application/octet-stream`, and a screenshot would
 * otherwise be filed as an anonymous blob.
 */
function isImage(file: AttachmentItem): boolean {
  const type = (file.contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream') return false;

  const name = (file.fileName ?? '').toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}
