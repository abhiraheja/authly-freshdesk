import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  settled,
    STATUS_TONE,
  TicketsApi,
  errorMessage,
  valueOr,
  formatDateTime,
  timeAgo,
  toneFor,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  AvatarUpload,
  Badge,
  Button,
  Card,
  Icon,
  Modal,
  SkeletonDirective,
  Spinner,
  StatCard,
  ToastService,
} from '@trackly/ui';
import { CustomerForm } from './customer-form';

/**
 * Customer profile: who they are, what the workspace records about them, and
 * every ticket they have raised.
 *
 * The stats are counts the server computes, not derived from the ticket page
 * shown below — that list is paginated, so counting it would report "3 tickets"
 * for someone with thirty.
 */
@Component({
  selector: 'tk-customer-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    RouterLink,
    Alert,
    AvatarUpload,
    Badge,
    Button,
    Card,
    CustomerForm,
    Icon,
    Modal,
    SkeletonDirective,
    Spinner,
    StatCard,
  ],
  template: `
    <a
      class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
      routerLink="/dashboard/tickets"
    >
      <tk-icon name="arrow-left" [size]="16" />
      {{ 'tickets.title' | transloco }}
    </a>

    <!-- Value first: see the note in ticket-detail. A reload must not swap the
         page for a skeleton and take the open edit dialog with it. -->
    @if (loadedCustomer(); as person) {
      <div class="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div class="space-y-4">
          <tk-card>
            <div class="text-center">
              <tk-avatar-upload
                [name]="displayName()"
                [imageUrl]="person.avatarUrl"
                [size]="88"
                [uploading]="photoBusy()"
                [error]="photoError()"
                (selected)="uploadPhoto($event)"
                (removed)="removePhoto()"
              />
              <h1 class="mt-3 font-display text-section font-extrabold">{{ displayName() }}</h1>
              @if (person.company) {
                <p class="text-body text-muted-foreground">{{ person.company }}</p>
              }
              <span class="mt-2 inline-block">
                <tk-badge tone="primary">{{ 'role.' + person.role | transloco }}</tk-badge>
              </span>
            </div>

            <dl class="mt-5 space-y-2 text-body">
              @if (person.email) {
                <div class="flex items-center gap-2">
                  <tk-icon name="mail" [size]="15" class="shrink-0 text-muted-foreground" />
                  <a class="min-w-0 truncate hover:text-primary" [href]="'mailto:' + person.email">{{ person.email }}</a>
                </div>
              }
              @if (person.phone) {
                <div class="flex items-center gap-2">
                  <tk-icon name="phone" [size]="15" class="shrink-0 text-muted-foreground" />
                  <a class="min-w-0 truncate hover:text-primary" [href]="'tel:' + person.phone">{{ person.phone }}</a>
                </div>
              }
              @if (person.location) {
                <div class="flex items-center gap-2">
                  <tk-icon name="globe" [size]="15" class="shrink-0 text-muted-foreground" />
                  <span class="min-w-0 truncate">{{ person.location }}</span>
                </div>
              }
              <div class="flex items-center gap-2 text-muted-foreground">
                <tk-icon name="clock" [size]="15" class="shrink-0" />
                <span class="min-w-0 truncate">{{ 'customers.since' | transloco: { date: since() } }}</span>
              </div>
            </dl>

            <button tkButton variant="outline" size="sm" class="mt-4 w-full" (click)="openEdit()">
              <tk-icon name="pencil" [size]="15" />
              {{ 'customers.edit' | transloco }}
            </button>
          </tk-card>

          <!-- Whatever this workspace tracks. Rendered only when there is
               something — an empty "Details" card is noise. -->
          @if (fields().length) {
            <tk-card [heading]="'customers.customFields' | transloco">
              <dl class="space-y-2.5 text-body">
                @for (field of fields(); track field.key) {
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="min-w-0 truncate text-muted-foreground">{{ field.key }}</dt>
                    <dd class="min-w-0 truncate text-right font-semibold">{{ field.value }}</dd>
                  </div>
                }
              </dl>
            </tk-card>
          }
        </div>

        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-3">
            <tk-stat-card
              [label]="'customers.totalTickets' | transloco"
              icon="ticket"
              [value]="person.totalTickets"
            />
            <tk-stat-card
              [label]="'status.open' | transloco"
              icon="folder-open"
              tone="info"
              [value]="person.openTickets"
            />
            <tk-stat-card
              [label]="'customers.lastSeen' | transloco"
              icon="clock"
              tone="neutral"
              [value]="lastTicketAt()"
            />
          </div>

          <tk-card [heading]="'customers.previousTickets' | transloco" flush>
            @if (tickets.isLoading()) {
              <div class="flex items-center gap-2 p-5 text-body text-muted-foreground">
                <tk-spinner [size]="16" />
                {{ 'common.loading' | transloco }}
              </div>
            } @else {
              <ul class="divide-y divide-border">
                @for (ticket of ticketList(); track ticket.id) {
                  <li>
                    <a
                      class="flex items-center gap-3 px-5 py-3 hover:bg-accent/60"
                      [routerLink]="['/dashboard/tickets', ticket.id]"
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-body font-semibold">{{ ticket.subject }}</span>
                        <span class="block text-meta text-muted-foreground">
                          #{{ ticket.id.slice(0, 8) }} · {{ ago(ticket) }}
                        </span>
                      </span>
                      <tk-badge [tone]="statusOf(ticket).tone" dot>{{ statusOf(ticket).labelKey | transloco }}</tk-badge>
                    </a>
                  </li>
                } @empty {
                  <li class="px-5 py-8 text-center text-body text-muted-foreground">
                    {{ 'customers.noTickets' | transloco }}
                  </li>
                }
              </ul>
            }
          </tk-card>
        </div>
      </div>

      <tk-modal [(open)]="editing" [heading]="'customers.edit' | transloco" size="wide">
        <tk-customer-form
          #form
          emailLocked
          [email]="person.email ?? ''"
          [name]="person.name ?? ''"
          [phone]="person.phone ?? ''"
          [company]="person.company ?? ''"
          [location]="person.location ?? ''"
          [suggestedKeys]="suggestedKeys()"
        />
        <div modal-footer>
          <button tkButton variant="ghost" (click)="editing.set(false)">{{ 'common.cancel' | transloco }}</button>
          <button tkButton [disabled]="saving()" (click)="save()">
            @if (saving()) {
              <tk-spinner [size]="16" />
            }
            {{ 'common.save' | transloco }}
          </button>
        </div>
      </tk-modal>
    } @else if (customer.error()) {
      <tk-alert tone="danger" [heading]="'customers.loadFailed' | transloco">
        {{ errorText() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="customer.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-4">
        <span tkSkeleton class="h-7 w-64"></span>
        <span tkSkeleton class="h-40 w-full"></span>
      </div>
    }
  `,
})
export class CustomerDetail {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();

