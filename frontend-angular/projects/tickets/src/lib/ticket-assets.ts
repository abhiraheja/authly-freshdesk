import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  IMPACT_LEVELS,
  SessionStore,
  TicketsApi,
  errorMessage,
  type Tone,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * How bad, as a colour. Static strings — an interpolated tone would emit no CSS.
 */
const IMPACT_TONE: Record<string, Tone> = {
  down: 'danger',
  degraded: 'warning',
  minor: 'info',
};

/**
 * What the ticket is about (assets) and what it has broken (services).
 *
 * Together on one tab because they are the two halves of "what does this
 * touch": the thing you own, and the thing you promise. An agent triaging an
 * outage wants both in one glance.
 *
 * **The other-ticket count is the point of the asset half.** "This laptop has 4
 * other tickets" turns a register from a list of nouns into the reason to
 * replace the machine.
 */
@Component({
  selector: 'tk-ticket-assets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <!-- ── Assets ────────────────────────────────────────────────────────── -->
    <section class="mb-6">
      <h3 class="mb-2 text-body font-bold">{{ 'tickets.assets.title' | transloco }}</h3>

      @if (assets.value(); as list) {
        @if (list.length) {
          <ul class="mb-3 divide-y divide-border">
            @for (asset of list; track asset.id) {
              <li class="flex items-center gap-3 py-2">
                <tk-icon name="rocket" [size]="16" class="shrink-0 text-muted-foreground" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-body font-semibold">{{ asset.name }}</p>
                  <p class="truncate text-meta text-muted-foreground">
                    {{ describe(asset.kind, asset.tag, asset.location) }}
                  </p>
                </div>

                @if (asset.otherTicketCount) {
                  <!-- Links to the search rather than a bespoke screen: the list
                       already knows how to filter, and one more page to maintain
                       for the same answer is a page too many. -->
                  <a
                    class="shrink-0"
                    [routerLink]="['/dashboard/tickets']"
                    [queryParams]="{ q: asset.name }"
                  >
                    <tk-badge tone="warning">
                      {{ 'tickets.assets.otherTickets' | transloco: { count: asset.otherTicketCount } }}
                    </tk-badge>
                  </a>
                }

                <button
                  type="button"
                  class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  [disabled]="busy()"
                  [attr.aria-label]="'tickets.assets.remove' | transloco"
                  (click)="detach(asset.id)"
                >
                  <tk-icon name="x" [size]="15" />
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="mb-3 text-body text-muted-foreground">{{ 'tickets.assets.empty' | transloco }}</p>
        }

        <div class="flex items-center gap-2">
          <input
            tkInput
            inset
            inputSize="sm"
            class="min-w-0 flex-1"
            [attr.placeholder]="'tickets.assets.searchPlaceholder' | transloco"
            [attr.aria-label]="'tickets.assets.searchPlaceholder' | transloco"
            [ngModel]="assetQuery()"
            (ngModelChange)="assetQuery.set($event)"
          />
          @if (searching()) {
            <tk-spinner [size]="16" />
          }
        </div>

        @if (assetQuery().trim().length > 1 && assetMatches().length) {
          <ul class="mt-2 divide-y divide-border rounded-lg border border-border">
            @for (match of assetMatches(); track match.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                  [disabled]="busy()"
                  (click)="attach(match.id)"
                >
                  <span class="min-w-0 flex-1 truncate text-body">{{ match.name }}</span>
                  @if (match.tag) {
                    <span class="shrink-0 font-mono text-meta text-muted-foreground">{{ match.tag }}</span>
                  }
                </button>
              </li>
            }
          </ul>
        }
      } @else {
        <span tkSkeleton class="block h-20 w-full"></span>
      }
    </section>

    <!-- ── Impacted services ─────────────────────────────────────────────── -->
    <section>
      <h3 class="mb-1 text-body font-bold">{{ 'tickets.services.title' | transloco }}</h3>
      <p class="mb-2 text-meta text-muted-foreground">{{ 'tickets.services.hint' | transloco }}</p>

      @if (impacted.value(); as list) {
        @if (list.length) {
          <ul class="mb-3 divide-y divide-border">
            @for (row of list; track row.id) {
              <li class="flex items-start gap-3 py-2">
                <tk-badge class="mt-0.5 shrink-0" [tone]="levelTone(row.level)">
                  {{ levelLabel(row.level) }}
                </tk-badge>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-body font-semibold">{{ row.name }}</p>
                  @if (row.impact) {
                    <p class="text-meta text-muted-foreground">{{ row.impact }}</p>
                  }
                  @if (row.ownerTeamName) {
                    <p class="text-meta text-muted-foreground">
                      {{ 'tickets.services.owner' | transloco: { team: row.ownerTeamName } }}
                    </p>
                  }
                </div>
                <button
                  type="button"
                  class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  [disabled]="busy()"
                  [attr.aria-label]="'tickets.services.remove' | transloco"
                  (click)="clearImpact(row.id)"
                >
                  <tk-icon name="x" [size]="15" />
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="mb-3 text-body text-muted-foreground">{{ 'tickets.services.empty' | transloco }}</p>
        }

        <!-- An empty catalogue is not an empty ticket, and the fix is somewhere
             else entirely. Without this the agent gets a dropdown with nothing
             in it and no idea why. -->
        @if (catalogueEmpty()) {
          <tk-alert tone="info">
            {{ 'tickets.services.noCatalogue' | transloco }}
            @if (isAdmin()) {
              <a class="ml-1 font-semibold underline" routerLink="/admin/settings/catalogue">
                {{ 'tickets.services.openRegisters' | transloco }}
              </a>
            }
          </tk-alert>
        } @else {
        <div class="flex flex-wrap items-center gap-2">
          <tk-select
            inset
            size="sm"
            class="w-40"
            [ariaLabel]="'tickets.services.pick' | transloco"
            [(value)]="draftService"
          >
            <tk-option value="" [label]="'tickets.services.pick' | transloco" />
            @for (service of addableServices(); track service.id) {
              <tk-option [value]="service.id" [label]="service.name" />
            }
          </tk-select>
          <tk-select
            inset
            size="sm"
            class="w-32"
            [ariaLabel]="'tickets.services.levelLabel' | transloco"
            [(value)]="draftLevel"
          >
            @for (level of levels; track level) {
              <tk-option [value]="level" [label]="levelLabel(level)" />
            }
          </tk-select>
          <input
            tkInput
            inset
            inputSize="sm"
            class="min-w-0 flex-1"
            [attr.placeholder]="'tickets.services.impactPlaceholder' | transloco"
            [attr.aria-label]="'tickets.services.impactPlaceholder' | transloco"
            [ngModel]="draftImpact()"
            (ngModelChange)="draftImpact.set($event)"
            (keydown.enter)="addImpact()"
          />
          <button
            tkButton
            variant="outline"
            size="sm"
            [disabled]="busy() || !draftService()"
            (click)="addImpact()"
          >
            <tk-icon name="plus" [size]="14" />
            {{ 'tickets.services.add' | transloco }}
          </button>
        </div>
        }
      } @else if (impacted.error()) {
        <tk-alert tone="danger">{{ impactError() }}</tk-alert>
      } @else {
        <span tkSkeleton class="block h-16 w-full"></span>
      }
    </section>
  `,
})
export class TicketAssets {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(SessionStore);

  readonly ticketId = input.required<string>();

  protected readonly levels = IMPACT_LEVELS;
  protected readonly busy = signal(false);
  protected readonly assetQuery = signal('');
  protected readonly draftService = signal('');
  protected readonly draftLevel = signal<string>('degraded');
  protected readonly draftImpact = signal('');

  protected readonly assets = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketAssets(params.id),
  });

  protected readonly impacted = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketImpactedServices(params.id),
  });

  /** The whole catalogue: services are a short list, unlike assets. */
  private readonly catalogue = resource({ loader: () => this.api.services() });

  private readonly assetSearch = resource({
    params: () => ({ q: this.assetQuery().trim() }),
    loader: ({ params }) => (params.q.length > 1 ? this.api.assets(params.q) : Promise.resolve([])),
  });

  protected readonly searching = computed(() => this.assetSearch.isLoading());
  protected readonly impactError = computed(() => errorMessage(this.impacted.error()));

  /**
   * Nothing in the register to pick from.
   *
   * Checked against the LOADED value, not against the filtered list: a catalogue
   * with three services all already on this ticket is a different situation and
   * gets the ordinary empty picker, not a message telling an admin to go and
   * build one.
   */
  protected readonly catalogueEmpty = computed(() => this.catalogue.value()?.length === 0);

  /**
   * Only an admin can act on the message, so only an admin gets the link.
   *
   * Straight from the store — it already derives this, and a second copy of the
   * rule is a second place for it to be wrong.
   */
  protected readonly isAdmin = this.session.isAdmin;

  /** Already attached is not a result — offering it again is a click that does nothing. */
  protected readonly assetMatches = computed(() => {
    const on = new Set((this.assets.value() ?? []).map((a) => a.id));
    return (this.assetSearch.value() ?? []).filter((a) => !on.has(a.id));
  });

  protected readonly addableServices = computed(() => {
    const on = new Set((this.impacted.value() ?? []).map((s) => s.id));
    return (this.catalogue.value() ?? []).filter((s) => !on.has(s.id));
  });

  protected levelTone(level: string): Tone {
    return IMPACT_TONE[level] ?? 'neutral';
  }

  protected levelLabel(level: string): string {
    const key = `tickets.services.levels.${level}`;
    const text = this.transloco.translate(key);
    return text === key ? level : text;
  }

  /** Kind · tag · location, skipping whatever this asset does not have. */
  protected describe(kind: string | null, tag: string | null, location: string | null): string {
    return [kind, tag, location].filter(Boolean).join(' · ') || '—';
  }

  protected async attach(assetId: string): Promise<void> {
    await this.write(() => this.api.attachAsset(this.ticketId(), assetId), this.assets);
    this.assetQuery.set('');
  }

  protected async detach(assetId: string): Promise<void> {
    await this.write(() => this.api.detachAsset(this.ticketId(), assetId), this.assets);
  }

  protected async addImpact(): Promise<void> {
    const serviceId = this.draftService();
    if (!serviceId || this.busy()) return;
    await this.write(
      () =>
        this.api.setImpactedService(this.ticketId(), serviceId, {
          impact: this.draftImpact().trim() || null,
          level: this.draftLevel(),
        }),
      this.impacted,
    );
    this.draftService.set('');
    this.draftImpact.set('');
  }

  protected async clearImpact(serviceId: string): Promise<void> {
    await this.write(
      () => this.api.clearImpactedService(this.ticketId(), serviceId),
      this.impacted,
    );
  }

  private async write(
    action: () => Promise<unknown>,
    target: { reload: () => void },
  ): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      target.reload();
      this.busy.set(false);
    }
  }
}
