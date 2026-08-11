import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
    PRIORITY_TONE,
  RELATION_KINDS,
  settled,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  relationEffect,
  toneFor,
  type RelationEffect,
  type TicketRelation,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  ToastService,
  type IconName,
} from '@trackly/ui';

/**
 * Effect → icon, and effect → colour. Two static lookups, because an interpolated
 * Tailwind class (`text-${tone}`) emits no CSS at all under v4 and fails silently.
 *
 * `blocks` and `blocked` share an icon on purpose: both mean "one of these cannot
 * move until the other does", and the two words beside it are what say which end
 * you are standing on. A second symbol would be a second thing to learn for the
 * same idea.
 */
const EFFECT_ICON: Record<RelationEffect, IconName> = {
  sync: 'copy',
  blocks: 'octagon-alert',
  blocked: 'octagon-alert',
  none: 'info',
};

const EFFECT_CLASS: Record<RelationEffect, string> = {
  sync: 'text-primary',
  blocks: 'text-warning-ink',
  blocked: 'text-warning-ink',
  none: 'text-muted-foreground',
};

/**
 * Related tickets: what else this one duplicates, blocks or was caused by.
 *
 * **The kind arrives already flipped.** The server stores one row per pair and
 * reads it from whichever end is asking, so "A blocks B" shows on B as "blocked
 * by A" without a second row that could fall out of step. Render `kind` as
 * given; do not re-derive it here.
 *
 * **A kind is a decision with consequences, so the consequence is on screen.**
 * Two of the seven do something: duplicates offer to resolve together, and
 * blocks/causes put a banner on the held-up ticket and ask before it is resolved.
 * The hint under the picker says which one is being chosen, and each row carries
 * the matching icon. Nothing here *performs* any of it — the server does, from
 * the same three sets (`relationEffect` in `@trackly/core`).
 *
 * Finding the other ticket is a search, not a picker: a workspace has thousands
 * of tickets and a dropdown of them is unusable by the second week. It takes a
 * ticket number as readily as words, because `#019fea6e` is what agents actually
 * have in front of them.
 */
