import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { formatBytes, timeAgo, type WidgetThread as Thread } from '@trackly/core';
import { Alert, Button, Icon, RichTextView, SkeletonDirective, Spinner } from '@trackly/ui';

/**
 * A conversation, and the composer under it (docs/widget-plan.md § 8.1).
 *
 * Visitor messages sit right in the brand colour, agent messages left on a
 * neutral surface. Doubles as the **new conversation** view: with no thread yet
 * it is the same composer over an empty state, because the ticket is created by
 * the first send rather than by opening the view — an abandoned draft should
 * leave nothing in the queue.
 */
@Component({
  selector: 'tk-widget-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Button,
    Icon,
    RichTextView,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <div class="flex h-full flex-col">
      <div #scroll class="flex-1 overflow-y-auto px-4 py-4">
        @if (loading()) {
          <div class="space-y-3" aria-hidden="true">
            <span tkSkeleton class="block h-16 w-[75%] rounded-2xl"></span>
            <span tkSkeleton class="ml-auto block h-12 w-[60%] rounded-2xl"></span>
            <span tkSkeleton class="block h-20 w-[80%] rounded-2xl"></span>
          </div>
        } @else if (error()) {
          <tk-alert tone="danger" [heading]="'widget.thread.loadFailed' | transloco">
            {{ error() }}
            <button type="button" class="ml-1 font-semibold underline" (click)="retry.emit()">
              {{ 'common.retry' | transloco }}
            </button>
          </tk-alert>
        } @else if (thread(); as t) {
          <ul class="space-y-3">
            @for (message of t.messages; track message.id) {
              <li class="flex" [class.justify-end]="!message.fromAgent">
                <div class="max-w-[85%]">
                  <div
                    class="rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed"
                    [class]="message.fromAgent ? agentBubble : visitorBubble"
                  >
                    <tk-rich-text [value]="message.body" [format]="message.bodyFormat" />

                    @if (message.attachments.length) {
                      <ul class="mt-2 space-y-1">
                        @for (file of message.attachments; track file.id) {
                          <li>
                            <a
                              class="flex items-center gap-1.5 text-[12px] underline underline-offset-2"
                              [href]="fileUrl()(file.id)"
                              target="_blank"
                              rel="noopener"
                            >
                              <tk-icon name="paperclip" [size]="13" />
                              <span class="truncate">{{ file.fileName }}</span>
                              <span class="opacity-70">{{ size(file.sizeBytes) }}</span>
                            </a>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                  <p
                    class="mt-1 px-1 text-[11px] text-muted-foreground"
                    [class.text-right]="!message.fromAgent"
                    [title]="message.createdAt"
                  >
                    @if (message.fromAgent && message.authorName) {
                      {{ message.authorName }} ·
                    }
                    {{ ago(message.createdAt) }}
                  </p>
                </div>
              </li>
            }
          </ul>
        } @else {
          <!-- The new-conversation view: a thread that does not exist yet. -->
          <div class="flex h-full flex-col items-center justify-center px-6 text-center">
            <span
              class="flex h-14 w-14 items-center justify-center rounded-full bg-primary/12 text-primary-ink"
              aria-hidden="true"
            >
              <tk-icon name="message-square" [size]="26" />
            </span>
            <p class="mt-3 text-[16px] font-semibold text-foreground">
              {{ 'widget.thread.newHeading' | transloco }}
            </p>
            <p class="mt-1 text-[13px] text-muted-foreground">
              {{ 'widget.thread.newBody' | transloco }}
            </p>
          </div>
        }
      </div>

      @if (sendError(); as failure) {
        <div class="px-4 pb-2">
          <tk-alert tone="danger">{{ failure }}</tk-alert>
        </div>
      }

      <div class="border-t border-border px-3 py-3">
        @if (pendingFile(); as file) {
          <div
            class="mb-2 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground"
          >
            <tk-icon name="paperclip" [size]="14" />
            <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
            <button
              type="button"
              class="rounded p-0.5 hover:text-foreground"
              [attr.aria-label]="'widget.thread.removeFile' | transloco"
              (click)="clearFile()"
            >
              <tk-icon name="x" [size]="14" />
            </button>
          </div>
        }

        <div class="flex items-end gap-2">
          <label class="sr-only" for="widget-composer">
            {{ 'widget.thread.composerLabel' | transloco }}
          </label>
          <textarea
            id="widget-composer"
            rows="1"
            class="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl bg-muted px-3 py-2.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            [placeholder]="'widget.thread.placeholder' | transloco"
            [disabled]="sending()"
            [(ngModel)]="draft"
            (keydown)="onKeydown($event)"
          ></textarea>

          <button
            type="button"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted disabled:opacity-40"
            [attr.aria-label]="'widget.thread.attach' | transloco"
            [disabled]="sending() || !thread()"
            (click)="picker.click()"
          >
            <tk-icon name="paperclip" [size]="18" />
          </button>
          <input #picker type="file" class="hidden" (change)="onFile($event)" />

          @if (showSendButton()) {
            <button
              tkButton
              iconOnly
              class="shrink-0"
              [attr.aria-label]="'widget.thread.send' | transloco"
              [disabled]="sending() || !draft().trim()"
              (click)="send()"
            >
              @if (sending()) {
                <tk-spinner [size]="16" />
              } @else {
                <tk-icon name="send" [size]="18" />
              }
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class WidgetThread {
  readonly thread = input<Thread | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly sending = input(false);
  readonly sendError = input<string | null>(null);
  /** `show_send_button: false` hides the button and leaves Enter-to-send (§ 8.1). */
  readonly showSendButton = input(true);
  readonly fileUrl = input<(attachmentId: string) => string>(() => '');

  readonly sent = output<{ message: string; file: File | null }>();
  readonly retry = output<void>();

  protected readonly draft = signal('');
  protected readonly pendingFile = signal<File | null>(null);

  // Static strings, not interpolated classes: `bg-${…}` emits no CSS at all.
  protected readonly agentBubble = 'bg-muted text-foreground';
  protected readonly visitorBubble = 'bg-primary text-primary-foreground';

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  constructor() {
    // Follow the conversation as it grows. Reading the message count is what
    // makes this fire on a new reply rather than on every unrelated repaint.
    effect(() => {
      this.thread()?.messages.length;
      const element = this.scroll()?.nativeElement;
      if (element) queueMicrotask(() => (element.scrollTop = element.scrollHeight));
    });
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Enter sends, Shift+Enter is a newline — and Enter must keep inserting one
    // while an IME is mid-composition, or every CJK visitor sends half a word.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingFile.set(input.files?.[0] ?? null);
    input.value = '';
  }

  protected clearFile(): void {
    this.pendingFile.set(null);
  }

  protected send(): void {
    const message = this.draft().trim();
    if (!message || this.sending()) return;
    this.sent.emit({ message, file: this.pendingFile() });
    this.draft.set('');
    this.pendingFile.set(null);
  }
}
