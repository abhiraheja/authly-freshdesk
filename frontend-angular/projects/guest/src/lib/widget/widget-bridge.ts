import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { WidgetIdentity } from '@trackly/core';

/** Settings the host page may override per page (docs/widget-plan.md § 3.2). */
export interface LoaderSettings {
  hideLauncher?: boolean;
  showWidgetForm?: boolean;
  showCloseButton?: boolean;
  showSendButton?: boolean;
  launchWidget?: boolean;
}

const LOADER = 'trackly-loader';
const FRAME = 'trackly-widget';

/**
 * Whether an origin can be used as a `postMessage` target.
 *
 * A page with an **opaque origin** — one opened from `file://`, or embedded in a
 * sandboxed frame — reports its origin as the literal string `"null"`. That is
 * not a URL, and `postMessage(msg, "null")` does not quietly fail to deliver: it
 * throws `SyntaxError`. Adopting it as the host origin therefore turned every
 * later message the panel sent into an exception — the close, minimise and
 * expand buttons stopped doing anything, and the unread report, which runs
 * inside an effect, threw during change detection and froze the view on whatever
 * it was showing at the time.
 *
 * Opening the embed snippet as a local file is the first thing anyone does with
 * it, so this is a failure mode worth not having.
 *
 * There is nothing to address such a host by, so the panel keeps posting to
 * `'*'` — the only string that reaches an opaque origin. Safe for the same
 * reason `ready` is: the recipient is always `window.parent`, the inbound
 * direction is still pinned to it, and nothing this bridge sends outward is a
 * secret. The visitor token never crosses `postMessage` — only unread counts and
 * window-chrome requests do.
 *
 * `URL.canParse` rather than a `=== 'null'` check, so any other origin the
 * platform cannot address fails the same way instead of reaching `postMessage`.
 */
function addressable(origin: string): boolean {
  return origin !== 'null' && origin !== '' && URL.canParse(origin);
}

/**
 * The panel's half of the loader protocol (docs/widget-plan.md § 7.2).
 *
 * <h3>Why the origin is learned rather than configured</h3>
 * The panel cannot know which site has embedded it until that site speaks: the
 * allowed-domains list lives on the server and is never sent here. So the frame
 * accepts messages from `window.parent` and nothing else, remembers the origin
 * of the first message, and refuses any later message from a different one. Only
 * `ready` goes out before that is known, and `ready` carries no data — every
 * message after it is addressed to the learned origin, never to `*`.
 *
 * <h3>Standalone is a supported state</h3>
 * Opened directly in a tab — which is what happens when someone follows the
 * frame URL, and what phase 4's harness does — there is no parent and no
 * handshake. {@link waitForHost} resolves immediately and the panel runs with the
 * server's own defaults.
 */
@Injectable()
export class WidgetBridge {
  private readonly framed = window.parent !== window;
  private hostOrigin: string | null = null;

  private readonly _settings = signal<LoaderSettings>({});
  /** Host-page overrides, empty until (and unless) the loader sends them. */
  readonly settings = this._settings.asReadonly();

  private readonly _identity = signal<WidgetIdentity | null>(null);
  /** What the host page claims about the visitor. A claim — never a proof. */
  readonly identity = this._identity.asReadonly();

  private readonly _visible = signal(!this.framed);
  /** Whether the loader currently has the panel on screen. */
  readonly visible = this._visible.asReadonly();

  private readonly _expanded = signal(false);
  readonly expanded = this._expanded.asReadonly();

  private settled = false;
  private resolveHost: (() => void) | null = null;
  private readonly host = new Promise<void>((resolve) => {
    this.resolveHost = resolve;
  });

  constructor() {
    if (!this.framed) {
      this.settle();
      return;
    }

    const onMessage = (event: MessageEvent) => this.receive(event);
    window.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', onMessage));

    this.post('ready');

    // A loader that never answers must not leave the panel blank forever. The
    // frame is created hidden on load, so this timeout costs a visitor nothing —
    // by the time they open it, the handshake has long since happened or failed.
    setTimeout(() => this.settle(), 1500);
  }

  /** Resolves once the host page's config has arrived, or once it is clear none will. */
  waitForHost(): Promise<void> {
    return this.host;
  }

  /** The unread total for the launcher badge. A count, never a command to open. */
  reportUnread(count: number): void {
    this.post('unread', { count });
  }

  requestClose(): void {
    this._visible.set(false);
    this.post('close');
  }

  toggleExpanded(): void {
    const next = !this._expanded();
    this._expanded.set(next);
    this.post(next ? 'expand' : 'collapse');
  }

  private receive(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    if (this.hostOrigin !== null && event.origin !== this.hostOrigin) return;

    const data = event.data as { source?: string; type?: string; payload?: unknown } | null;
    if (!data || data.source !== LOADER || !data.type) return;

    this.hostOrigin ??= addressable(event.origin) ? event.origin : null;
    const payload = (data.payload ?? {}) as {
      config?: LoaderSettings;
      identity?: WidgetIdentity | null;
    };

    switch (data.type) {
      case 'config':
        if (payload.config) this._settings.set(payload.config);
        if (payload.identity) this._identity.set(payload.identity);
        this.settle();
        break;
      case 'identify':
        if (payload.identity) this._identity.set(payload.identity);
        break;
      case 'open':
        this._visible.set(true);
        break;
      case 'close':
        this._visible.set(false);
        if (this._expanded()) {
          this._expanded.set(false);
        }
        break;
      default:
        break;
    }
  }

  private post(type: string, payload?: unknown): void {
    if (!this.framed) return;
    const message: Record<string, unknown> = { source: FRAME, type };
    if (payload) message['payload'] = payload;
    try {
      // '*' for `ready`, which is the message that teaches us the origin and
      // carries nothing worth intercepting — and for the whole conversation when
      // the host page has no origin to address (see `addressable`).
      window.parent.postMessage(message, this.hostOrigin ?? '*');
    } catch {
      // Belt to `addressable`'s braces. A message that cannot be delivered must
      // never take the panel down with it: `reportUnread` is called from an
      // effect, so a throw there stops change detection mid-render, and the
      // window controls are click handlers, so a throw there is a button that
      // does nothing.
    }
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveHost?.();
  }
}