  protected readonly customer = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.customer(params.id),
  });

  protected readonly tickets = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.list({ requesterId: params.id, pageSize: 20 }),
  });

  private readonly fieldKeys = resource({ loader: () => this.api.ticketOptions('customer_field') });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedCustomer = settled(() => this.customer);
  protected readonly loadedTickets = settled(() => this.tickets);
  protected readonly suggestedKeys = computed(() => valueOr(this.fieldKeys, []).map((o) => o.label));

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly form = viewChild(CustomerForm);

  protected readonly photoBusy = signal(false);
  protected readonly photoError = signal<string | undefined>(undefined);

  protected readonly errorText = computed(() => errorMessage(this.customer.error()));
  protected readonly ticketList = computed(() => this.loadedTickets()?.items ?? []);
  protected readonly displayName = computed(() => {
    const person = this.loadedCustomer();
    return person?.name || person?.email || '—';
  });
  protected readonly since = computed(() => {
    const created = this.loadedCustomer()?.createdAt;
    return created ? formatDateTime(created) : '—';
  });

  /** Undefined, not a placeholder: the stat card renders "—" for a real gap. */
  protected readonly lastTicketAt = computed(() => {
    const latest = this.ticketList()[0];
    return latest ? timeAgo(latest.updatedAt) : undefined;
  });

  protected readonly fields = computed(() =>
    Object.entries(this.loadedCustomer()?.customFields ?? {}).map(([key, value]) => ({ key, value })),
  );

  constructor() {
    // The form is created inside the modal, so its custom-field rows can only be
    // seeded once it exists — hence an effect rather than a call in openEdit().
    effect(() => {
      const form = this.form();
      const person = this.loadedCustomer();
      if (form && person && this.editing()) form.setFields(person.customFields);
    });
  }

  protected statusOf(ticket: TicketSummary) {
    return toneFor(STATUS_TONE, ticket.status);
  }

  protected ago(ticket: TicketSummary): string {
    return timeAgo(ticket.updatedAt);
  }

  protected openEdit(): void {
    this.editing.set(true);
  }

  /**
   * Patches the loaded customer instead of reloading it.
   *
   * `reload()` would put the profile back on the wire and, worse, leave the old
   * photo on screen for the length of that round trip — the picker drops its
   * local preview the moment `uploading` goes false. The response already
   * carries the new URL, so there is nothing to go and ask for.
   */
  protected async uploadPhoto(file: File): Promise<void> {
    this.photoBusy.set(true);
    this.photoError.set(undefined);
    try {
      const { avatarUrl } = await this.api.uploadAvatar(this.id(), file);
      this.customer.update((current) => (current ? { ...current, avatarUrl } : current));
    } catch (error) {
      this.photoError.set(errorMessage(error));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async removePhoto(): Promise<void> {
    this.photoBusy.set(true);
    this.photoError.set(undefined);
    try {
      await this.api.removeAvatar(this.id());
      this.customer.update((current) => (current ? { ...current, avatarUrl: null } : current));
    } catch (error) {
      this.photoError.set(errorMessage(error));
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form) return;
    this.saving.set(true);
    try {
      await this.api.updateCustomer(this.id(), form.body());
      this.customer.reload();
      this.editing.set(false);
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
