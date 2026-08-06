import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, type Event as RouterEvent } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { SessionStore } from '@trackly/core';
import { ThemeService } from '@trackly/core';
import { Avatar, Button, Dropdown, Icon, Kbd, Toaster } from '@trackly/ui';
import { CommandPalette } from './command-palette';
import { NAV, PORTAL_NAV, type NavGroup, type NavItem } from './nav';

/**
 * The authenticated app shell: sidebar + top bar, with routed pages rendering
 * into the outlet.
 *
 * Only the `<main>` pane scrolls — the sidebar and top bar never move. That is
 * what makes navigation feel fixed rather than the page sliding under a header.
 *
 * This is a **Trackly-owned** surface: it wears the Trackly palette and supports
 * dark mode. Customer-facing surfaces use `BrandedFrame` instead, wear the
 * workspace's colour, and are always light (invariant 6).
 */
@Component({
  selector: 'tk-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, Avatar, Button, Dropdown, Icon, Kbd, Toaster, CommandPalette],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './shell.html',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly theme = inject(ThemeService);

  /** Current URL, as a signal, so active-state is computed rather than imperatively set. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e: RouterEvent): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly mobileOpen = signal(false);
  protected readonly paletteOpen = signal(false);
  protected readonly profileOpen = signal(false);

  /**
   * Admin is collapsed by default — thirteen rows would otherwise dominate the
   * rail — but opens automatically while an /admin route is active, so you can
   * see where you are.
   */
  private readonly adminToggled = signal<boolean | null>(null);
  protected readonly adminOpen = computed(
    () => this.adminToggled() ?? this.url().startsWith('/admin'),
  );

  /**
   * Live counts for the saved-view rows. Wired to `/api/dashboard/stats` by the
   * dashboard feature; until those fields exist server-side the rows simply
   * render without a count rather than showing a fabricated zero.
   */
  protected readonly counts = signal<Readonly<Record<string, number>>>({});

  protected readonly groups = computed<readonly NavGroup[]>(() => {
    if (this.session.isCustomer()) return PORTAL_NAV;
    const isAdmin = this.session.isAdmin();
    return NAV.filter((g) => !g.adminOnly || isAdmin).map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.adminOnly || isAdmin),
    }));
  });

  protected readonly workspaceName = computed(() => this.session.workspace()?.name ?? '');

  protected isActive(item: NavItem): boolean {
    const url = this.url();
    const [path, query] = url.split('?');
    if (path !== item.route) return false;

    // Saved views share one route, so the `view` param is what distinguishes
    // them. "All tickets" (no params) is active only when no view is set.
    const view = new URLSearchParams(query ?? '').get('view');
    return (item.params?.['view'] ?? null) === view;
  }

  protected count(item: NavItem): number | null {
    if (!item.countKey) return null;
    const value = this.counts()[item.countKey];
    return typeof value === 'number' ? value : null;
  }

  /**
   * Status-dot colour for a saved view. Static strings, because Tailwind v4 only
   * emits classes it can find literally in the source — an interpolated
   * `bg-${tone}` compiles to nothing.
   */
  protected dotClass(item: NavItem): string {
    switch (item.tone) {
      case 'info':
        return 'bg-info';
      case 'warning':
        return 'bg-warning';
      case 'success':
        return 'bg-success';
      case 'danger':
        return 'bg-danger';
      case 'primary':
        return 'bg-primary';
      default:
        return 'bg-neutral';
    }
  }

  protected toggleAdmin(): void {
    this.adminToggled.set(!this.adminOpen());
  }

  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }

  protected async signOut(): Promise<void> {
    this.profileOpen.set(false);
    await this.session.signOut();
    void this.router.navigate(['/login']);
  }

  /** ⌘K / Ctrl+K anywhere in the shell opens the palette. */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.paletteOpen.set(true);
    }
  }
}
