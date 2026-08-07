import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'trackly.collapsed';

/**
 * Which collapsible panels this person has folded away.
 *
 * Local to the browser on purpose. It is a viewing preference, not
 * configuration: the workspace decides which cards exist and in what order
 * (admin → ticket layout), and an individual decides which of them they want
 * out of the way today. Syncing it to the server would make one agent's tidying
 * everyone's problem.
 *
 * Every read and write is guarded, because `localStorage` throws rather than
 * returning null in a handful of real situations — Safari private mode, a
 * blocked third-party context, a full quota. A preference is never worth an
 * exception that takes the page down with it.
 */
@Injectable({ providedIn: 'root' })
export class UiPrefsStore {
  private readonly collapsedKeys = signal<ReadonlySet<string>>(read());

  /** Signal-backed, so a card bound to it re-renders when another view changes it. */
  isCollapsed(key: string): boolean {
    return this.collapsedKeys().has(key);
  }

  setCollapsed(key: string, collapsed: boolean): void {
    this.collapsedKeys.update((current) => {
      if (current.has(key) === collapsed) return current;
      const next = new Set(current);
      if (collapsed) next.add(key);
      else next.delete(key);
      write(next);
      return next;
    });
  }
}

function read(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // Anything but an array of strings is treated as absent rather than
    // repaired: a corrupted preference is not worth reasoning about.
    return Array.isArray(parsed) ? new Set(parsed.filter((k): k is string => typeof k === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function write(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Preference lost for this session. Nothing else changes.
  }
}
