import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SessionStore } from '@trackly/core';
import { Button, Icon, PageHeader, Tabs, type TabItem } from '@trackly/ui';
import { AgentDashboard } from './agent-dashboard';
import { AdminDashboard } from './admin-dashboard';

/**
 * `/dashboard` — one route, two audiences.
 *
 * **An admin gets the workspace; an agent gets themselves.** Not because an agent
 * is not trusted with the numbers, but because they are different jobs: an agent
 * needs to know what is on them, and a lead needs to know whether the desk is
 * keeping up. A single screen serving both ends up being neither, and an extra
 * sidebar row for "the other dashboard" is a row most people never click.
 *
 * An admin is also an agent who works tickets, so they get **tabs** rather than a
 * choice made for them. Workspace leads, because that is why they opened this page —
 * but their own queue is one click away and nothing is hidden.
 *
 * The two panels live in their own files and know nothing about each other. This
 * one only decides which is on screen, which is why it holds no data of its own.
 */
@Component({
  selector: 'tk-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Button,
    Icon,
    PageHeader,
    Tabs,
    AgentDashboard,
    AdminDashboard,
  ],
  template: `
    <tk-page-header [title]="greeting()" [subtitle]="subtitle()">
      <a tkButton page-actions routerLink="/dashboard/tickets">
        <tk-icon name="ticket" [size]="16" />
        {{ 'dashboard.openWorkspace' | transloco }}
      </a>
    </tk-page-header>

    @if (isAdmin()) {
      <tk-tabs class="mb-5" [tabs]="tabs()" [(active)]="tab" panelId="dashboard-panel" />

      <div id="dashboard-panel" role="tabpanel">
        <!-- @switch, not two @ifs with hidden: the panel that is not showing must
             not run its resource. Both call the analytics API, and paying for the
             workspace aggregate to render a tab nobody opened is exactly the kind
             of cost that never shows up until the workspace is large. -->
        @switch (tab()) {
          @case ('mine') {
            <tk-agent-dashboard />
          }
          @default {
            <tk-admin-dashboard />
          }
        }
      </div>
    } @else {
      <tk-agent-dashboard />
    }
  `,
})
export class Dashboard {
  private readonly session = inject(SessionStore);
  private readonly transloco = inject(TranslocoService);
  /** Re-resolve the TS-side copy when the language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly isAdmin = computed(() => this.session.isAdmin());

  /** Workspace first — it is why an admin opened this page. */
  protected readonly tab = signal('workspace');

  protected readonly tabs = computed<TabItem[]>(() => {
    this.lang();
    return [
      { id: 'workspace', label: this.transloco.translate('dashboard.tabs.workspace'), icon: 'bar-chart-3' },
      { id: 'mine', label: this.transloco.translate('dashboard.tabs.mine'), icon: 'user-check' },
    ];
  });

  /** Two whole-sentence keys — the name is a parameter, never concatenated. */
  protected readonly greeting = computed(() => {
    this.lang();
    const name = this.session.user()?.name?.split(' ')[0];
    return name
      ? this.transloco.translate('dashboard.welcomeNamed', { name })
      : this.transloco.translate('dashboard.welcome');
  });

  protected readonly subtitle = computed(() => {
    this.lang();
    return this.transloco.translate(
      this.isAdmin() ? 'dashboard.subtitleAdmin' : 'dashboard.subtitle',
    );
  });
}
