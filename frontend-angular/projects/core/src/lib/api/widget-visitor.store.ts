import { Injectable, signal } from '@angular/core';

/**
 * The visitor token for the widget currently on screen.
 *
 * A service rather than a parameter on every call, because it is also what the
 * HTTP interceptor needs — the header has to be attached without every call site
 * remembering to. Persisted per widget token: two widgets on one site are two
 * different visitors, and sharing a token between them would let one widget read
 * the other's conversations.
 *
 * Only the raw token lives here. The server stores its SHA-256 (invariant 4).
 *
 * <h3>Why its own file and not part of `widget.api`</h3>
 * `widgetVisitorInterceptor` needs this class, and the interceptors are reached
 * from `provideTracklyCore` — which every app loads eagerly. While this lived
 * beside `WidgetApi` that chain dragged `WidgetApi`'s imports into the initial
 * bundle too, and once the panel moved to SignalR that meant shipping
 * `@microsoft/signalr` (~56 kB) to every user on first paint, for a hub only the
 * embedded widget ever opens. Splitting the store keeps the eager graph to a
 * signal and a `localStorage` key.
 */
@Injectable({ providedIn: 'root' })
export class WidgetVisitorStore {
  private readonly _token = signal<string | null>(null);
  readonly token = this._token.asReadonly();

  private key = '';

  /** Points the store at a widget and loads any token this browser already has. */
  use(widgetToken: string): void {
    this.key = `trackly.widget.${widgetToken}`;
    this._token.set(read(this.key));
  }

  set(token: string | null): void {
    this._token.set(token);
    if (!this.key) return;
    try {
      if (token) localStorage.setItem(this.key, token);
      else localStorage.removeItem(this.key);
    } catch {
      // Private browsing, or storage disabled. The session still works for as
      // long as the frame is alive; it just will not survive a reload.
    }
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
