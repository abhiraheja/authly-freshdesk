import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { formatDateTime, type ChatMessage, type ChatSender } from '@trackly/core';
import { Avatar } from '../avatar/avatar';

/**
 * A live-chat transcript, from one side or the other.
 *
 * Shared by the agent console and the visitor window rather than written twice:
 * the two are the same conversation, and the only thing that differs is which
 * side "mine" is on. `viewer` is that one difference.
 *
 * **It scrolls itself.** A chat that does not follow the newest line is a chat
 * where people miss replies — so every render pins to the bottom. There is no
 * "you have unread messages" affordance because the window is small enough that
 * the bottom is always where you want to be.
 */
@Component({
  selector: 'tk-chat-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <div #scroller class="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
      @for (message of messages(); track message.id) {
        @if (message.sender === 'system') {
          <!-- Trackly's own line. Centred and quiet: it is stage direction, not
               somebody talking. -->
          <p class="py-1 text-center text-meta text-muted-foreground">{{ message.body }}</p>
        } @else {
          @let mine = message.sender === viewer();
          <article class="flex items-end gap-2" [class.flex-row-reverse]="mine">
            <tk-avatar [name]="who(message)" [size]="26" round class="shrink-0" />
            <div class="flex min-w-0 flex-col" [class.items-end]="mine" [class.items-start]="!mine">
              <div
                class="max-w-full px-3.5 py-2 text-body sm:max-w-[26rem]"
                [class]="mine ? 'rounded-2xl rounded-br-md bg-primary text-primary-foreground' : 'rounded-2xl rounded-bl-md border border-border bg-card'"
              >
                <p class="whitespace-pre-wrap break-words">{{ message.body }}</p>
              </div>
              <p class="mt-1 px-1 text-micro text-muted-foreground">{{ who(message) }} · {{ at(message) }}</p>
            </div>
          </article>
        }
      } @empty {
        <p class="py-8 text-center text-body text-muted-foreground">{{ emptyText() }}</p>
      }

      @if (typingLabel()) {
        <!-- Live region: a screen-reader user gets told somebody is typing
             rather than only seeing three dots they cannot see. -->
        <p class="px-1 text-meta italic text-muted-foreground" aria-live="polite">{{ typingLabel() }}</p>
      }
    </div>
  `,
})
export class ChatThread {
  readonly messages = input<readonly ChatMessage[]>([]);
  /** Which side is "mine" — `agent` in the console, `visitor` in the window. */
  readonly viewer = input<ChatSender>('agent');
  /** What the other party is called when a message carries no author name. */
  readonly otherLabel = input('');
  readonly youLabel = input('You');
  readonly emptyText = input('');
  /** Non-empty renders the typing line. The caller owns the debounce. */
  readonly typingLabel = input<string | null>(null);

  private readonly scroller = viewChild.required<ElementRef<HTMLDivElement>>('scroller');

  /** Read in the render effect so a new message re-runs the scroll. */
  private readonly count = computed(() => this.messages().length);

  constructor() {
    afterRenderEffect(() => {
      this.count();
      this.typingLabel();
      const element = this.scroller().nativeElement;
      element.scrollTop = element.scrollHeight;
    });
  }

  protected who(message: ChatMessage): string {
    if (message.sender === this.viewer()) return this.youLabel();
    return message.authorName || this.otherLabel();
  }

  protected at(message: ChatMessage): string {
    return formatDateTime(message.createdAt);
  }
}
