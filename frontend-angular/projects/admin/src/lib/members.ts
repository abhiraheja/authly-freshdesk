import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AdminApi,
  SessionStore,
  errorMessage,
  formatDateTime,
  type AddMemberResult,
  type Member,
  type UserRole,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmService,
  Field,
  Icon,
  InputDirective,
  Modal,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  TableDirective,
  ToastService,
} from '@trackly/ui';

const ROLES: readonly UserRole[] = ['agent', 'admin', 'customer'];

/**
 * Admin → People → Members.
 *
 * **This screen is the account-recovery path.** Trackly is self-hosted and email
 * is configured from inside it, so on a fresh install an invitation has nowhere
 * to go — and if SMTP later breaks, nobody can be emailed a code either. Adding
 * a member here produces a password the admin reads out over a call, and
 * resetting one is how a locked-out colleague gets back in. Neither needs email
 * to work.
 *
 * A generated password is shown exactly once. It is stored hashed, so there is
 * no second look — only another reset.
 */
@Component({
  selector: 'tk-admin-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    Field,
    Icon,
    InputDirective,
    Modal,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    TableDirective,
  ],
  template: `
    <div class="mx-auto max-w-[980px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.members.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.members.subtitle' | transloco }}</p>

      @if (members.value(); as rows) {
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span class="text-meta text-muted-foreground">
            {{ 'admin.members.count' | transloco: { count: rows.length } }}
          </span>
          <button tkButton (click)="openAdd()">
            <tk-icon name="user-plus" [size]="16" />
            {{ 'admin.members.add' | transloco }}
          </button>
        </div>

        <!-- Said once, at the top, because it is the thing an admin only
             discovers when it is already too late to act on. -->
        @if (soleAdmin()) {
          <tk-alert tone="warning" class="mb-3" [heading]="'admin.members.soleAdmin' | transloco">
            {{ 'admin.members.soleAdminBody' | transloco }}
          </tk-alert>
        }

        <tk-card flush>
          <div class="overflow-x-auto">
            <table tkTable class="min-w-[720px]">
              <thead>
                <tr>
                  <th>{{ 'admin.members.member' | transloco }}</th>
                  <th>{{ 'admin.members.signIn' | transloco }}</th>
                  <th>{{ 'admin.members.role' | transloco }}</th>
                  <th>{{ 'admin.members.lastActive' | transloco }}</th>
                  <th class="text-right">{{ 'tickets.columns.actions' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (member of rows; track member.id) {
                  <tr [class.opacity-55]="!member.isActive">
                    <td>
                      <div class="flex items-center gap-2.5">
                        <tk-avatar [name]="member.name || member.email || '?'" [imageUrl]="member.avatarUrl" [size]="30" />
                        <span class="min-w-0">
                          <span class="block truncate font-semibold">{{ member.name || member.email }}</span>
                          @if (member.name) {
                            <span class="block truncate text-meta text-muted-foreground">{{ member.email }}</span>
                          }
                        </span>
                      </div>
                    </td>
                    <td>
                      @if (member.mustChangePassword) {
                        <tk-badge tone="warning">{{ 'admin.members.tempPassword' | transloco }}</tk-badge>
                      } @else if (member.hasPassword) {
                        <span class="text-meta text-muted-foreground">{{ 'admin.members.password' | transloco }}</span>
                      } @else {
                        <span class="text-meta text-muted-foreground">{{ 'admin.members.emailCode' | transloco }}</span>
                      }
                      @if (!member.isActive) {
                        <tk-badge tone="neutral" class="ml-1.5">{{ 'admin.members.deactivated' | transloco }}</tk-badge>
                      }
                    </td>
                    <td>
                      <tk-select
                        size="sm"
                        [value]="member.role"
                        [disabled]="busyId() === member.id || member.id === myId()"
                        [ariaLabel]="'admin.members.role' | transloco"
                        (valueChange)="setRole(member, $any($event))"
                      >
                        @for (role of roles; track role) {
                          <tk-option [value]="role" [label]="'roles.' + role | transloco" />
                        }
                      </tk-select>
                    </td>
                    <td class="text-meta text-muted-foreground">
                      {{ member.lastLoginAt ? at(member.lastLoginAt) : ('admin.members.never' | transloco) }}
                    </td>
                    <td>
                      <div class="flex items-center justify-end gap-1.5">
                        @if (busyId() === member.id) {
                          <tk-spinner [size]="16" />
                        }
                        <button
                          tkButton
                          variant="outline"
                          size="sm"
                          [disabled]="busyId() === member.id"
                          (click)="reset(member)"
                        >
                          {{ 'admin.members.reset' | transloco }}
                        </button>
                        <!-- Deactivating yourself is refused by the API too; the
                             disabled state just avoids offering it. -->
                        @if (member.id !== myId()) {
                          <button
                            tkButton
                            variant="ghost"
                            size="sm"
                            [disabled]="busyId() === member.id"
                            (click)="setActive(member, !member.isActive)"
                          >
                            {{ (member.isActive ? 'admin.members.deactivate' : 'admin.members.reactivate') | transloco }}
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </tk-card>
      } @else if (members.error()) {
        <tk-alert tone="danger" [heading]="'admin.members.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="members.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-3">
          <span tkSkeleton class="h-10 w-full"></span>
          <span tkSkeleton class="h-56 w-full"></span>
        </div>
      }
    </div>

    <!-- ─────────── Add member ─────────── -->
    <tk-modal [(open)]="addOpen" [heading]="'admin.members.add' | transloco">
      <div class="space-y-4">
        <tk-field [label]="'admin.members.email' | transloco" for="member-email">
          <input tkInput inset id="member-email" type="email" [(ngModel)]="newEmail" placeholder="agent@company.com" />
        </tk-field>
        <tk-field [label]="'admin.members.name' | transloco" for="member-name">
          <input tkInput inset id="member-name" [(ngModel)]="newName" />
        </tk-field>
        <tk-field [label]="'admin.members.role' | transloco" for="member-role">
          <tk-select [(value)]="newRole" inputId="member-role">
            @for (role of roles; track role) {
              <tk-option [value]="role" [label]="'roles.' + role | transloco" />
            }
          </tk-select>
        </tk-field>
        <p class="text-meta text-muted-foreground">{{ 'admin.members.addHint' | transloco }}</p>
      </div>

      <div modal-footer class="flex justify-end gap-2">
        <button tkButton variant="outline" (click)="addOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canAdd() || adding()" (click)="add()">
          @if (adding()) {
            <tk-spinner [size]="16" />
          }
          {{ 'admin.members.create' | transloco }}
        </button>
      </div>
    </tk-modal>

    <!-- ─────────── The password, shown once ─────────── -->
    <tk-modal [(open)]="issuedOpen" [heading]="'admin.members.passwordIssued' | transloco">
      @if (issued(); as result) {
        <p class="text-body text-muted-foreground">
          {{ 'admin.members.passwordIssuedBody' | transloco: { email: result.email } }}
        </p>
        <div class="mt-3 flex items-center gap-2 rounded-xl bg-muted p-3">
          <code class="flex-1 break-all font-mono text-[15px] font-semibold">{{ result.temporaryPassword }}</code>
          <button tkButton variant="outline" size="sm" (click)="copy(result.temporaryPassword)">
            <tk-icon name="clipboard-list" [size]="15" />
            {{ 'common.copy' | transloco }}
          </button>
        </div>
        <tk-alert tone="warning" class="mt-3">{{ 'admin.members.passwordOnce' | transloco }}</tk-alert>
      }
      <div modal-footer class="flex justify-end">
        <button tkButton (click)="issuedOpen.set(false)">{{ 'common.done' | transloco }}</button>
      </div>
    </tk-modal>
  `,
})
export class AdminMembers {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly session = inject(SessionStore);
  private readonly transloco = inject(TranslocoService);

