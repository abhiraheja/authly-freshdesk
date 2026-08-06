import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

const STORAGE_KEY = 'trackly-theme';

/**
 * Light/dark for **Trackly-owned surfaces only**.
 *
 * Customer-facing surfaces (`/submit`, `/portal`, guest views, the widget) are
 * always light and wear the workspace's brand — a customer never toggles a
 * tenant's palette into dark mode (invariant 6). Those routes call
 * {@link forceLight} on entry.
 *
 * The initial class is applied by an inline script in index.html so dark-mode
 * users don't get a white flash before Angular boots; this service only reads
 * that state and flips it afterwards.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly root = this.document.documentElement;

  private readonly _dark = signal(this.root.classList.contains('dark'));
  readonly dark = this._dark.asReadonly();

  /** Set while a customer-facing route is active, so toggling is suppressed. */
  private readonly _locked = signal(false);
  readonly locked = this._locked.asReadonly();

  toggle(): void {
    this.set(!this._dark());
  }

  set(dark: boolean): void {
    if (this._locked()) return;
    this.apply(dark);
    this._dark.set(dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      // Private mode — the choice just won't survive a reload.
    }
  }

  /**
   * Forces light and blocks toggling, for a workspace-branded surface. Returns a
   * dispose function that restores the user's own preference; call it when the
   * branded route is destroyed.
   */
  forceLight(): () => void {
    const previous = this._dark();
    this.apply(false);
    this._locked.set(true);
    return () => {
      this._locked.set(false);
      this.apply(previous);
    };
  }

  private apply(dark: boolean): void {
    this.root.classList.toggle('dark', dark);
  }
}
