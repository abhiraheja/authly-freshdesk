import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import type { Tone } from '../../core/format';
import { Icon, type IconName } from '../icon/icon';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly tone: Tone;
  readonly message: string;
  readonly action?: ToastAction;
}

const AUTO_DISMISS_MS = 4_000;
const MAX_VISIBLE = 3;

/**
 * Transient confirmations for actions that already succeeded.
 *
 * **When NOT to use a toast:** anything the user must act on. A toast is gone in
 * four seconds, so it can never hold the only copy of an error or a validation
 * message — those belong in a `tk-alert` next to the thing that failed. Reach
 * for a toast when the surface that triggered the action is gone or unchanged
 * ("Ticket assigned", "Settings saved", "Invitation sent").
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<readonly Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string, action?: ToastAction): void {
    this.show(message, 'success', action);
  }

  error(message: string, action?: ToastAction): void {
    this.show(message, 'danger', action);
  }

  warning(message: string, action?: ToastAction): void {
    this.show(message, 'warning', action);
  }

  info(message: string, action?: ToastAction): void {
    this.show(message, 'info', action);
  }

  show(message: string, tone: Tone = 'neutral', action?: ToastAction): void {
    const toast: Toast = { id: this.nextId++, tone, message, action };
    // Oldest falls off the top rather than growing an unbounded stack that
    // covers the page's own bottom-right controls.
    this._toasts.update((list) => [...list, toast].slice(-MAX_VISIBLE));
    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), AUTO_DISMISS_MS),
    );
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

/**
 * App-wide toast outlet. Render **once**, at the app root — not per page, or
 * toasts fired during a navigation would be destroyed with the outgoing route.
 */
@Component({
  selector: 'tk-toaster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'pointer-events-none fixed bottom-6 right-6 z-[90] flex flex-col items-end gap-2',
    'aria-live': 'polite',
    'aria-atomic': 'false',
  },
  template: `
    @for (toast of toasts(); track toast.id) {
      <div
        class="animate-float-in pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border border-border bg-popover px-4 py-3 text-body shadow-[var(--shadow-menu)]"
      >
        <tk-icon [name]="iconFor(toast.tone)" [size]="18" [class]="'shrink-0 ' + colorFor(toast.tone)" />
        <span class="min-w-0 flex-1">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button
            type="button"
            class="shrink-0 font-semibold text-primary hover:underline"
            (click)="run(toast, action)"
          >
            {{ action.label }}
          </button>
        }
        <button
          type="button"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
          (click)="service.dismiss(toast.id)"
        >
          <tk-icon name="x" [size]="16" />
        </button>
      </div>
    }
  `,
})
export class Toaster {
  protected readonly service = inject(ToastService);
  protected readonly toasts = this.service.toasts;

  protected run(toast: Toast, action: ToastAction): void {
    action.run();
    this.service.dismiss(toast.id);
  }

  // Static class strings so Tailwind can see them — never build these by
  // interpolation, v4 does not scan computed values.
  protected colorFor(tone: Tone): string {
    switch (tone) {
      case 'success':
        return 'text-success';
      case 'danger':
        return 'text-danger';
      case 'warning':
        return 'text-warning';
      case 'info':
        return 'text-info';
      case 'primary':
        return 'text-primary';
      default:
        return 'text-muted-foreground';
    }
  }

  protected iconFor(tone: Tone): IconName {
    switch (tone) {
      case 'success':
        return 'check-circle';
      case 'danger':
        return 'alert-circle';
      case 'warning':
        return 'alert-triangle';
      default:
        return 'info';
    }
  }
}
