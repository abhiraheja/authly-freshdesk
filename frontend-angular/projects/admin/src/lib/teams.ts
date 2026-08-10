import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, valueOr, type Team, type UserSummary } from '@trackly/core';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfirmService,
  EmptyState,
  Icon,
  InputDirective,
  LabelDirective,
  PageHeader,
  Select,
  SelectOption,
  SkeletonDirective,
  ToastService,
} from '@trackly/ui';

/**
 * Departments — what Trackly calls teams internally, because they carry routing
 * as well as grouping.
 *
 * **Membership is the whole feature.** A ticket filed into a department is
 * round-robin assigned among the agents in it, so a department with nobody in it
 * silently assigns nobody and the ticket sits unowned. That is why every empty
 * one says so on its face rather than looking like a tidy, finished row.
 */
@Component({
  selector: 'tk-teams',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Avatar,
    Button,
    Card,
    EmptyState,
    Icon,
    InputDirective,
    LabelDirective,
    PageHeader,
    Select,
    SelectOption,
    SkeletonDirective,
  ],
  template: `
    <tk-page-header [title]="'teams.title' | transloco" [subtitle]="'teams.subtitle' | transloco" />

    <div class="mx-auto max-w-[720px] space-y-5">
      <tk-card [heading]="'teams.addHeading' | transloco">
        <div class="flex flex-wrap items-end gap-2">
          <div class="min-w-[12rem] flex-1">
            <label tkLabel for="team-name">{{ 'teams.form.name' | transloco }}</label>
            <input
              tkInput
              id="team-name"
              name="team-name"
              maxlength="80"
              [placeholder]="'teams.form.namePlaceholder' | transloco"
              [(ngModel)]="draftName"
              (keydown.enter)="create()"
            />
          </div>
          <button tkButton [disabled]="!canCreate()" (click)="create()">
            <tk-icon name="plus" [size]="16" />
            {{ 'teams.add' | transloco }}
          </button>
        </div>
        @if (createError(); as message) {
          <div class="mt-3">
            <tk-alert tone="danger">{{ message }}</tk-alert>
          </div>
        }
      </tk-card>

      @if (teams.value()) {
        @for (team of rows(); track team.id) {
          <tk-card [heading]="team.name" [subheading]="memberCount(team)">
            <span card-actions class="flex items-center gap-1">
              <button
                tkButton
                variant="ghost"
                size="sm"
                iconOnly
                [attr.aria-label]="'teams.renameOne' | transloco: { name: team.name }"
                (click)="startRename(team)"
              >
                <tk-icon name="pencil" [size]="16" />
              </button>
              <button
                tkButton
                variant="ghost"
                size="sm"
                iconOnly
                class="text-danger"
                [attr.aria-label]="'teams.deleteOne' | transloco: { name: team.name }"
                (click)="remove(team)"
              >
                <tk-icon name="trash-2" [size]="16" />
              </button>
            </span>

            @if (renaming() === team.id) {
              <div class="mb-4 flex flex-wrap items-end gap-2">
                <div class="min-w-[12rem] flex-1">
                  <label tkLabel [attr.for]="'rename-' + team.id">{{ 'teams.form.name' | transloco }}</label>
                  <input
                    tkInput
                    [id]="'rename-' + team.id"
                    [name]="'rename-' + team.id"
                    maxlength="80"
                    [(ngModel)]="renameValue"
                    (keydown.enter)="commitRename(team)"
                  />
                </div>
                <button tkButton size="sm" [disabled]="!renameValue().trim()" (click)="commitRename(team)">
                  {{ 'common.save' | transloco }}
                </button>
                <button tkButton variant="ghost" size="sm" (click)="renaming.set(null)">
                  {{ 'common.cancel' | transloco }}
                </button>
              </div>
            }

            @if (team.members.length) {
              <ul class="mb-4 divide-y divide-border">
                @for (member of team.members; track member.id) {
                  <li class="flex items-center gap-2 py-2">
                    <tk-avatar [name]="who(member)" [imageUrl]="member.avatarUrl" [size]="26" round />
                    <span class="min-w-0 flex-1 truncate text-body">{{ who(member) }}</span>
                    <button
                      tkButton
                      variant="ghost"
                      size="sm"
                      iconOnly
                      [disabled]="busy()"
                      [attr.aria-label]="'teams.removeMember' | transloco: { name: who(member) }"
                      (click)="removeMember(team, member)"
                    >
                      <tk-icon name="user-x" [size]="16" />
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <!-- Not a neutral empty state: an empty department is a routing
                   hole, and a ticket sent here gets assigned to nobody. -->
              <div class="mb-4">
                <tk-alert tone="warning">{{ 'teams.emptyWarning' | transloco }}</tk-alert>
              </div>
            }

            <div class="flex flex-wrap items-end gap-2">
              <div class="min-w-[12rem] flex-1">
                <label tkLabel [attr.for]="'add-' + team.id">{{ 'teams.form.addAgent' | transloco }}</label>
                <tk-select
                  [inputId]="'add-' + team.id"
                  [value]="picked()[team.id] ?? ''"
                  (valueChange)="pick(team.id, $event)"
                >
                  <tk-option value="" [label]="'teams.form.choose' | transloco" />
                  @for (agent of available(team); track agent.id) {
                    <tk-option [value]="agent.id" [label]="who(agent)" />
                  }
                </tk-select>
              </div>
              <button tkButton variant="outline" [disabled]="busy() || !picked()[team.id]" (click)="addMember(team)">
                {{ 'teams.addMember' | transloco }}
              </button>
            </div>
          </tk-card>
        } @empty {
          <tk-card>
            <tk-empty-state
              icon="users"
              [heading]="'teams.empty' | transloco"
              [description]="'teams.emptyBody' | transloco"
            />
          </tk-card>
        }
      } @else if (teams.error()) {
        <tk-alert tone="danger" [heading]="'teams.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="teams.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        @for (row of skeletonRows; track row) {
          <span tkSkeleton class="block h-32 w-full rounded-2xl"></span>
        }
      }
    </div>
  `,
})
export class Teams {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly skeletonRows = [0, 1];

