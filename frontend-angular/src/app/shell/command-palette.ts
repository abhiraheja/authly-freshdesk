import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from '../core/auth/session.store';
import { Icon, Kbd, type IconName } from '../ui';
import { NAV } from './nav';

interface Command {
  readonly label: string;
  readonly group: string;
  readonly icon: IconName;
  readonly route: string;
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * ⌘K palette. Opened by the shortcut or the top-bar search button — both drive
 * this one component, so the two entry points can't diverge.
 *
 * Navigation targets are matched locally from the same `NAV` definition the
 * sidebar renders, which means a new nav item is searchable the moment it is
 * added, with nothing else to register.
 *
 * Ticket and article search will hook in here later; when it does it must be
 * debounced and cancellable, never a request per keystroke.
 */
@Component({
  selector: 'tk-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Kbd],
  template: `
    @if (open()) {
      <div class="overlay" (click)="close()" aria-hidden="true"></div>
      <div
        class="palette glass animate-float-in"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        (keydown)="onKeydown($event)"
      >
        <div class="flex h-14 items-center gap-3 border-b border-border px-4">
          <tk-icon name="search" [size]="18" class="text-muted-foreground" />
          <input
            #search
            class="flex-1 bg-transparent text-body outline-none"
            placeholder="Type a command or search…"
            [value]="query()"
            (input)="onQuery($event)"
            aria-label="Search commands"
          />
          <tk-kbd>ESC</tk-kbd>
        </div>

        <div class="scroll-thin max-h-80 overflow-y-auto p-2">
          @for (group of grouped(); track group.name) {
            <p class="menu-label">{{ group.name }}</p>
            @for (command of group.items; track command.label) {
              <button
                type="button"
                class="menu-item"
                [class.bg-accent]="command === active()"
                (click)="run(command)"
                (mouseenter)="highlight(command)"
              >
                <tk-icon [name]="command.icon" [size]="16" />
                {{ command.label }}
              </button>
            }
          } @empty {
            <p class="px-3 py-8 text-center text-body text-muted-foreground">
              Nothing matches “{{ query() }}”.
            </p>
          }
        </div>
      </div>
    }
  `,
})
export class CommandPalette {
  readonly open = model(false);

  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly query = signal('');
  private readonly activeIndex = signal(0);

  /** Every nav destination the current user may reach, flattened into commands. */
  private readonly commands = computed<readonly Command[]>(() => {
    const isAdmin = this.session.isAdmin();
    return NAV.filter((g) => !g.adminOnly || isAdmin).flatMap((group) =>
      group.items
        .filter((item) => !item.adminOnly || isAdmin)
        .map((item) => ({
          label: item.label,
          group: group.label,
          icon: item.icon ?? 'ticket',
          route: item.route,
          params: item.params,
        })),
    );
  });

  protected readonly results = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return this.commands();
    return this.commands().filter((c) => c.label.toLowerCase().includes(query));
  });

  protected readonly active = computed(() => this.results()[this.activeIndex()] ?? null);

  protected readonly grouped = computed(() => {
    const groups = new Map<string, Command[]>();
    for (const command of this.results()) {
      const list = groups.get(command.group) ?? [];
      list.push(command);
      groups.set(command.group, list);
    }
    return [...groups].map(([name, items]) => ({ name, items }));
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        this.query.set('');
        this.activeIndex.set(0);
        // Focus after the dialog is in the DOM, or the input isn't there yet.
        queueMicrotask(() => this.search()?.nativeElement.focus());
      }
    });
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  protected highlight(command: Command): void {
    this.activeIndex.set(this.results().indexOf(command));
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter': {
        event.preventDefault();
        const command = this.active();
        if (command) this.run(command);
        break;
      }
    }
  }

  protected run(command: Command): void {
    this.close();
    void this.router.navigate([command.route], { queryParams: command.params ?? {} });
  }

  protected close(): void {
    this.open.set(false);
  }
}
