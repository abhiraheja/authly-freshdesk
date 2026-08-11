import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AdminApi, errorMessage, settled, type EmailTestResult } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  Icon,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Workspace → Login: which ways in this installation offers.
 *
 * **The screen exists for its refusals.** Trackly is self-hosted — no support
 * desk, no recovery team — so turning off the last working method locks everyone
 * out permanently. A method only counts as working when it has been *proven*:
 * email needs a test message actually delivered, SSO needs a real login to have
 * completed. The server enforces this; the disabled switches here just explain
 * why before someone tries.
 */
@Component({
  selector: 'tk-admin-login-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Button, Card, Icon, SkeletonDirective, Spinner, Switch],
  template: `
    <div class="mx-auto max-w-[760px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.login.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.login.subtitle' | transloco }}</p>

      @if (loadedSettings(); as saved) {
        <div class="space-y-4">
          <tk-card [heading]="'admin.login.methods' | transloco">
            <div class="divide-y divide-border">
              <!-- Password. Listed first because it is the only method that works
                   on a fresh install, before SMTP or SSO exist. -->
              <div class="flex items-start justify-between gap-4 py-3 first:pt-0">
                <div class="min-w-0">
                  <p class="font-semibold">{{ 'admin.login.password' | transloco }}</p>
                  <p class="mt-0.5 text-meta text-muted-foreground">{{ 'admin.login.passwordHint' | transloco }}</p>
                  @if (saved.passwordLoginEnabled && !canDisablePassword()) {
                    <p class="mt-1.5 flex gap-1.5 text-meta text-muted-foreground">
                      <tk-icon name="lock" [size]="14" class="mt-0.5 shrink-0" />
                      <span>{{ 'admin.login.passwordLocked' | transloco }}</span>
                    </p>
                  }
                </div>
                <tk-switch
                  [checked]="saved.passwordLoginEnabled"
                  [disabled]="busy() || (saved.passwordLoginEnabled && !canDisablePassword())"
                  [ariaLabel]="'admin.login.password' | transloco"
                  (checkedChange)="save({ passwordLoginEnabled: $event })"
                />
              </div>

              <div class="flex items-start justify-between gap-4 py-3">
                <div class="min-w-0">
                  <p class="font-semibold">{{ 'admin.login.emailCode' | transloco }}</p>
                  <p class="mt-0.5 text-meta text-muted-foreground">{{ 'admin.login.emailCodeHint' | transloco }}</p>
                  @if (!saved.emailWorks) {
                    <p class="mt-1.5 flex gap-1.5 text-meta text-warning">
                      <tk-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
                      <span>{{ 'admin.login.emailUnproven' | transloco }}</span>
                    </p>
                  }
                </div>
                <tk-switch
                  [checked]="saved.emailLoginEnabled"
                  [disabled]="busy() || (saved.emailLoginEnabled && !canDisableEmail())"
                  [ariaLabel]="'admin.login.emailCode' | transloco"
                  (checkedChange)="save({ emailLoginEnabled: $event })"
                />
              </div>

              <!-- Read-only. SSO is configured on its own screen; this row is here
                   so the count of working methods is visible in one place. -->
              <div class="flex items-start justify-between gap-4 py-3 last:pb-0">
                <div class="min-w-0">
                  <p class="font-semibold">{{ 'admin.login.sso' | transloco }}</p>
                  <p class="mt-0.5 text-meta text-muted-foreground">
                    {{ (saved.ssoActive ? 'admin.login.ssoActive' : 'admin.login.ssoInactive') | transloco }}
                  </p>
                </div>
              </div>
            </div>
          </tk-card>

          <!-- The proof the password toggle depends on. Placed here rather than
               only on the Email screen because this is where an admin discovers
               they need it. -->
          <tk-card [heading]="'admin.login.emailProof' | transloco">
            <p class="text-body text-muted-foreground">{{ 'admin.login.emailProofBody' | transloco }}</p>

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button tkButton variant="outline" [disabled]="testing()" (click)="test()">
                @if (testing()) {
                  <tk-spinner [size]="16" />
                } @else {
                  <tk-icon name="send" [size]="16" />
                }
                {{ 'admin.login.sendTest' | transloco }}
              </button>

              @if (saved.emailWorks) {
                <span class="inline-flex items-center gap-1.5 text-meta text-success">
                  <tk-icon name="check-circle" [size]="14" />
                  {{ 'admin.login.emailProven' | transloco }}
                </span>
              }
            </div>

            @if (testResult(); as result) {
              <tk-alert
                class="mt-4"
                [tone]="result.ok ? 'success' : 'danger'"
                [heading]="(result.ok ? 'admin.login.testPassed' : 'admin.login.testFailed') | transloco"
              >
                {{ result.ok ? ('admin.login.testPassedBody' | transloco: { email: result.sentTo }) : result.error }}
              </tk-alert>
            }
          </tk-card>

          <tk-alert tone="info" [heading]="'admin.login.lockoutHeading' | transloco">
            {{ 'admin.login.lockoutBody' | transloco }}
          </tk-alert>
        </div>
      } @else if (settings.error()) {
        <tk-alert tone="danger" [heading]="'admin.login.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="settings.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-4">
          <span tkSkeleton class="h-48 w-full"></span>
          <span tkSkeleton class="h-32 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminLoginSettings {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly settings = resource({ loader: () => this.api.loginSettings() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedSettings = settled(() => this.settings);

  protected readonly busy = signal(false);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<EmailTestResult | null>(null);

  protected readonly errorText = computed(() => errorMessage(this.settings.error()));

  /**
   * Mirrors the server's rule so the UI can explain it, but it is not the
   * control — LoginSettingsController re-checks and refuses.
   */
  private readonly otherWorkingMethods = computed(() => {
    if (this.settings.error()) return 0;
    const saved = this.loadedSettings();
    if (!saved) return 0;
    return (saved.emailLoginEnabled && saved.emailWorks ? 1 : 0) + (saved.ssoActive ? 1 : 0);
  });

  protected readonly canDisablePassword = computed(() => this.otherWorkingMethods() > 0);

  protected readonly canDisableEmail = computed(() => {
    if (this.settings.error()) return false;
    const saved = this.loadedSettings();
    if (!saved) return false;
    return saved.passwordLoginEnabled || saved.ssoActive;
  });

  protected async save(changes: { passwordLoginEnabled?: boolean; emailLoginEnabled?: boolean }): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.saveLoginSettings(changes);
      this.toast.success(this.transloco.translate('admin.login.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Reload either way: on success to pick up the server's view, on failure
      // to put the switch back where the server still has it.
      this.settings.reload();
      this.busy.set(false);
    }
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const result = await this.api.testEmail();
      this.testResult.set(result);
      // A pass flips emailWorks, which is what unlocks the password toggle.
      if (result.ok) this.settings.reload();
    } catch (error) {
      this.testResult.set({ ok: false, error: errorMessage(error) });
    } finally {
      this.testing.set(false);
    }
  }
}
