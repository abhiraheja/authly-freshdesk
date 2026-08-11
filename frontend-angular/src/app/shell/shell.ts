import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, type Event as RouterEvent } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ChatPresence, SessionStore, TicketsApi, errorMessage } from '@trackly/core';
import { ThemeService } from '@trackly/core';
import {
  Avatar,
  AvatarUpload,
  Button,
  ConfirmHost,
  Icon,
  Kbd,
  Modal,
  Toaster,
  ToastService,
} from '@trackly/ui';
import { CommandPalette } from './command-palette';
import { NotificationBell } from './notification-bell';
import { NAV, type NavGroup, type NavItem } from './nav';

/**
 * The authenticated app shell: sidebar + top bar, with routed pages rendering
 * into the outlet.
 *
 * Only the `<main>` pane scrolls — the sidebar and top bar never move. That is
 * what makes navigation feel fixed rather than the page sliding under a header.
 *
 * This is a **Trackly-owned** surface for agents and admins: it wears the Trackly
 * palette and supports dark mode. Customer-facing surfaces — the portal included
 * — use `BrandedFrame` instead, wear the workspace's colour, and are always light
 * (invariant 6). They are siblings of this route, never children of it.
 */
@Component({
  selector: 'tk-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    TranslocoPipe,
    Avatar,
    AvatarUpload,
    Button,
    ConfirmHost,
    Icon,
    Kbd,
    Modal,
    Toaster,
    CommandPalette,
    NotificationBell,
  ],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './shell.html',
})
export class Shell {
  private readonly router = inject(Router);
  private readonly api = inject(TicketsApi);
  private readonly chat = inject(ChatPresence);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly session = inject(SessionStore);
  protected readonly theme = inject(ThemeService);

  constructor() {
    // Only the shell starts it, and the shell only renders for staff — so a
    // customer or a guest never opens a lobby connection.
    void this.chat.start();
    inject(DestroyRef).onDestroy(() => this.chat.stop());
    this.announceChats();
  }

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

  protected readonly photoOpen = signal(false);
  protected readonly photoBusy = signal(false);
  protected readonly photoError = signal<string | undefined>(undefined);

  /**
   * Which collapsible groups the user has opened or closed by hand, keyed by the
   * group's label key. Absent means "nobody has said" — see `isGroupOpen`.
   *
   * Per-group rather than the single `adminToggled` flag this replaced: Admin used
   * to be the only collapsible group, and hardcoding one boolean meant the second
   * one to arrive silently shared Admin's state.
   */
  private readonly groupToggled = signal<Readonly<Record<string, boolean>>>({});

  /**
   * Live counts for the saved-view rows.
   *
   * Reloaded on every navigation rather than polled: the numbers only move when
   * somebody acts on a ticket, and by the time you have navigated you are
   * looking at a fresh page anyway. A timer would be spending requests to keep a
   * sidebar number honest between two clicks.
   */
  private readonly stats = resource({
    params: () => ({ url: this.url() }),
    loader: () => this.api.stats().catch(() => null),
  });

  /**
   * The saved-view numbers, plus the one that does not come from `/stats`.
   *
   * Live chat is pushed over the hub rather than counted by a query on
   * navigation — a visitor who arrives while an agent reads a ticket has to show
   * up without the agent going anywhere. Same lookup table, two sources.
   */
  protected readonly counts = computed<Readonly<Record<string, number>>>(() => ({
    ...((this.stats.value() as unknown as Record<string, number> | null) ?? {}),
    chatWaiting: this.chat.waiting(),
  }));

  /**
   * The rail, filtered to what this person may reach.
   *
   * No customer branch: `/portal` is a sibling of the shell, not a route inside
   * it, and `roleGuard` sends a customer there before the shell ever activates.
   */
  protected readonly groups = computed<readonly NavGroup[]>(() => {
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
   * The rows' counts added up, for the badge on a collapsed group's header.
   *
   * Null when it comes to zero, so the pill disappears rather than showing "0" —
   * and null when no row in the group has a count at all, which is why this cannot
   * just be a sum starting from 0.
   *
   * The double-counting is deliberate and correct here: **By status** has one row
   * per category, so its total is every ticket in the workspace, which is exactly
   * what "the queue" means. It would be wrong for a group whose rows overlap, and
   * there is no such collapsible group.
   */
  protected groupCount(group: NavGroup): number | null {
    let total: number | null = null;
    for (const item of group.items) {
      const value = this.count(item);
      if (value !== null) total = (total ?? 0) + value;
    }
    return total || null;
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

  /**
   * Whether a collapsible group is showing its rows.
   *
   * Three answers in priority order:
   *  1. what the user last did to it by hand — always wins, so a group they shut
   *     stays shut while they work;
   *  2. otherwise, open if the current route is inside it, so a bookmarked or
   *     shared link never lands on a row that is hidden;
   *  3. otherwise, the group's own default.
   */
  protected isGroupOpen(group: NavGroup): boolean {
    if (!group.collapsible) return true;

    const manual = this.groupToggled()[group.labelKey];
    if (manual !== undefined) return manual;

    if (group.routePrefix && this.url().startsWith(group.routePrefix)) return true;
    if (group.items.some((item) => this.isActive(item))) return true;

    return !group.collapsedByDefault;
  }

  protected toggleGroup(group: NavGroup): void {
    const open = this.isGroupOpen(group);
    this.groupToggled.update((state) => ({ ...state, [group.labelKey]: !open }));
  }

  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }

  protected openPhoto(): void {
    this.profileOpen.set(false);
    this.photoError.set(undefined);
    this.photoOpen.set(true);
  }

  /**
   * Patches the session rather than refetching `/me`.
   *
   * The response already carries the new URL, and the sidebar avatar reads
   * straight off the store — so the photo changes the moment the request
   * returns, with no second round trip and no flash of the old one.
   */
  protected async uploadPhoto(file: File): Promise<void> {
    const me = this.session.user();
    if (!me) return;

    this.photoBusy.set(true);
    this.photoError.set(undefined);
    try {
      const { avatarUrl } = await this.api.uploadAvatar(me.id, file);
      this.session.patch({ avatarUrl });
    } catch (error) {
      this.photoError.set(errorMessage(error));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async removePhoto(): Promise<void> {
    const me = this.session.user();
    if (!me) return;

    this.photoBusy.set(true);
    this.photoError.set(undefined);
    try {
      await this.api.removeAvatar(me.id);
      this.session.patch({ avatarUrl: null });
    } catch (error) {
      this.photoError.set(errorMessage(error));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.profileOpen.set(false);
    this.chat.stop();
    await this.session.signOut();
    void this.router.navigate(['/login']);
  }

  /**
   * A live chat is the one arrival worth interrupting for, so it gets a toast
   * with a way straight into it — the badge alone only works for somebody who
   * happens to be looking at the rail.
   *
   * The signal is cleared as it is read: leaving it set would re-announce the
   * same visitor on every subsequent change-detection pass.
   */
  private announceChats(): void {
    effect(() => {
      const session = this.chat.arrived();
      if (!session) return;
      this.chat.arrived.set(null);

      const who = session.visitorName || session.visitorEmail;
      this.toast.info(
        who
          ? this.transloco.translate('chat.arrivedNamed', { name: who })
          : this.transloco.translate('chat.arrived'),
        {
          label: this.transloco.translate('chat.open'),
          run: () => void this.router.navigate(['/dashboard/chat']),
        },
      );
    });
  }

  /** ⌘K / Ctrl+K anywhere in the shell opens the palette. */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.paletteOpen.set(true);
    }
  }
}
