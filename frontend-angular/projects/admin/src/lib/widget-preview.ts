import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { brandVars } from '@trackly/core';
import { Icon } from '@trackly/ui';

/**
 * The live preview beside the Integration tab (docs/widget-plan.md § 8.2) — the
 * thing that makes a colour picker legible.
 *
 * <h3>Why a mock and not the real panel in an iframe</h3>
 * Two reasons, and the second is the one that decides it. An iframe would only
 * show what has been **saved**, so the colour picker would stop being a picker
 * and become a preview-after-the-fact. And loading `/widget/:token` opens a
 * visitor session — an admin looking at a settings screen would write a
 * `widget_visitors` row and appear in that widget's own usage data.
 *
 * So it is a mock: no data, no request, and it repaints on every keystroke. It
 * uses the same {@link brandVars} the real panel does, so the colour an admin
 * sees here is the colour a customer gets, including the black-or-white text
 * decision.
 */
@Component({
  selector: 'tk-widget-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Icon],
  template: `
    <div class="rounded-2xl border border-border bg-muted p-4">
      <p class="mb-3 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
        {{ 'admin.widget.preview' | transloco }}
      </p>

      <!-- Not interactive on purpose: it is a picture of the widget, and a
           preview whose buttons did nothing when clicked would be worse than one
           that plainly cannot be. -->
      <div
        class="mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        [style]="brand()"
        aria-hidden="true"
      >
        <div class="bg-primary px-3.5 py-3 text-primary-foreground">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14px] font-bold leading-tight">{{ headline() }}</p>
              @if (tagline()) {
                <p class="mt-0.5 truncate text-[11px] opacity-85">{{ tagline() }}</p>
              }
            </div>
            @if (showCloseButton()) {
              <tk-icon name="x" [size]="16" />
            }
          </div>
        </div>

        <div class="space-y-2 bg-background px-3 py-3">
          <div class="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-[11px] font-bold text-primary-ink"
            >
              A
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12px] text-foreground">
                <span class="font-semibold">{{ 'admin.widget.previewAgent' | transloco }}:</span>
                {{ 'admin.widget.previewMessage' | transloco }}
              </span>
            </span>
            <span class="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">1</span>
          </div>

          @if (showWidgetForm()) {
            <div class="rounded-xl border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
              {{ 'admin.widget.previewForm' | transloco }}
            </div>
          }
        </div>

        <div class="border-t border-border px-3 py-2.5">
          <div
            class="flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[12px] font-semibold text-primary-foreground"
          >
            <tk-icon name="message-square" [size]="14" />
            {{ 'widget.home.newConversation' | transloco }}
          </div>
        </div>

        @if (!hidePoweredBy()) {
          <p class="border-t border-border py-1 text-center text-[10px] text-muted-foreground">
            {{ 'widget.poweredBy' | transloco }}
          </p>
        }
      </div>

      @if (!hideLauncher()) {
        <div class="mt-3 flex justify-end pr-2">
          <span
            class="flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground shadow-lg"
            [style]="brand()"
            [style.background]="colour()"
            aria-hidden="true"
          >
            <tk-icon name="message-square" [size]="20" />
          </span>
        </div>
      }
    </div>
  `,
})
export class WidgetPreview {
  readonly name = input('');
  readonly greeting = input<string | null>(null);
  readonly tagline = input<string | null>(null);
  /** The effective colour: the widget's own, or the workspace's when it has none. */
  readonly colour = input<string>('#2563EB');
  readonly hideLauncher = input(false);
  readonly showWidgetForm = input(true);
  readonly showCloseButton = input(true);
  readonly hidePoweredBy = input(false);

  protected readonly brand = computed(() => brandVars(this.colour()));

  /** What the panel's title block would say to a visitor it has not met. */
  protected readonly headline = computed(() => this.greeting()?.trim() || this.name() || 'Support');
}