  protected readonly teams = resource({ loader: () => this.api.teams() });
  private readonly agents = resource({ loader: () => this.api.agents() });

  protected readonly rows = computed(() => this.teams.value() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.teams.error()));

  protected readonly draftName = signal('');
  protected readonly createError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly renaming = signal<string | null>(null);
  protected readonly renameValue = signal('');

  /** Which agent is chosen in each department's picker, keyed by team id. */
  protected readonly picked = signal<Readonly<Record<string, string>>>({});

  protected readonly canCreate = computed(() => !this.busy() && this.draftName().trim().length > 0);

  protected who(user: UserSummary): string {
    return user.name || user.email || '';
  }

  protected memberCount(team: Team): string {
    const count = team.members.length;
    return this.transloco.translate(count === 1 ? 'teams.countOne' : 'teams.count', { count });
  }

  /** Agents not already in this department — offering a duplicate is noise. */
  protected available(team: Team): UserSummary[] {
    const inTeam = new Set(team.members.map((member) => member.id));
    return valueOr(this.agents, [] as UserSummary[]).filter((agent) => !inTeam.has(agent.id));
  }

  protected pick(teamId: string, userId: string): void {
    this.picked.update((current) => ({ ...current, [teamId]: userId }));
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) return;
    this.createError.set(null);
    await this.run(
      async () => {
        const name = this.draftName().trim();
        await this.api.createTeam(name);
        this.draftName.set('');
        this.toast.success(this.transloco.translate('teams.created', { name }));
      },
      (message) => this.createError.set(message),
    );
  }

  protected startRename(team: Team): void {
    this.renaming.set(team.id);
    this.renameValue.set(team.name);
  }

  protected async commitRename(team: Team): Promise<void> {
    const name = this.renameValue().trim();
    if (!name || name === team.name) return this.renaming.set(null);

    await this.run(async () => {
      await this.api.renameTeam(team.id, name);
      this.renaming.set(null);
      this.toast.success(this.transloco.translate('teams.renamed', { name }));
    });
  }

  /**
   * Confirmed, and it says what happens to the tickets — deleting a department
   * is not a tidy-up, it is a change to where new work lands.
   */
  protected async remove(team: Team): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('teams.deleteHeading'),
      message: this.transloco.translate('teams.deleteMessage', { name: team.name }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    await this.run(async () => {
      await this.api.deleteTeam(team.id);
      this.toast.success(this.transloco.translate('teams.deleted', { name: team.name }));
    });
  }

  protected async addMember(team: Team): Promise<void> {
    const userId = this.picked()[team.id];
    if (!userId) return;

    await this.run(async () => {
      await this.api.addTeamMember(team.id, userId);
      this.pick(team.id, '');
    });
  }

  protected async removeMember(team: Team, member: UserSummary): Promise<void> {
    await this.run(async () => {
      await this.api.removeTeamMember(team.id, member.id);
    });
  }

  /**
   * One write, one reload, one place errors land.
   *
   * The reload is not optional: membership decides round-robin, and a list that
   * disagreed with the server about who is in a department would be showing the
   * wrong answer to the only question this page exists to answer.
   */
  private async run(action: () => Promise<void>, onError?: (message: string) => void): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.teams.reload();
    } catch (error) {
      const message = errorMessage(error);
      if (onError) onError(message);
      else this.toast.error(message);
    } finally {
      this.busy.set(false);
    }
  }
}