  protected readonly roles = ROLES;
  protected readonly members = resource({ loader: () => this.api.members() });

  protected readonly myId = computed(() => this.session.user()?.id ?? '');
  protected readonly busyId = signal<string | null>(null);

  protected readonly addOpen = signal(false);
  protected readonly newEmail = signal('');
  protected readonly newName = signal('');
  protected readonly newRole = signal<string>('agent');
  protected readonly adding = signal(false);

  protected readonly issuedOpen = signal(false);
  protected readonly issued = signal<AddMemberResult | null>(null);

  protected readonly canAdd = computed(() => /.+@.+\..+/.test(this.newEmail()));

  protected readonly errorText = computed(() => errorMessage(this.members.error()));

  /**
   * One active admin means one lost password away from an installation nobody
   * can administer — there is no CLI recovery and, without email, no reset link.
   */
  protected readonly soleAdmin = computed(() => {
    if (this.members.error()) return false;
    const rows = this.members.value();
    if (!rows) return false;
    return rows.filter((m) => m.role === 'admin' && m.isActive).length < 2;
  });

  protected at(value: string): string {
    return formatDateTime(value);
  }

  protected openAdd(): void {
    this.newEmail.set('');
    this.newName.set('');
    this.newRole.set('agent');
    this.addOpen.set(true);
  }

  protected async add(): Promise<void> {
    if (!this.canAdd() || this.adding()) return;
    this.adding.set(true);
    try {
      const result = await this.api.addMember({
        email: this.newEmail().trim(),
        name: this.newName().trim() || undefined,
        role: this.newRole() as UserRole,
      });
      this.addOpen.set(false);
      this.issued.set(result);
      this.issuedOpen.set(true);
      this.members.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.adding.set(false);
    }
  }

  protected async reset(member: Member): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.members.resetHeading', { name: member.name || member.email }),
      message: this.transloco.translate('admin.members.resetBody'),
      confirmLabel: this.transloco.translate('admin.members.reset'),
    });
    if (!ok) return;

    this.busyId.set(member.id);
    try {
      const result = await this.api.resetPassword(member.id);
      this.issued.set(result);
      this.issuedOpen.set(true);
      this.members.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busyId.set(null);
    }
  }

  protected async setRole(member: Member, role: UserRole): Promise<void> {
    if (role === member.role) return;
    await this.patch(member, { role });
  }

  protected async setActive(member: Member, isActive: boolean): Promise<void> {
    if (!isActive) {
      const ok = await this.confirm.ask({
        heading: this.transloco.translate('admin.members.deactivateHeading', {
          name: member.name || member.email,
        }),
        message: this.transloco.translate('admin.members.deactivateBody'),
        confirmLabel: this.transloco.translate('admin.members.deactivate'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    await this.patch(member, { isActive });
  }

  private async patch(member: Member, changes: { role?: UserRole; isActive?: boolean }): Promise<void> {
    this.busyId.set(member.id);
    try {
      await this.api.updateMember(member.id, changes);
      this.toast.success(this.transloco.translate('admin.members.saved'));
      this.members.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
      // Reload anyway: the row is showing whatever the failed edit left on
      // screen, and the server's answer is the one that counts.
      this.members.reload();
    } finally {
      this.busyId.set(null);
    }
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.transloco.translate('common.copied'));
    } catch {
      // Clipboard access can be refused; the password is on screen to read.
      this.toast.error(this.transloco.translate('common.copyFailed'));
    }
  }
}
