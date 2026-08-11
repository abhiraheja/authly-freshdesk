import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TicketsApi, errorMessage, settled, valueOr, type TicketLink } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  ConfirmService,
  Icon,
  InputDirective,
  LabelDirective,
  SkeletonDirective,
  Spinner,
  ToastService,
  type IconName,
} from '@trackly/ui';

/** Kind → icon. Static lookup; an unknown kind falls back rather than breaking. */
const KIND_ICON: Record<string, IconName> = {
  story: 'clipboard-list',
  pr: 'git-pull-request',
  doc: 'file-text',
  related: 'link',
};

/**
 * Related work: the stories, PRs and docs a ticket is about.
 *
 * The resolve dialog asks for one link because at that moment there is one
 * answer — "what did I fix this under". This card is the ticket's full set, and
 * the resolve link is copied into it by the server so the two are never two
 * separate lists the agent has to check.
 *
 * Agent-facing. The API refuses these endpoints to anyone who is not an agent or
 * admin, so the card cannot leak onto a customer surface even if one imported it.
 */
@Component({
  selector: 'tk-ticket-links-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Button,
    Card,
    Icon,
    InputDirective,
    LabelDirective,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <tk-card
      [heading]="heading() || ('tickets.links.heading' | transloco)"
      collapsible
      [(collapsed)]="collapsed"
    >
      <div card-actions>
        @if (list().length) {
          <span class="text-meta font-bold text-muted-foreground">{{ list().length }}</span>
        }
      </div>

      @if (links.error()) {
        <tk-alert tone="danger">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="links.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else if (links.isLoading() && !loadedLinks()) {
        <span tkSkeleton class="h-12 w-full"></span>
      } @else {
        <ul class="space-y-2">
          @for (link of list(); track link.id) {
            <li class="flex items-start gap-2">
              <tk-icon [name]="icon(link)" [size]="15" class="mt-0.5 shrink-0 text-muted-foreground" />
              <!-- noopener noreferrer on every one: these point at trackers and
                   repos outside Trackly, and window.opener is not something to
                   hand to a URL any agent can paste. -->
              <a
                class="min-w-0 flex-1 truncate text-body font-semibold text-primary hover:underline"
                [href]="link.url"
                [title]="link.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ link.title || link.url }}
              </a>
              <button
                type="button"
                class="grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-danger"
                [attr.aria-label]="'tickets.links.remove' | transloco"
                (click)="remove(link)"
              >
                <tk-icon name="x" [size]="13" />
              </button>
            </li>
          } @empty {
            @if (!adding()) {
              <li class="text-meta text-muted-foreground">{{ 'tickets.links.empty' | transloco }}</li>
            }
          }
        </ul>
      }

      @if (adding()) {
        <div class="mt-3 space-y-2.5 border-t border-border pt-3">
          <div>
            <label tkLabel for="link-url">{{ 'tickets.links.url' | transloco }}</label>
            <input
              tkInput
              inset
              inputSize="sm"
              id="link-url"
              name="linkUrl"
              type="url"
              placeholder="https://…"
              [(ngModel)]="url"
            />
          </div>
          <div>
            <label tkLabel for="link-title">{{ 'tickets.links.label' | transloco }}</label>
            <input
              tkInput
              inset
              inputSize="sm"
              id="link-title"
              name="linkTitle"
              [placeholder]="'tickets.links.labelPlaceholder' | transloco"
              [(ngModel)]="title"
            />
          </div>
          @if (saveError(); as message) {
            <tk-alert tone="danger">{{ message }}</tk-alert>
          }
          <div class="flex justify-end gap-2">
            <button tkButton variant="ghost" size="sm" [disabled]="saving()" (click)="cancel()">
              {{ 'common.cancel' | transloco }}
            </button>
            <button tkButton size="sm" [disabled]="!canSave()" (click)="save()">
              @if (saving()) {
                <tk-spinner [size]="14" />
              }
              {{ 'tickets.links.add' | transloco }}
            </button>
          </div>
        </div>
      } @else {
        <button tkButton variant="outline" size="sm" class="mt-3 w-full" (click)="startAdd()">
          <tk-icon name="link" [size]="15" />
          {{ 'tickets.links.add' | transloco }}
        </button>
      }
    </tk-card>
  `,
})
export class TicketLinksCard {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();
  readonly collapsed = model(false);
  /** The rail's label for this card — a workspace may have renamed it. */
  readonly heading = input('');

  /**
   * Bumped by the parent after a resolve, which files its link here server-side.
   *
   * An input rather than a `viewChild` call, and driven from an effect rather
   * than from `params`: changing params resets the resource to undefined, which
   * would blank the list to a skeleton every time somebody resolves a ticket.
   */
  readonly version = input(0);

  protected readonly links = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketLinks(params.id),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedLinks = settled(() => this.links);

  constructor() {
    let seen = this.version();
    effect(() => {
      const current = this.version();
      if (current === seen) return;
      seen = current;
      this.links.reload();
    });
  }

  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly url = signal('');
  protected readonly title = signal('');

  protected readonly list = computed(() => valueOr(this.links, []));
  protected readonly loadError = computed(() => errorMessage(this.links.error()));

  /** Checked here too, so a typo does not cost a round trip to be told so. */
  protected readonly canSave = computed(
    () => !this.saving() && /^https?:\/\/\S+$/i.test(this.url().trim()),
  );

  protected icon(link: TicketLink): IconName {
    return KIND_ICON[link.kind] ?? 'link';
  }

  protected startAdd(): void {
    this.url.set('');
    this.title.set('');
    this.saveError.set(null);
    this.adding.set(true);
  }

  protected cancel(): void {
    this.adding.set(false);
    this.saveError.set(null);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.api.addTicketLink(this.ticketId(), {
        url: this.url().trim(),
        title: this.title().trim() || undefined,
      });
      this.adding.set(false);
      this.links.reload();
    } catch (error) {
      // Inline: the form is still on screen with what they typed, and "that
      // link is already on this ticket" is something to act on rather than an
      // outcome to acknowledge.
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(link: TicketLink): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('tickets.links.confirmDelete.heading'),
      message: this.transloco.translate('tickets.links.confirmDelete.message', {
        link: link.title || link.url,
      }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await this.api.deleteTicketLink(this.ticketId(), link.id);
      this.links.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    }
  }
}