@Component({
  selector: 'tk-ticket-relations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <!-- ── Associations: the problem this ticket belongs to ──────────────────
         A ticket has at most one, so this is a select rather than a list: the
         question is "which underlying cause is this", and there is one answer. -->
    <section class="mb-6">
      <h3 class="mb-1 text-body font-bold">{{ 'tickets.associations.title' | transloco }}</h3>
      <p class="mb-2 text-meta text-muted-foreground">{{ 'tickets.associations.hint' | transloco }}</p>

      <div class="flex flex-wrap items-center gap-2">
        <tk-select
          inset
          size="sm"
          class="min-w-0 flex-1"
          [ariaLabel]="'tickets.associations.title' | transloco"
          [disabled]="busy()"
          [value]="problemId()"
          (valueChange)="setProblem($event)"
        >
          <tk-option value="" [label]="'tickets.associations.none' | transloco" />
          @for (problem of problemList(); track problem.id) {
            <tk-option [value]="problem.id" [label]="problem.title" />
          }
        </tk-select>

        @if (problemId()) {
          <a
            class="inline-flex items-center gap-1.5 text-body font-semibold text-primary hover:underline"
            [routerLink]="['/dashboard/problems', problemId()]"
          >
            <tk-icon name="puzzle" [size]="14" />
            {{ 'tickets.associations.open' | transloco }}
          </a>
        }
      </div>
    </section>

    <h3 class="mb-2 text-body font-bold">{{ 'tickets.relations.title' | transloco }}</h3>

    <!-- Adding sits above the list: on a ticket with ten links, a form at the
         bottom is a scroll away from the button that reveals it. -->
    <div class="mb-1.5 flex flex-wrap items-center gap-2">
      <tk-select
        inset
        size="sm"
        class="w-44"
        [ariaLabel]="'tickets.relations.kindLabel' | transloco"
        [(value)]="kind"
      >
        @for (option of kinds; track option) {
          <tk-option [value]="option" [label]="kindLabel(option)" />
        }
      </tk-select>

      <input
        tkInput
        inset
        inputSize="sm"
        class="min-w-0 flex-1"
        [attr.placeholder]="'tickets.relations.searchPlaceholder' | transloco"
        [attr.aria-label]="'tickets.relations.searchLabel' | transloco"
        [ngModel]="query()"
        (ngModelChange)="query.set($event)"
      />

      @if (searching()) {
        <tk-spinner [size]="16" />
      }
    </div>

    <!-- What the kind will DO, in one line, at the moment it is chosen.
         "Duplicates" and "Blocks" are not labels for a feeling — one of them
         will offer to resolve another customer's ticket. The consequence belongs
         where the choice is made, not in a settings page nobody reads. -->
    <p class="mb-1 flex items-start gap-1.5 text-meta text-muted-foreground">
      <tk-icon [name]="effectIcon()" [size]="13" class="mt-0.5 shrink-0" [class]="effectClass()" />
      <span>{{ effectHint() | transloco }}</span>
    </p>

    <!-- Search accepts a ticket number as well as words, and says so. Agents read
         "#019fea6e" off every screen in Trackly and off each other's chat
         messages; a search box that only matched subjects made the number look
         decorative. -->
    <p class="mb-4 text-meta text-muted-foreground">{{ 'tickets.relations.searchHint' | transloco }}</p>

    <!-- Results only while something is typed: an idle list of "recent tickets"
         is a list nobody asked for taking up the space the links need. -->
    @if (searchable()) {
      @if (matches().length) {
        <ul class="mb-4 divide-y divide-border rounded-lg border border-border">
          @for (match of matches(); track match.id) {
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                [disabled]="busy()"
                (click)="link(match)"
              >
                <span class="font-mono text-meta text-muted-foreground">#{{ number(match.id) }}</span>
                <span class="min-w-0 flex-1 truncate text-body">{{ match.subject }}</span>
                <tk-badge [tone]="statusTone(match.statusCategory).tone" dot>{{ match.statusName }}</tk-badge>
              </button>
            </li>
          }
        </ul>
      } @else if (!searching()) {
        <!-- The empty answer, said out loud. Silence here is indistinguishable
             from a broken search — which is exactly how it read before. -->
        <p class="mb-4 rounded-lg border border-dashed border-border px-3 py-4 text-center text-meta text-muted-foreground">
          {{ 'tickets.relations.noMatches' | transloco: { query: query().trim() } }}
        </p>
      }
    }

    @if (loadedRelations(); as list) {
      @if (list.length) {
        <ul class="divide-y divide-border">
          @for (relation of list; track relation.id) {
            <li class="flex items-center gap-3 py-2.5">
              <!-- The kind, with the icon for what it does beside it. On a ticket
                   with six links, "which of these actually constrains me" is the
                   question, and reading six phrases to answer it is slower than
                   scanning one column of icons. -->
              <span class="flex w-32 shrink-0 items-center gap-1.5 text-meta font-semibold text-muted-foreground">
                <tk-icon
                  [name]="rowIcon(relation.kind)"
                  [size]="13"
                  class="shrink-0"
                  [class]="rowClass(relation.kind)"
                  [attr.aria-label]="('tickets.relations.effects.' + rowEffect(relation.kind)) | transloco"
                />
                {{ kindLabel(relation.kind) }}
              </span>

              <a
                class="min-w-0 flex-1"
                [routerLink]="['/dashboard/tickets', relation.ticketId]"
              >
                <span class="block truncate text-body font-semibold hover:text-primary">
                  {{ relation.subject }}
                </span>
                <span class="block font-mono text-meta text-muted-foreground">
                  #{{ number(relation.ticketId) }}
                </span>
              </a>

              <!-- statusName, not status: the raw value is workspace vocabulary
                   the rail already renders as something else, and two words for
                   one state reads as two systems. -->
              <tk-badge [tone]="statusTone(relation.statusCategory).tone" dot>{{ relation.statusName }}</tk-badge>
              <tk-badge [tone]="priorityTone(relation.priority).tone">
                {{ priorityTone(relation.priority).labelKey | transloco }}
              </tk-badge>

              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                [disabled]="busy()"
                [attr.aria-label]="'tickets.relations.remove' | transloco"
                (click)="unlink(relation)"
              >
                <tk-icon name="x" [size]="15" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="py-6 text-center text-body text-muted-foreground">
          {{ 'tickets.relations.empty' | transloco }}
        </p>
      }
    } @else if (relations.error()) {
      <tk-alert tone="danger" [heading]="'tickets.relations.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="relations.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <span tkSkeleton class="block h-24 w-full"></span>
    }
  `,
})
export class TicketRelations {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();

  /** The problem this ticket currently belongs to, from the parent's copy. */
  readonly linkedProblemId = input<string | null>(null);

  /** Fired after the association changes, so the parent can reload the ticket. */
  readonly problemChanged = output<void>();

  protected readonly kinds = RELATION_KINDS;
  protected readonly kind = signal<string>('relates');
  protected readonly query = signal('');
  protected readonly busy = signal(false);

  /** Short id, the way every screen in Trackly prints a ticket number. */
  protected number(id: string): string {
    return id.slice(0, 8);
  }

  /**
   * What picking the current kind will actually do.
   *
   * Three static lookups rather than an interpolated class name: `text-${tone}`
   * emits no CSS at all under Tailwind v4 and fails silently.
   */
  protected readonly effect = computed(() => relationEffect(this.kind()));

  protected readonly effectHint = computed(
    () => `tickets.relations.effects.${this.effect()}`,
  );

  protected readonly effectIcon = computed(() => EFFECT_ICON[this.effect()]);
  protected readonly effectClass = computed(() => EFFECT_CLASS[this.effect()]);

  /** The same three lookups, per row of the list rather than for the picker. */
  protected rowEffect(kind: string): RelationEffect {
    return relationEffect(kind);
  }

  protected rowIcon(kind: string): IconName {
    return EFFECT_ICON[relationEffect(kind)];
  }

  protected rowClass(kind: string): string {
    return EFFECT_CLASS[relationEffect(kind)];
  }

  /**
   * Whether what is typed is worth searching for.
   *
   * A leading `#` means a ticket number, and the server needs four hex digits of
   * one — so `#01` is still somebody mid-type, not a query. Without the `#`, two
   * characters is the floor: one letter matches most of the queue.
   */
  protected readonly searchable = computed(() => {
    const value = this.query().trim();
    return value.startsWith('#') ? value.length >= 5 : value.length > 1;
  });

  /**
   * The select's own value.
   *
   * A local signal seeded from the input rather than binding the input directly:
   * the write is asynchronous, and a select that snapped back to the old value
   * for the length of a round trip would look like the click did not land.
   */
  protected readonly problemId = signal('');

  private readonly problems = resource({ loader: () => this.api.problems() });
  protected readonly problemList = computed(() => this.loadedProblems() ?? []);

  constructor() {
    effect(() => {
      const linked = this.linkedProblemId() ?? '';
      untracked(() => this.problemId.set(linked));
    });
  }

  /**
   * Links or unlinks in one action.
   *
   * Unlink is keyed by the TICKET, not the problem — a ticket belongs to at most
   * one, so "which problem am I leaving" is never a question the caller has to
   * answer.
   */
  protected async setProblem(id: string): Promise<void> {
    const previous = this.problemId();
    if (id === previous) return;
    this.problemId.set(id);
    this.busy.set(true);
    try {
      if (id) await this.api.linkProblem(id, this.ticketId());
      else await this.api.unlinkProblem(this.ticketId());
      this.problemChanged.emit();
    } catch (error) {
      // Put the select back: leaving it on a value the server refused is a
      // screen that disagrees with the database.
      this.problemId.set(previous);
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly relations = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketRelations(params.id),
  });

  /**
   * Search results.
   *
   * The term goes to the server as typed, `#` and all: the API is what decides
   * that a leading hash means a ticket number, so the two cannot disagree about
   * what was searched for. `searchable` is only about not spending a round trip on
   * half a word.
   */
  private readonly search = resource({
    params: () => ({ id: this.ticketId(), q: this.searchable() ? this.query().trim() : '' }),
    loader: ({ params }) =>
      params.q
        ? this.api.list({ search: params.q, pageSize: 8 })
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 8 }),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedProblems = settled(() => this.problems);
  protected readonly loadedRelations = settled(() => this.relations);
  protected readonly loadedSearch = settled(() => this.search);

  protected readonly searching = computed(() => this.search.isLoading());
  protected readonly loadError = computed(() => errorMessage(this.relations.error()));

  /** The ticket you are on, and anything already linked, are not results. */
  protected readonly matches = computed(() => {
    const linked = new Set((this.loadedRelations() ?? []).map((r) => r.ticketId));
    return (this.loadedSearch()?.items ?? []).filter(
      (t) => t.id !== this.ticketId() && !linked.has(t.id),
    );
  });

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  protected kindLabel(kind: string): string {
    const key = `tickets.relations.kinds.${kind}`;
    const text = this.transloco.translate(key);
    return text === key ? kind.replace(/_/g, ' ') : text;
  }

  protected async link(match: TicketSummary): Promise<void> {
    await this.write(() =>
      this.api.addTicketRelation(this.ticketId(), {
        relatedTicketId: match.id,
        kind: this.kind(),
      }),
    );
    // Cleared on success so the results collapse — leaving them up invites a
    // second click on a row that is now already linked.
    this.query.set('');
  }

  protected async unlink(relation: TicketRelation): Promise<void> {
    await this.write(() => this.api.deleteTicketRelation(this.ticketId(), relation.id));
  }

  private async write(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.relations.reload();
      this.busy.set(false);
    }
  }
}
