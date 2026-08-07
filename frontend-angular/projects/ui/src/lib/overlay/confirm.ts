import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Button } from '../button/button';
import { Modal } from './modal';

export interface ConfirmOptions {
  /** The question, as a statement of what is about to happen. */
  heading: string;
  /** What the action does that the heading cannot say in a few words. */
  message?: string;
  /** Names the action — "Resolve", "Delete", never "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colours the confirm button. Use `danger` only when something is lost. */
  tone?: 'primary' | 'danger' | 'success';
}

/**
 * "Are you sure?", once, for the whole app.
 *
 * ```ts
 * if (!(await this.confirm.ask({ heading: 'Resolve this ticket?' }))) return;
 * ```
 *
 * A promise rather than a callback so the caller reads top to bottom and the
 * guard sits where the decision is, instead of the real work being buried in a
 * handler two levels down.
 *
 * **Ask sparingly.** A dialog on something routine trains people to dismiss it
 * without reading, which costs you the one time it mattered. It earns its place
 * where the action is hard to undo, reaches the customer, or is one slip away
 * from a button people press all day.
 *
 * Requires `<tk-confirm-host />` mounted once, in the app shell.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _request = signal<ConfirmOptions | null>(null);
  readonly request = this._request.asReadonly();

  private resolver: ((confirmed: boolean) => void) | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    // A second ask while one is open answers the first with "no". Leaving that
    // promise unsettled would hang whatever was awaiting it, forever.
    this.settle(false);
    this._request.set(options);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** For `ConfirmHost` only. */
  answer(confirmed: boolean): void {
    this.settle(confirmed);
  }

  private settle(confirmed: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this._request.set(null);
    resolve?.(confirmed);
  }
}

/**
 * Renders whatever `ConfirmService` is currently asking. Mount once, next to
 * `<tk-toaster />`.
 */
@Component({
  selector: 'tk-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Modal, TranslocoPipe],
  template: `
    @if (confirm.request(); as request) {
      <!-- open is pinned true: the request's existence IS the open state, so
           Esc and the backdrop report through openChange as a cancel. -->
      <tk-modal [open]="true" (openChange)="confirm.answer(false)" [heading]="request.heading">
        @if (request.message) {
          <p class="text-body text-muted-foreground">{{ request.message }}</p>
        }
        <div modal-footer>
          <button tkButton variant="ghost" (click)="confirm.answer(false)">
            {{ request.cancelLabel || ('common.cancel' | transloco) }}
          </button>
          <button tkButton [variant]="request.tone ?? 'primary'" (click)="confirm.answer(true)">
            {{ request.confirmLabel || ('common.confirm' | transloco) }}
          </button>
        </div>
      </tk-modal>
    }
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
}
