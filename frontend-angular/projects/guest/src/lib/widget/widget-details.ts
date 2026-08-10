import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button, Field, InputDirective, Spinner } from '@trackly/ui';

/**
 * "Enter your details" (docs/widget-plan.md § 8.1).
 *
 * Shown when the widget asks for it and the host page did not identify the
 * visitor, and re-asked at the start of every new conversation — **Skip** applies
 * to that conversation only. Anything already known pre-fills rather than
 * suppressing the form, so a visitor can correct what a host page got wrong.
 *
 * Nothing typed here proves anything (the trust rule, § 3.3). The name and email
 * become the ticket's guest columns, exactly as the public submit form's would.
 */
@Component({
  selector: 'tk-widget-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, Button, Field, InputDirective, Spinner],
  template: `
    <div class="flex h-full flex-col">
      <div class="flex-1 overflow-y-auto px-5 py-5">
        <p class="text-[15px] font-semibold text-foreground">{{ 'widget.details.heading' | transloco }}</p>
        <p class="mt-1 text-[13px] text-muted-foreground">{{ 'widget.details.body' | transloco }}</p>

        <div class="mt-5 space-y-4">
          <tk-field [label]="'widget.details.name' | transloco" for="widget-name" required>
            <input
              tkInput
              id="widget-name"
              name="widget-name"
              autocomplete="name"
              [(ngModel)]="name"
              [placeholder]="'widget.details.namePlaceholder' | transloco"
            />
          </tk-field>

          <tk-field [label]="'widget.details.email' | transloco" for="widget-email">
            <input
              tkInput
              id="widget-email"
              name="widget-email"
              type="email"
              inputmode="email"
              autocomplete="email"
              [(ngModel)]="email"
              placeholder="you@example.com"
            />
          </tk-field>

          <tk-field
            [label]="'widget.details.phone' | transloco"
            for="widget-phone"
            [hint]="'widget.details.phoneHint' | transloco"
          >
            <input
              tkInput
              id="widget-phone"
              name="widget-phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              [(ngModel)]="phone"
              placeholder="+44 7700 900000"
            />
          </tk-field>
        </div>
      </div>

      <div class="flex items-center gap-2 border-t border-border px-5 py-3">
        <button tkButton variant="ghost" [disabled]="busy()" (click)="skipped.emit()">
          {{ 'widget.details.skip' | transloco }}
        </button>
        <span class="flex-1"></span>
        <button tkButton [disabled]="busy() || !name().trim()" (click)="submit()">
          @if (busy()) {
            <tk-spinner [size]="16" />
          }
          {{ 'widget.details.submit' | transloco }}
        </button>
      </div>
    </div>
  `,
})
export class WidgetDetails {
  readonly busy = input(false);

  // Seeded through inputs rather than a method the parent calls: the parent
  // switches to this view and the component does not exist until the next
  // render, so a `viewChild(...).seed()` on the same tick writes to nothing.
  readonly initialName = input<string | null>(null);
  readonly initialEmail = input<string | null>(null);
  readonly initialPhone = input<string | null>(null);

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');

  readonly skipped = output<void>();
  readonly saved = output<{ name: string; mail: string; number: string }>();

  constructor() {
    // Pre-fill what is already known rather than suppressing the field, so a
    // visitor can correct what a host page got wrong (§ 8.1).
    effect(() => {
      untracked(() => {
        if (!this.name()) this.name.set(this.initialName() ?? '');
        if (!this.email()) this.email.set(this.initialEmail() ?? '');
        if (!this.phone()) this.phone.set(this.initialPhone() ?? '');
      });
      this.initialName();
      this.initialEmail();
      this.initialPhone();
    });
  }

  protected submit(): void {
    if (!this.name().trim()) return;
    this.saved.emit({
      name: this.name().trim(),
      mail: this.email().trim(),
      number: this.phone().trim(),
    });
  }
}
