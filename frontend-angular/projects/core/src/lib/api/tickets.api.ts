import { Injectable, inject } from '@angular/core';
import { ApiService, type QueryParams, type UploadProgress } from './api.service';

export interface Category {
  id: string;
  name: string;
  color: string | null;
  /** Null for a top-level category; set makes this a sub-category. Two levels only. */
  parentId: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

/** A workspace tag plus its usage — drives suggestion ordering. */
export interface TagUsage extends Tag {
  ticketCount: number;
}

/**
 * What the model thinks, for the agent to accept or ignore.
 *
 * `rationale` is not decoration — a suggestion with no stated reason is one an
 * agent can only take on faith, and these are applied to real customer tickets.
 */
export interface TriageSuggestion {
  priority: string;
  category: string | null;
  tags: string[];
  sentiment: string;
  rationale: string;
}

/**
 * A workspace vocabulary. Stored in `ticket_options` — the table predates
 * `customer_field` and the name stayed; the shape (workspace, kind, value,
 * label, order, active) fits all three unchanged.
 */
export type TicketOptionKind = 'priority' | 'channel' | 'customer_field' | 'ticket_panel';

/**
 * The cards the ticket view's right rail can draw.
 *
 * The keys belong to Trackly — the rail switches on them to choose a renderer —
 * so a workspace reorders, relabels and hides them but never invents one. That
 * is why every `ticket_panel` option comes back `isSystem`.
 */
export type TicketPanelKey =
  | 'info'
  | 'resolution'
  | 'sla'
  | 'ai'
  | 'customer'
  | 'properties'
  | 'related'
  | 'watchers'
  | 'time'
  | 'actions';

/**
 * One admin-configured choice for a fixed-vocabulary ticket field.
 *
 * `value` is what sits on the ticket and what automation matches; `label` is
 * what people read. That split is what lets an admin rename an option without
 * rewriting stored tickets — so bind `value` and render `label`, never the
 * other way round.
 */
export interface TicketOption {
  id: string;
  kind: TicketOptionKind;
  value: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Ships with Trackly: relabel and deactivate yes, delete no. */
  isSystem: boolean;
}

/**
 * A department. Trackly calls these teams internally because they also carry
 * routing — a ticket filed into one is round-robin'd within its members.
 */
export interface Team {
  id: string;
  name: string;
  members: UserSummary[];
  /** Null for a department; set makes this a sub-department. Two levels only. */
  parentId: string | null;
}

export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  /**
   * API path to their photo, or null for the initials fallback. Never a storage
   * URL — the server decides whether to stream the bytes or redirect to a CDN.
   */
  avatarUrl: string | null;
}

/**
 * Everything a workspace keeps about a customer.
 *
 * `customFields` is deliberately open: support desks track different things
 * (account number, plan, region), and a fixed schema would mean a migration
 * every time one of them needed another. Configuration defines *suggested*
 * keys; it never restricts what can be saved.
 */
export interface Customer extends UserSummary {
  phone: string | null;
  company: string | null;
  location: string | null;
  customFields: Record<string, string>;
}

/** Customer plus the counts the profile page shows. */
export interface CustomerDetail extends Customer {
  isActive: boolean;
  createdAt: string;
  totalTickets: number;
  openTickets: number;
}

/**
 * One row of the Customers list.
 *
 * `lastLoginAt` null is the interesting case, not a missing value: a customer with
 * tickets who has never signed in is somebody emailing the desk who does not know
 * the portal exists.
 */
export interface CustomerRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  location: string | null;
  isActive: boolean;
  createdAt: string;
  /** Null means they have never signed in. */
  lastLoginAt: string | null;
  avatarUrl: string | null;
  totalTickets: number;
  openTickets: number;
  /** Null when they have never raised one. */
  lastTicketAt: string | null;
}

export interface CustomerListParams {
  search?: string;
  /** `yes` · `no` · omitted for both. */
  signedIn?: string;
  includeInactive?: boolean;
  /** `newest` (default) · `name` · `tickets` · `lastSeen`. */
  sort?: string;
  page?: number;
  pageSize?: number;
}

/** Counted over every customer, active or not. */
export interface CustomerSummary {
  total: number;
  active: number;
  signedIn: number;
  /** Never signed in AND has at least one ticket — the number worth acting on. */
  neverSignedInWithTickets: number;
  withOpenTickets: number;
  newThisMonth: number;
}

export interface CustomerBody {
  email?: string;
  name?: string;
  phone?: string;
  company?: string;
  location?: string;
  customFields?: Record<string, string>;
}

export interface TicketSummary {
  id: string;
  subject: string;
  /** The workspace status value. Never switch on it — see statusCategory. */
  status: string;
  /**
   * One of the fixed five. **Badge, group and reason by this**, because the
   * status is workspace vocabulary and a client that switched on it would go
   * blank the moment somebody added one.
   */
  statusCategory: string;
  /** What the workspace calls it. Render this. */
  statusName: string;
  priority: string;
  channel: string;
  category: Category | null;
  /**
   * The department the ticket is routed to — a team in the schema, "Dept" in
   * the UI. Null on customer and guest surfaces, where the API withholds it:
   * which internal team owns a ticket is routing detail, like the tags and the
   * SLA beside it.
   */
  teamId: string | null;
  teamName: string | null;
  requester: UserSummary | null;
  guestName: string | null;
  guestEmail: string | null;
  assignee: UserSummary | null;
  commentCount: number;
  /**
   * YOUR pin, not anybody else's — a private bookmark that sorts this to the top
   * of your own list. False on customer surfaces, where it means nothing.
   */
  isPinned: boolean;
  /** Flagged for the whole team; null when it is not. Shared, unlike a pin. */
  flaggedAt: string | null;
  flagReason: string | null;
  tags: Tag[];
  firstResponseDueAt: string | null;
  resolveDueAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Watcher {
  agent: UserSummary;
  addedAt: string;
}

/**
 * What a bulk action is. One per request — the server refuses a payload that
 * tries to do two, because there is no honest way to report a batch where the
 * assign worked and the resolve did not.
 */
export type TicketBulkAction =
  | 'assign'
  | 'priority'
  | 'status'
  | 'tag'
  | 'pin'
  | 'flag'
  | 'delete';

export interface TicketBulkRequest {
  ids: string[];
  action: TicketBulkAction;
  /** Omit and set `unassign` to take the ticket off whoever has it. */
  assigneeId?: string | null;
  unassign?: boolean;
  priority?: string;
  status?: string;
  /**
   * Shared by every ticket in the batch when the status ends the work. One note
   * for many tickets is a real limitation; say so in the UI.
   */
  resolutionNote?: string;
  resolutionSummary?: string;
  /** Added to what each ticket already carries — never a replacement. */
  tags?: string[];
  /** For the two toggles: true sets, false clears. */
  on?: boolean;
  reason?: string | null;
}

export interface TicketBulkFailure {
  id: string;
  /** Named, so the agent can act on it. Falls back to the short id. */
  subject: string;
  reason: string;
}

/**
 * **Partial results are the normal case**, not an error path. A batch that hit
 * a workflow rule on three of forty resolves with `succeeded: 37` and three
 * entries in `failed` — the request did not fail, so nothing rejects.
 */
export interface TicketBulkResult {
  succeeded: number;
  failed: TicketBulkFailure[];
  requested: number;
}

export interface TicketDetail extends Omit<TicketSummary, 'commentCount'> {
  description: string;
  watchers: Watcher[];
  problemId: string | null;
  problemTitle: string | null;
  // teamId / teamName come from TicketSummary — the list needs them too.
  /** The narrower answers. Each sits under the one above it; clearing the parent clears it. */
  subCategory: Category | null;
  subTeamId: string | null;
  subTeamName: string | null;

  /**
   * Why the ticket was resolved or closed, and by whom. Null while it is open,
   * and cleared again if it is reopened — the internal note in the thread keeps
   * the history.
   *
   * Agent-facing: the API sends null to every non-agent caller, so a customer
   * surface never receives it (invariant 5).
   */
  resolutionNote: string | null;
  resolutionLink: string | null;
  /**
   * What the customer is told, in plain words — the one part of the resolution
   * that is written to be read by them, and so the one part every surface gets.
   */
  resolutionSummary: string | null;
  resolvedBy: UserSummary | null;
  resolvedAt: string | null;

  /**
   * What else is attached, so the screen can be right on first paint.
   *
   * All agent-facing, and all sent with the ticket rather than fetched per tab:
   * these decide the tab counts and whether the "blocked by" banner shows, which
   * are things the agent should see before they click, not after.
   *
   * `relations` is null on a customer surface — which other tickets this resembles
   * is internal, and their subjects usually belong to other customers.
   */
  relations: TicketRelationSummary | null;
  assetCount: number;
  impactedServiceCount: number;
  /** How many of those services are fully down rather than degraded. */
  downServiceCount: number;
  openTaskCount: number;
  /** Responders who have not written anything on this ticket yet. */
  pendingResponderCount: number;
}

/**
 * How one ticket relates to another. Already flipped to read from the ticket you
 * are looking at, so render `kind` as given.
 */
export type RelationKind =
  | 'relates'
  | 'duplicates'
  | 'duplicated_by'
  | 'blocks'
  | 'blocked_by'
  | 'caused_by'
  | 'causes';

/** What the picker offers. `relates` first — it is the one people mean. */
export const RELATION_KINDS: readonly RelationKind[] = [
  'relates',
  'duplicates',
  'duplicated_by',
  'blocks',
  'blocked_by',
  'caused_by',
  'causes',
];

/**
 * What a kind actually *does*, as three sets rather than seven cases.
 *
 * Mirrors `TicketRelationKind` on the server, and the mirror is deliberate: the
 * UI has to explain the consequence at the moment somebody picks a kind — that is
 * the only moment they are thinking about it — while the server is what enforces
 * it. Neither can be derived from the other at runtime, so they are kept side by
 * side and both named after the same three ideas.
 *
 * `relates` is in none of them. It is the kind for "a human should know these are
 * connected", and giving it behaviour would make the vague, safe choice the
 * dangerous one.
 */
export const RELATION_SYNCS_STATUS: readonly string[] = ['duplicates', 'duplicated_by'];
/** Read on a ticket: this one holds the other up. */
export const RELATION_BLOCKS_OTHER: readonly string[] = ['blocks', 'causes'];
/** Read on a ticket: this one is held up by the other. */
export const RELATION_BLOCKED_BY_OTHER: readonly string[] = ['blocked_by', 'caused_by'];

/**
 * Which of the three consequences a kind carries — for the one-line hint under
 * the picker, and the icon on each row.
 *
 * A single string rather than three booleans because a kind has exactly one
 * effect, and a shape that can express "syncs and blocks" would invite a UI that
 * has to decide what that looks like.
 */
export type RelationEffect = 'sync' | 'blocks' | 'blocked' | 'none';

export function relationEffect(kind: string): RelationEffect {
  if (RELATION_SYNCS_STATUS.includes(kind)) return 'sync';
  if (RELATION_BLOCKS_OTHER.includes(kind)) return 'blocks';
  if (RELATION_BLOCKED_BY_OTHER.includes(kind)) return 'blocked';
  return 'none';
}

export interface TicketRelation {
  id: string;
  kind: string;
  /** The OTHER ticket — never the one you are looking at. */
  ticketId: string;
  subject: string;
  /** The workspace status VALUE. Never switch on it — see statusCategory. */
  status: string;
  /** What the workspace calls that status. Render this. */
  statusName: string;
  statusCategory: string;
  priority: string;
  createdBy: UserSummary | null;
  createdAt: string;
  /** True when the row was written on the other ticket and read backwards here. */
  mirrored: boolean;
}

/**
 * Another ticket, described just far enough to decide something about it — a
 * banner row, a warning, a checkbox in the resolve dialog.
 *
 * Not a `TicketSummary`: none of the tags, SLA stamps or pins on one mean
 * anything in a list of "these three are the same issue".
 */
export interface LinkedTicket {
  id: string;
  subject: string;
  status: string;
  statusName: string;
  statusCategory: string;
  priority: string;
  assignee: UserSummary | null;
  createdAt: string;
}

/**
 * The links on a ticket, as the detail screen needs them before the agent has
 * clicked anything: how many there are, and which are holding it up.
 *
 * Arrives with the ticket rather than from its own endpoint so the banner and the
 * tab count are there on first paint. A count that lands a round trip later reads
 * as the page finishing badly.
 */
export interface TicketRelationSummary {
  /** Every link, whatever the kind — the number on the Related tab. */
  total: number;
  /** How many of them say "same issue". */
  duplicateCount: number;
  /** Open tickets holding this one up. Non-empty means the banner shows. */
  blockers: LinkedTicket[];
  /** Open tickets this one is holding up — who starts moving when it ends. */
  blocking: LinkedTicket[];
}

/** A group of tickets with one underlying cause. Agent-facing. */
export interface ProblemSummary {
  id: string;
  title: string;
  status: string;
  assignee: UserSummary | null;
  ticketCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * A problem's own lifecycle, which is **not** a ticket's.
 *
 * A ticket asks "has this person been helped?"; a problem asks "do we understand
 * the cause, and is it still happening?". Mapping one onto the other would lose
 * the two states in the middle, which are the whole reason an incident gets a
 * problem instead of a tag.
 */
export const PROBLEM_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type ProblemStatusValue = (typeof PROBLEM_STATUSES)[number];

export interface ProblemDetail extends ProblemSummary {
  description: string | null;
  createdBy: UserSummary | null;
  /** Every ticket filed under this cause, newest activity first. */
  tickets: TicketSummary[];
}

export interface UpdateProblemBody {
  title?: string;
  description?: string;
  status?: string;
  assigneeId?: string;
  unassign?: boolean;
}

/** A reusable reply snippet, inserted from the ⚡ button in the composer. */
export interface CannedResponse {
  id: string;
  title: string;
  body: string;
}

export interface SaveCannedResponse {
  title: string;
  body: string;
}

/** A step on the ticket.  null means open — there is no second flag. */
export interface TicketTask {
  id: string;
  title: string;
  assignee: UserSummary | null;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: UserSummary | null;
  sortOrder: number;
  createdAt: string;
}

/** Someone working the ticket alongside the assignee. A watcher reads; this one does. */
export interface TicketResponder {
  agent: UserSummary;
  role: string | null;
  addedAt: string;
}

/** A thing the workspace owns and supports. */
export interface Asset {
  id: string;
  name: string;
  kind: string | null;
  tag: string | null;
  location: string | null;
  assignedTo: UserSummary | null;
  notes: string | null;
  isActive: boolean;
  /** Every ticket ever raised about it — its history. */
  ticketCount: number;
  /** Tickets about it that are still going — its state today. */
  openTicketCount: number;
  /** When it was last the subject of one. Null means never, which is good news. */
  lastTicketAt: string | null;
}

/**
 * The register in aggregate — what the workspace owns, what is out with somebody,
 * and where it all is.
 *
 * An audit answer, not a list: "what have we handed out and to whom" cannot be
 * read off two hundred rows by scrolling them.
 */
export interface AssetSummary {
  total: number;
  assigned: number;
  /** On the shelf — the number that answers "what can I give somebody". */
  unassigned: number;
  /** Distinct assets named on an unfinished ticket right now. */
  inTrouble: number;
  byKind: AssetBucket[];
  byLocation: AssetBucket[];
  /** Who is holding the most, largest first. */
  topHolders: AssetHolder[];
}

/** `value` null or empty means that column was never filled in. */
export interface AssetBucket {
  value: string | null;
  count: number;
}

export interface AssetHolder {
  id: string;
  name: string;
  count: number;
}

/** One ticket in an asset's history. Deliberately thin — this is a drill-down. */
export interface AssetTicket {
  id: string;
  subject: string;
  status: string;
  statusName: string;
  statusCategory: string;
  priority: string;
  assignee: UserSummary | null;
  createdAt: string;
}

export interface TicketAsset {
  id: string;
  name: string;
  kind: string | null;
  tag: string | null;
  location: string | null;
  assignedTo: UserSummary | null;
  addedAt: string;
  /** Other tickets about the same asset — the number that turns a register into a diagnosis. */
  otherTicketCount: number;
}

/** Something the business runs that customers depend on. */
export interface BusinessService {
  id: string;
  name: string;
  description: string | null;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
  isActive: boolean;
  sortOrder: number;
  openTicketCount: number;
  /**
   * The worst impact any open ticket reports, or null when nothing is wrong.
   *
   * The WORST rather than the newest: a service with four "degraded" reports and
   * one "down" is down. Colour the row by this; `openTicketCount` is how many
   * people are saying it.
   */
  worstLevel: string | null;

  /**
   * How this service is deployed. Read by release plans, which COPY it when the
   * service is added so that editing the catalogue never rewrites what an old
   * release says was run.
   */
  pipelineUrl: string | null;
}

/** One open ticket saying a service is affected — the drill-down from the board. */
export interface ServiceTicket {
  id: string;
  subject: string;
  status: string;
  statusName: string;
  statusCategory: string;
  priority: string;
  assignee: UserSummary | null;
  /** How badly THIS ticket says the service is affected. */
  level: string;
  /** The agent's own words, if they wrote any. */
  impact: string | null;
  addedAt: string;
}

export type ImpactLevel = 'down' | 'degraded' | 'minor';
export const IMPACT_LEVELS: readonly ImpactLevel[] = ['down', 'degraded', 'minor'];

export interface TicketImpactedService {
  id: string;
  name: string;
  impact: string | null;
  level: string;
  ownerTeamName: string | null;
  addedAt: string;
}

/** The four shapes a workspace-defined property can take. */
export type TicketFieldType = 'text' | 'select' | 'radio' | 'checkbox';
export const TICKET_FIELD_TYPES: readonly TicketFieldType[] = ['text', 'select', 'radio', 'checkbox'];

/** Whether this type is filled in from a list of choices. */
export function fieldHasOptions(type: string): boolean {
  return type === 'select' || type === 'radio';
}

export interface TicketField {
  id: string;
  key: string;
  label: string;
  type: string;
  helpText: string | null;
  options: string[];
  /** A select that accepts a new value and remembers it for next time. */
  allowNewOptions: boolean;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}

/** A field plus this ticket's answer, so the form renders from one call. */
export interface TicketFieldAnswer extends Omit<TicketField, 'sortOrder'> {
  /** False means retired — shown only because this ticket already answered it. */
  isActive: boolean;
  value: string | null;
}

/** One sitting of work on a ticket. */
export interface TimeEntry {
  id: string;
  user: UserSummary;
  minutes: number;
  note: string | null;
  spentAt: string;
  createdAt: string;
}

export interface LogTimeBody {
  minutes: number;
  note?: string;
  /** When the work happened. Defaults to now. */
  spentAt?: string;
}

/**
 * The five buckets every status falls into. **Fixed** — a workspace adds
 * statuses, never categories, because every rule in Trackly is written against
 * this list.
 */
export type StatusCategory = 'open' | 'pending' | 'active' | 'resolved' | 'closed';

export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  'open',
  'pending',
  'active',
  'resolved',
  'closed',
];

/** The work is over — no clock, no queue. */
export function isTerminalCategory(category: string): boolean {
  return category === 'resolved' || category === 'closed';
}

/**
 * A status as the workspace defines it.
 *
 * `value` is what sits on the ticket and what automation matches; `name` is what
 * people read. Bind `value`, render `name` — never the other way round.
 */
export interface TicketStatus {
  id: string;
  category: string;
  value: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Where a new ticket starts. Exactly one per workspace. */
  isDefault: boolean;
  /** Ships with Trackly: rename and retire yes, delete no. */
  isSystem: boolean;
}

/** One legal move. `fromStatusId: null` means "from any status". */
export interface StatusTransition {
  id: string;
  fromStatusId: string | null;
  toStatusId: string;
}

/**
 * One entry in a ticket's audit trail.
 *
 * The server stores what changed, never a sentence — the wording is built here
 * so it reads in the language the agent has selected rather than the one
 * whoever made the change happened to be using.
 *
 * `fromLabel` / `toLabel` are the labels **as they read at the time**. A status
 * renamed since does not rewrite the entry, which is the point of an audit
 * trail. `actor` null means Trackly did it: automation, an inbound email, the
 * SLA clock.
 */
export interface TicketActivity {
  id: string;
  type: string;
  fromLabel: string | null;
  toLabel: string | null;
  actor: UserSummary | null;
  createdAt: string;
}

/** What Trackly offers in the picker — the server accepts any string. */
export type TicketLinkKind = 'related' | 'story' | 'pr' | 'doc';

/**
 * Work elsewhere that a ticket is about: a user story, a PR, a doc.
 *
 * Agent-facing. The API sends these to agents and admins only, so nothing here
 * can leak onto a customer or guest surface (invariant 5).
 */
export interface TicketLink {
  id: string;
  url: string;
  title: string | null;
  kind: string;
  createdBy: UserSummary | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  commentId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: UserSummary | null;
  guestEmail: string | null;
  body: string;
  /**
   * "html" (the rich composer, sanitised server-side) or "text" (everything
   * else: email replies, guest replies, and every row written before the
   * composer existed).
   *
   * **Branch on this, never sniff the body.** "&lt;3 that fix" is plain text
   * that reads as markup, and guessing wrong shows a customer a broken tag
   * instead of their own words.
   */
  bodyFormat: string;
  /**
   * Coarse "the customer must not see this" flag. Still what every
   * customer-facing filter tests (invariant 5).
   */
  isInternal: boolean;
  /**
   * The finer three: `public` (the customer sees it), `internal` (every agent
   * does), `private` (only the author — the API does not send anyone else's).
   *
   * Style by this; gate by nothing here. The API already decided what you are
   * allowed to receive.
   */
  visibility: string;
  source: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface DashboardStats {
  total: number;
  open: number;
  pending: number;
  resolved: number;
  closed: number;
  unassigned: number;
  assignedToMe: number;
  openProblems: number;
  /** Distinct tickets where the signed-in agent was named in a comment. */
  mentioningMe: number;
  /** Tickets the signed-in agent watches. */
  watchedByMe: number;
  /**
   * The caller's open tasks, on tickets that are still going. The third "needs
   * me" number, and the only one that is work rather than reading.
   */
  myOpenTasks: number;
  /** Active customers — the sidebar count beside Customers. */
  customers: number;
  /** Assets on the register that are still in service. */
  activeAssets: number;
  /**
   * Services with at least one open ticket saying they are fully down. Distinct
   * services, not reports — five tickets about one outage is one service down.
   */
  servicesDown: number;
}

/** What the list can be sorted by. `updated` is the default. */
export type TicketSort = 'updated' | 'created' | 'priority' | 'status' | 'subject' | 'due';

/** The assignee facet's bucket for "nobody" — sent back as `unassigned=true`. */
export const UNASSIGNED_FACET = 'none';

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

/**
 * Counts behind the filter rail.
 *
 * Each group is counted with every filter applied **except its own** — so
 * picking "Open" still shows how many Pending there are, and the selection can
 * be widened rather than only narrowed.
 */
export interface TicketFacets {
  status: FacetBucket[];
  priority: FacetBucket[];
  channel: FacetBucket[];
  team: FacetBucket[];
  category: FacetBucket[];
  assignee: FacetBucket[];
  tag: FacetBucket[];
}

/**
 * Every list filter.
 *
 * The array fields serialise as repeated params (`?status=open&status=pending`),
 * which is what lets the rail express "either of these" — something a single
 * value per field cannot say.
 */
export interface TicketListParams {
  /** A status VALUE. For a saved view you almost always want . */
  status?: string | string[];
  /**
   * A status CATEGORY. What the saved views send: "Open" must mean every
   * status in the open category, not the single status called "open".
   */
  category?: string | string[];
  /** Every ticket raised by one customer — the profile page's history. */
  requesterId?: string;
  priority?: string | string[];
  assigneeId?: string | string[];
  /** Nobody is on it. Its own flag, because "no assignee" has no id. */
  unassigned?: boolean;
  channel?: string | string[];
  categoryId?: string | string[];
  teamId?: string | string[];
  tag?: string | string[];
  search?: string;
  sort?: TicketSort;
  /** Newest/largest first. Defaults to true server-side. */
  desc?: boolean;
  /**
   * Tickets where the signed-in agent was named in a comment. Deliberately a
   * flag and not an id — "whose mentions?" is not a question a client gets to
   * answer, so there is no shape of request that could ask it.
   */
  mentioned?: boolean;
  /** Your own pins. */
  pinned?: boolean;
  /** Flagged by anyone — a flag belongs to the team. */
  flagged?: boolean;
  /** Tickets the signed-in agent watches. Same reasoning as `mentioned`. */
  watching?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface UpdateTicketBody {
  subject?: string;
  status?: string;
  priority?: string;
  categoryId?: string;
  clearCategory?: boolean;
  assigneeId?: string;
  unassign?: boolean;
  teamId?: string;
  clearTeam?: boolean;
  /**
   * The narrower answers. Each must sit under the one above it — the server
   * rejects a mismatched pair — and clearing the parent clears the child.
   */
  subCategoryId?: string;
  clearSubCategory?: boolean;
  subTeamId?: string;
  clearSubTeam?: boolean;
  /** Re-points the ticket at a customer. */
  requesterId?: string;
  /** Detaches the customer, leaving none. */
  clearRequester?: boolean;

  /**
   * Required by the API when `status` moves out of open/pending into resolved
   * or closed. The server rejects the change without it — the dialog is the
   * convenience, not the control.
   */
  resolutionNote?: string;
  /** Work item, PR or user story. Must be a full http(s) URL if given. */
  resolutionLink?: string;
  /**
   * What the customer is told, in plain words. Optional — unlike the note.
   * Demanding two paragraphs to close a ticket is how you get . in both.
   */
  resolutionSummary?: string;
  /** Logged against the ticket in the same request as the resolution. */
  timeSpentMinutes?: number;

  /**
   * Linked duplicates to resolve alongside this one — the boxes the agent ticked.
   *
   * Never sent automatically. Each id is another customer who receives a
   * resolution email, so somebody has to have chosen it. The server re-checks
   * every id against this ticket's duplicate links.
   */
  alsoResolve?: string[];

  /**
   * The agent has seen the open tasks, the responders who never replied and any
   * open blocker, and is going ahead.
   *
   * Without it the API answers 409 and returns the warnings. Never set it blind —
   * the whole point is that the override is a decision somebody made, and it is
   * written into the activity log with their name on it.
   */
  acknowledgeWarnings?: boolean;
}

/**
 * What resolving a ticket would mean, read when the dialog opens.
 *
 * One round trip for both halves, because they are one decision: "is this
 * actually finished, and does anything else finish with it".
 */
export interface ResolvePreview {
  /** Open tickets that say "same issue" — offered as ticked boxes. */
  duplicates: LinkedTicket[];
  /** True when there are more duplicates than one resolve will carry. */
  moreDuplicates: boolean;
  warnings: ResolveWarnings;
}

/**
 * Why a resolve should pause. All three empty means nothing is outstanding, and
 * the dialog must then show no warning at all — silence is the common case.
 */
export interface ResolveWarnings {
  openTasks: OpenTask[];
  /** Responders who have not written anything on the ticket. */
  pendingResponders: PendingResponder[];
  /** Tickets still holding this one up. */
  openBlockers: LinkedTicket[];
}

export interface OpenTask {
  id: string;
  title: string;
  assignee: UserSummary | null;
  dueAt: string | null;
}

export interface PendingResponder {
  agent: UserSummary;
  /** What they were added to do, if whoever added them said. */
  role: string | null;
}

/** True when there is anything at all to confirm. */
export function hasWarnings(warnings: ResolveWarnings | null | undefined): boolean {
  if (!warnings) return false;
  return (
    warnings.openTasks.length > 0 ||
    warnings.pendingResponders.length > 0 ||
    warnings.openBlockers.length > 0
  );
}

/**
 * A task seen from the Tasks screen rather than from inside a ticket, so it
 * carries enough of its ticket to be actionable without opening it.
 */
export interface AgentTask {
  id: string;
  title: string;
  assignee: UserSummary | null;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: UserSummary | null;
  createdAt: string;
  ticketId: string;
  ticketSubject: string;
  ticketStatus: string;
  ticketStatusName: string;
  ticketStatusCategory: string;
  ticketPriority: string;
}

export interface TaskListParams {
  /** An agent id, `me`, `none` for unassigned, or omitted for the whole team. */
  assignee?: string;
  includeDone?: boolean;
  /** Tasks left behind on resolved tickets. Off by default — they are history. */
  includeFinishedTickets?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly api = inject(ApiService);

  stats(): Promise<DashboardStats> {
    return this.api.get<DashboardStats>('/api/dashboard/stats');
  }

  list(params: TicketListParams = {}): Promise<Paged<TicketSummary>> {
    return this.api.get<Paged<TicketSummary>>('/api/tickets', params as QueryParams);
  }

  /**
   * Counts for the filter rail. Takes the **same** params as `list` on purpose:
   * one filter state, two endpoints. Two shapes would drift, and the symptom is
   * facet counts that do not add up to the rows underneath them.
   */
  facets(params: TicketListParams = {}): Promise<TicketFacets> {
    return this.api.get<TicketFacets>('/api/tickets/facets', params as QueryParams);
  }

  get(id: string): Promise<TicketDetail> {
    return this.api.get<TicketDetail>(`/api/tickets/${id}`);
  }

  /**
   * `categoryName`, `channel` and `tags` are free text the server resolves —
   * an existing row is reused, a new value is created, all inside this one
   * request. Nothing is written until the ticket itself is written, so a form
   * the user abandons leaves no stray taxonomy behind.
   *
   * The server honours these three for agents and admins only; a customer
   * posting from the portal has them ignored, not rejected.
   */
  create(body: {
    subject: string;
    description: string;
    categoryId?: string;
    categoryName?: string;
    channel?: string;
    priority?: string;
    tags?: string[];
    teamId?: string;
    /** File on a customer's behalf. Agent/admin only; ignored otherwise. */
    requesterId?: string;
  }): Promise<TicketDetail> {
    return this.api.post<TicketDetail>('/api/tickets', body);
  }

  /** Departments — teams double as the routing group a ticket is filed into. */
  teams(): Promise<Team[]> {
    return this.api.get<Team[]>('/api/teams');
  }

  /** `parentId` creates a sub-department under an existing one. Two levels only. */
  createTeam(name: string, parentId?: string | null): Promise<Team> {
    return this.api.post<Team>('/api/teams', { name, parentId });
  }

  renameTeam(id: string, name: string): Promise<Team> {
    return this.api.put<Team>(`/api/teams/${id}`, { name });
  }

  deleteTeam(id: string): Promise<void> {
    return this.api.delete<void>(`/api/teams/${id}`);
  }

  /**
   * Membership is what makes routing work: a ticket filed into a department is
   * round-robin assigned **within its members**, so an empty department is a
   * department that quietly assigns nobody.
   */
  addTeamMember(teamId: string, userId: string): Promise<void> {
    return this.api.post<void>(`/api/teams/${teamId}/members`, { userId });
  }

  removeTeamMember(teamId: string, userId: string): Promise<void> {
    return this.api.delete<void>(`/api/teams/${teamId}/members/${userId}`);
  }

  /** `parentId` creates a sub-category. Two levels only. */
  createCategory(body: { name: string; color?: string; parentId?: string | null }): Promise<Category> {
    return this.api.post<Category>('/api/categories', body);
  }

  updateCategory(id: string, body: { name: string; color?: string }): Promise<Category> {
    return this.api.put<Category>(`/api/categories/${id}`, body);
  }

  deleteCategory(id: string): Promise<void> {
    return this.api.delete<void>(`/api/categories/${id}`);
  }

  /**
   * Adds a customer to the workspace. Get-or-create by email server-side, so
   * calling it for someone who already exists returns them rather than failing —
   * "add this customer" is one intention either way.
   */
  createCustomer(body: CustomerBody): Promise<Customer> {
    return this.api.post<Customer>('/api/users', body);
  }

  /**
   * As `createCustomer`, but says whether the customer was actually created.
   *
   * The endpoint is get-or-create on email: it answers 201 with a new record, or
   * 200 with the one that was already there — never an error, and never
   * overwriting details a colleague recorded. `created: false` means the agent
   * typed in somebody who already exists, which is worth telling them.
   */
  createCustomerChecked(body: CustomerBody): Promise<{ body: Customer; created: boolean }> {
    return this.api.postStatus<Customer>('/api/users', body);
  }

  customer(id: string): Promise<CustomerDetail> {
    return this.api.get<CustomerDetail>(`/api/users/${id}`);
  }

  /**
   * Full profile replace. Unlike create, an omitted field CLEARS — this backs an
   * edit form where the agent can see what they are removing.
   */
  updateCustomer(id: string, body: CustomerBody): Promise<Customer> {
    return this.api.put<Customer>(`/api/users/${id}/profile`, body);
  }

  /** Workspace members, for the requester picker. */
  users(role?: string): Promise<UserSummary[]> {
    return this.api.get<UserSummary[]>('/api/users', role ? { role } : {});
  }

  /**
   * A page of customers, with ticket counts — the Customers screen.
   *
   * Deliberately not `users('customer')`: that one fills a picker (five columns,
   * active only, no paging, no counts) and cannot answer "how many are there" or
   * "which of them ever signed in" without pulling the whole table to the client.
   */
  customers(params: CustomerListParams = {}): Promise<Paged<CustomerRow>> {
    return this.api.get<Paged<CustomerRow>>('/api/customers', params as QueryParams);
  }

  /** Counted over EVERY customer, active or not — unlike the list, which hides inactive. */
  customerSummary(): Promise<CustomerSummary> {
    return this.api.get<CustomerSummary>('/api/customers/summary');
  }

  /**
   * An admin-configured vocabulary. Pickers ask for the default (active only);
   * the admin screen passes `includeInactive` so a retired option can be
   * brought back.
   */
  // ── Statuses + workflow ───────────────────────────────────────────────────

  /** The vocabulary. `includeInactive` is for the admin screen. */
  ticketStatuses(includeInactive = false): Promise<TicketStatus[]> {
    return this.api.get<TicketStatus[]>('/api/ticket-statuses', { includeInactive });
  }

  /**
   * What a ticket in `from` may move to — what the picker is built from.
   * Includes the current status, so the picker can show what is selected.
   */
  reachableStatuses(from: string): Promise<TicketStatus[]> {
    return this.api.get<TicketStatus[]>('/api/ticket-statuses/reachable', { from });
  }

  createTicketStatus(body: { category: string; name: string; color?: string }): Promise<TicketStatus> {
    return this.api.post<TicketStatus>('/api/ticket-statuses', body);
  }

  updateTicketStatus(
    id: string,
    body: {
      name?: string;
      category?: string;
      color?: string;
      sortOrder?: number;
      isActive?: boolean;
      isDefault?: boolean;
    },
  ): Promise<TicketStatus> {
    return this.api.put<TicketStatus>(`/api/ticket-statuses/${id}`, body);
  }

  deleteTicketStatus(id: string): Promise<void> {
    return this.api.delete<void>(`/api/ticket-statuses/${id}`);
  }

  workflow(): Promise<StatusTransition[]> {
    return this.api.get<StatusTransition[]>('/api/ticket-statuses/workflow');
  }

  /**
   * Replaces the whole workflow. The matrix edits every cell at once, so a diff
   * would put "what changed" in the client — which is how a half-applied
   * workflow happens.
   */
  saveWorkflow(transitions: { fromStatusId: string | null; toStatusId: string }[]): Promise<void> {
    return this.api.put<void>('/api/ticket-statuses/workflow', { transitions });
  }

  ticketOptions(kind: TicketOptionKind, includeInactive = false): Promise<TicketOption[]> {
    return this.api.get<TicketOption[]>('/api/ticket-options', { kind, includeInactive });
  }

  createTicketOption(body: { kind: TicketOptionKind; label: string; color?: string }): Promise<TicketOption> {
    return this.api.post<TicketOption>('/api/ticket-options', body);
  }

  updateTicketOption(
    id: string,
    body: { label?: string; color?: string; sortOrder?: number; isActive?: boolean },
  ): Promise<TicketOption> {
    return this.api.put<TicketOption>(`/api/ticket-options/${id}`, body);
  }

  deleteTicketOption(id: string): Promise<void> {
    return this.api.delete<void>(`/api/ticket-options/${id}`);
  }

  /** Every tag in the workspace, with how many tickets carry it. */
  tags(): Promise<TagUsage[]> {
    return this.api.get<TagUsage[]>('/api/tags');
  }

  update(id: string, body: UpdateTicketBody): Promise<TicketDetail> {
    return this.api.patch<TicketDetail>(`/api/tickets/${id}`, body);
  }

  comments(ticketId: string): Promise<Comment[]> {
    return this.api.get<Comment[]>(`/api/tickets/${ticketId}/comments`);
  }

  /**
   * `bodyFormat: 'html'` sends markup from the rich composer. The server
   * sanitises it against a small allowlist before storing — the composer is the
   * convenience, the server is the control.
   */
  addComment(
    ticketId: string,
    body: {
      body: string;
      isInternal: boolean;
      bodyFormat?: 'text' | 'html';
      visibility?: 'public' | 'internal' | 'private';
    },
  ): Promise<Comment> {
    return this.api.post<Comment>(`/api/tickets/${ticketId}/comments`, body);
  }

  setTags(id: string, tags: string[]): Promise<Tag[]> {
    return this.api.put<Tag[]>(`/api/tickets/${id}/tags`, { tags });
  }

  addWatcher(ticketId: string, agentId: string): Promise<void> {
    return this.api.put<void>(`/api/tickets/${ticketId}/watchers/${agentId}`);
  }

  removeWatcher(ticketId: string, agentId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/watchers/${agentId}`);
  }

  categories(): Promise<Category[]> {
    return this.api.get<Category[]>('/api/categories');
  }

  agents(): Promise<UserSummary[]> {
    return this.api.get<UserSummary[]>('/api/users', { role: 'agent' });
  }

  attachments(ticketId: string): Promise<Attachment[]> {
    return this.api.get<Attachment[]>(`/api/tickets/${ticketId}/attachments`);
  }

  // ── Time spent ────────────────────────────────────────────────────────────

  timeEntries(ticketId: string): Promise<TimeEntry[]> {
    return this.api.get<TimeEntry[]>(`/api/tickets/${ticketId}/time`);
  }

  logTime(ticketId: string, body: LogTimeBody): Promise<TimeEntry> {
    return this.api.post<TimeEntry>(`/api/tickets/${ticketId}/time`, body);
  }

  /** Your own entry; an admin may edit anyone's. */
  updateTime(ticketId: string, entryId: string, body: LogTimeBody): Promise<TimeEntry> {
    return this.api.put<TimeEntry>(`/api/tickets/${ticketId}/time/${entryId}`, body);
  }

  deleteTime(ticketId: string, entryId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/time/${entryId}`);
  }

  // ── Pin and flag ──────────────────────────────────────────────────────────

  /**
   * A pin is yours alone. There is no agent id because there is no such thing as
   * pinning a ticket to somebody else's list.
   */
  setPinned(ticketId: string, pinned: boolean): Promise<void> {
    return pinned
      ? this.api.put<void>(`/api/tickets/${ticketId}/pin`, {})
      : this.api.delete<void>(`/api/tickets/${ticketId}/pin`);
  }

  /** A flag is the team's. Anyone can raise it and anyone can clear it. */
  setFlagged(ticketId: string, flagged: boolean, reason?: string | null): Promise<void> {
    return flagged
      ? this.api.put<void>(`/api/tickets/${ticketId}/flag`, { reason })
      : this.api.delete<void>(`/api/tickets/${ticketId}/flag`);
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────

  /**
   * One action across a selection.
   *
   * **Always inspect the result.** This resolves successfully when some of the
   * batch failed — a workflow can refuse one transition out of forty — so a
   * caller that only catches rejections will report a clean sweep that did not
   * happen. `failed` names each ticket and why.
   */
  bulk(request: TicketBulkRequest): Promise<TicketBulkResult> {
    return this.api.post<TicketBulkResult>('/api/tickets/bulk', request);
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  /** Newest first — an agent opening a ticket wants what just happened. */
  ticketActivity(ticketId: string): Promise<TicketActivity[]> {
    return this.api.get<TicketActivity[]>(`/api/tickets/${ticketId}/activity`);
  }

  // ── Problems ──────────────────────────────────────────────────────────────

  /**
   * The workspace's problems — the list page, and the picker on a ticket.
   *
   * Agent-facing: a problem groups tickets across customers, and its title
   * usually describes an outage affecting other people entirely.
   */
  problems(): Promise<ProblemSummary[]> {
    return this.api.get<ProblemSummary[]>('/api/problems');
  }

  /** One problem plus every ticket underneath it. */
  problem(id: string): Promise<ProblemDetail> {
    return this.api.get<ProblemDetail>(`/api/problems/${id}`);
  }

  createProblem(body: { title: string; description?: string; assigneeId?: string }): Promise<ProblemDetail> {
    return this.api.post<ProblemDetail>('/api/problems', body);
  }

  updateProblem(id: string, body: UpdateProblemBody): Promise<ProblemDetail> {
    return this.api.patch<ProblemDetail>(`/api/problems/${id}`, body);
  }

  /**
   * Ends the problem, and by default every ticket under it.
   *
   * The bulk resolve deliberately bypasses the per-ticket resolve gate: closing a
   * problem is one decision about all of its tickets, and a rule that blocked one
   * of them would leave the problem resolved with a ticket still open under it.
   */
  resolveProblem(id: string, bulkResolveTickets = true): Promise<ProblemDetail> {
    return this.api.post<ProblemDetail>(`/api/problems/${id}/resolve`, { bulkResolveTickets });
  }

  linkProblem(problemId: string, ticketId: string): Promise<void> {
    return this.api.post<void>(`/api/problems/${problemId}/tickets`, { ticketId });
  }

  /** Keyed by the TICKET: a ticket belongs to at most one problem. */
  unlinkProblem(ticketId: string): Promise<void> {
    return this.api.delete<void>(`/api/problems/tickets/${ticketId}`);
  }

  // ── Canned responses ──────────────────────────────────────────────────────

  cannedResponses(): Promise<CannedResponse[]> {
    return this.api.get<CannedResponse[]>('/api/canned-responses');
  }

  createCannedResponse(body: SaveCannedResponse): Promise<CannedResponse> {
    return this.api.post<CannedResponse>('/api/canned-responses', body);
  }

  updateCannedResponse(id: string, body: SaveCannedResponse): Promise<CannedResponse> {
    return this.api.put<CannedResponse>(`/api/canned-responses/${id}`, body);
  }

  deleteCannedResponse(id: string): Promise<void> {
    return this.api.delete<void>(`/api/canned-responses/${id}`);
  }

  // ── Related tickets ───────────────────────────────────────────────────────

  /** Both directions, already flipped — render `kind` as given. */
  ticketRelations(ticketId: string): Promise<TicketRelation[]> {
    return this.api.get<TicketRelation[]>(`/api/tickets/${ticketId}/relations`);
  }

  addTicketRelation(
    ticketId: string,
    body: { relatedTicketId: string; kind: string },
  ): Promise<TicketRelation> {
    return this.api.post<TicketRelation>(`/api/tickets/${ticketId}/relations`, body);
  }

  /** Removable from either end — the id identifies the row, not the direction. */
  deleteTicketRelation(ticketId: string, relationId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/relations/${relationId}`);
  }

  /**
   * What resolving this ticket would mean — the duplicates that can end with it,
   * and the work still outstanding.
   *
   * Read when the resolve dialog opens. `PATCH /api/tickets/{id}` re-checks the
   * same facts and answers 409 if they were not acknowledged, so skipping this
   * call degrades to a worse experience rather than to a bypassed rule.
   */
  resolvePreview(ticketId: string): Promise<ResolvePreview> {
    return this.api.get<ResolvePreview>(`/api/tickets/${ticketId}/resolve-preview`);
  }

  // ── Tasks across every ticket ─────────────────────────────────────────────

  /**
   * One agent's whole checklist, or the team's.
   *
   * The per-ticket `ticketTasks` answers "what is left on this one"; this answers
   * "what is left for me", which is the question somebody starting their day has.
   */
  tasks(params: TaskListParams = {}): Promise<AgentTask[]> {
    return this.api.get<AgentTask[]>('/api/tasks', params as QueryParams);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  ticketTasks(ticketId: string): Promise<TicketTask[]> {
    return this.api.get<TicketTask[]>(`/api/tickets/${ticketId}/tasks`);
  }

  createTicketTask(
    ticketId: string,
    body: { title: string; assigneeId?: string | null; dueAt?: string | null },
  ): Promise<TicketTask> {
    return this.api.post<TicketTask>(`/api/tickets/${ticketId}/tasks`, body);
  }

  /**
   * `clearAssignee` / `clearDueAt` exist because null means "leave it alone"
   * for everything else here — without them a due date could never come back off.
   */
  updateTicketTask(
    ticketId: string,
    taskId: string,
    body: {
      title?: string;
      assigneeId?: string | null;
      clearAssignee?: boolean;
      dueAt?: string | null;
      clearDueAt?: boolean;
      completed?: boolean;
    },
  ): Promise<TicketTask> {
    return this.api.put<TicketTask>(`/api/tickets/${ticketId}/tasks/${taskId}`, body);
  }

  deleteTicketTask(ticketId: string, taskId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/tasks/${taskId}`);
  }

  // ── Responders ────────────────────────────────────────────────────────────

  ticketResponders(ticketId: string): Promise<TicketResponder[]> {
    return this.api.get<TicketResponder[]>(`/api/tickets/${ticketId}/responders`);
  }

  /** PUT: adding somebody already on the ticket edits their role. */
  addTicketResponder(ticketId: string, agentId: string, role?: string | null): Promise<void> {
    return this.api.put<void>(`/api/tickets/${ticketId}/responders/${agentId}`, { role });
  }

  removeTicketResponder(ticketId: string, agentId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/responders/${agentId}`);
  }

  // ── Assets on a ticket ────────────────────────────────────────────────────

  ticketAssets(ticketId: string): Promise<TicketAsset[]> {
    return this.api.get<TicketAsset[]>(`/api/tickets/${ticketId}/assets`);
  }

  attachAsset(ticketId: string, assetId: string): Promise<void> {
    return this.api.put<void>(`/api/tickets/${ticketId}/assets/${assetId}`, {});
  }

  detachAsset(ticketId: string, assetId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/assets/${assetId}`);
  }

  // ── Impacted services ─────────────────────────────────────────────────────

  ticketImpactedServices(ticketId: string): Promise<TicketImpactedService[]> {
    return this.api.get<TicketImpactedService[]>(`/api/tickets/${ticketId}/impacted-services`);
  }

  /** PUT: the first note during an incident is a guess, and refining it is an edit. */
  setImpactedService(
    ticketId: string,
    serviceId: string,
    body: { impact?: string | null; level?: string },
  ): Promise<void> {
    return this.api.put<void>(`/api/tickets/${ticketId}/impacted-services/${serviceId}`, body);
  }

  clearImpactedService(ticketId: string, serviceId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/impacted-services/${serviceId}`);
  }

  // ── Custom properties ─────────────────────────────────────────────────────

  /** Every field with this ticket's answer — one call renders the whole form. */
  ticketFieldAnswers(ticketId: string): Promise<TicketFieldAnswer[]> {
    return this.api.get<TicketFieldAnswer[]>(`/api/tickets/${ticketId}/fields`);
  }

  /** Keyed by field id. An empty value clears the answer. */
  saveTicketFieldAnswers(
    ticketId: string,
    values: Record<string, string | null>,
  ): Promise<TicketFieldAnswer[]> {
    return this.api.put<TicketFieldAnswer[]>(`/api/tickets/${ticketId}/fields`, { values });
  }

  // ── Registers (agents read, admins write) ─────────────────────────────────

  assets(search?: string, includeInactive = false): Promise<Asset[]> {
    return this.api.get<Asset[]>('/api/assets', { search, includeInactive });
  }

  createAsset(body: Partial<Asset> & { name: string }): Promise<Asset> {
    return this.api.post<Asset>('/api/assets', body);
  }

  updateAsset(
    id: string,
    body: {
      name?: string;
      kind?: string | null;
      tag?: string | null;
      location?: string | null;
      assignedToId?: string | null;
      clearAssignee?: boolean;
      notes?: string | null;
      isActive?: boolean;
    },
  ): Promise<Asset> {
    return this.api.put<Asset>(`/api/assets/${id}`, body);
  }

  deleteAsset(id: string): Promise<void> {
    return this.api.delete<void>(`/api/assets/${id}`);
  }

  /** The register in aggregate: how many, how many are out, and where. */
  assetSummary(): Promise<AssetSummary> {
    return this.api.get<AssetSummary>('/api/assets/summary');
  }

  /** Every ticket ever raised about one asset — the drill-down behind its count. */
  assetTickets(id: string): Promise<AssetTicket[]> {
    return this.api.get<AssetTicket[]>(`/api/assets/${id}/tickets`);
  }

  services(includeInactive = false): Promise<BusinessService[]> {
    return this.api.get<BusinessService[]>('/api/services', { includeInactive });
  }

  /**
   * Open tickets saying a service is affected, worst impact first.
   *
   * `includeFinished` turns it into the service's incident history — the view for
   * "how often does this break" rather than "is it broken now".
   */
  serviceTickets(id: string, includeFinished = false): Promise<ServiceTicket[]> {
    return this.api.get<ServiceTicket[]>(`/api/services/${id}/tickets`, { includeFinished });
  }

  createService(body: {
    name: string;
    description?: string | null;
    ownerTeamId?: string | null;
    pipelineUrl?: string | null;
  }) {
    return this.api.post<BusinessService>('/api/services', body);
  }

  updateService(
    id: string,
    body: {
      name?: string;
      description?: string | null;
      ownerTeamId?: string | null;
      clearOwner?: boolean;
      sortOrder?: number;
      isActive?: boolean;
      /** Copied into a release plan when this service is added to one. */
      pipelineUrl?: string | null;
    },
  ): Promise<BusinessService> {
    return this.api.put<BusinessService>(`/api/services/${id}`, body);
  }

  deleteService(id: string): Promise<void> {
    return this.api.delete<void>(`/api/services/${id}`);
  }

  ticketFields(includeInactive = false): Promise<TicketField[]> {
    return this.api.get<TicketField[]>('/api/ticket-fields', { includeInactive });
  }

  createTicketField(body: {
    label: string;
    type: string;
    helpText?: string | null;
    options?: string | null;
    allowNewOptions: boolean;
    isRequired: boolean;
  }): Promise<TicketField> {
    return this.api.post<TicketField>('/api/ticket-fields', body);
  }

  /** The key and the type are not editable — there is no honest migration for either. */
  updateTicketField(
    id: string,
    body: {
      label?: string;
      helpText?: string | null;
      options?: string | null;
      allowNewOptions?: boolean;
      isRequired?: boolean;
      sortOrder?: number;
      isActive?: boolean;
    },
  ): Promise<TicketField> {
    return this.api.put<TicketField>(`/api/ticket-fields/${id}`, body);
  }

  deleteTicketField(id: string): Promise<void> {
    return this.api.delete<void>(`/api/ticket-fields/${id}`);
  }

  // ── Related work ──────────────────────────────────────────────────────────

  ticketLinks(ticketId: string): Promise<TicketLink[]> {
    return this.api.get<TicketLink[]>(`/api/tickets/${ticketId}/links`);
  }

  /** `url` must be a full http(s) URL — the server rejects anything else. */
  addTicketLink(
    ticketId: string,
    body: { url: string; title?: string; kind?: string },
  ): Promise<TicketLink> {
    return this.api.post<TicketLink>(`/api/tickets/${ticketId}/links`, body);
  }

  deleteTicketLink(ticketId: string, linkId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/links/${linkId}`);
  }

  uploadAttachment(
    ticketId: string,
    file: File,
    commentId?: string,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    return this.api.upload<Attachment>(`/api/tickets/${ticketId}/attachments`, form, {
      params: { commentId },
      onProgress,
    });
  }

  attachmentUrl(id: string): string {
    return this.api.url(`/api/attachments/${id}`);
  }

  /**
   * Replaces a person's photo. Returns the new `avatarUrl`, which carries a
   * version query so the browser drops the cached copy of the old one — the
   * path itself never changes, so without it the old photo stays on screen.
   */
  uploadAvatar(
    userId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{ avatarUrl: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.api.upload<{ avatarUrl: string }>(`/api/users/${userId}/avatar`, form, { onProgress });
  }

  removeAvatar(userId: string): Promise<void> {
    return this.api.delete<void>(`/api/users/${userId}/avatar`);
  }

  /**
   * Whether the AI copilot is on for this workspace — a deployment key AND an
   * admin toggle. Agent-facing probe, so the UI can hide the ✨ actions without
   * exposing the admin settings endpoint.
   */
  aiAvailable(): Promise<{ available: boolean }> {
    return this.api.get<{ available: boolean }>('/api/ai/available');
  }

  /** A suggestion for the agent to accept or ignore. Never auto-applied. */
  triage(ticketId: string): Promise<TriageSuggestion> {
    return this.api.post<TriageSuggestion>(`/api/tickets/${ticketId}/ai/triage`);
  }
}

/**
 * The most urgent SLA state for a ticket, or `null` when no clock applies.
 *
 * An unmet first response outranks the resolve clock; resolved and closed
 * tickets have no active clock at all. Overdue is reported as elapsed time with
 * an explicit label — never a negative countdown, which reads as a bug.
 */
export interface SlaState {
  tone: 'success' | 'warning' | 'danger';
  /** `sla.inTime` or `sla.overdue` — resolved with `{ time }` where it renders. */
  labelKey: string;
  time: string;
  /** `sla.response` or `sla.resolve`. */
  prefixKey: string;
}

export function slaState(
  ticket: Pick<
    TicketSummary,
    'statusCategory' | 'firstResponseDueAt' | 'resolveDueAt' | 'firstResponseAt'
  >,
): SlaState | null {
  // Terminal first, before either clock. This used to be checked only on the
  // resolve leg, so a ticket closed without anybody replying kept counting its
  // first-response breach up forever — the card read "Breached, 17:06:00 over"
  // on a ticket whose work had finished the day before.
  //
  // Category, not status: a workspace can call its finished state anything.
  if (isTerminalCategory(ticket.statusCategory)) return null;

  if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
    return { ...remaining(ticket.firstResponseDueAt), prefixKey: 'sla.response' };
  }
  if (ticket.resolveDueAt) {
    return { ...remaining(ticket.resolveDueAt), prefixKey: 'sla.resolve' };
  }
  return null;
}

function remaining(dueAt: string): Omit<SlaState, 'prefixKey'> {
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return { tone: 'danger', labelKey: 'sla.overdue', time: short(-minutes) };
  return {
    tone: minutes <= 60 ? 'warning' : 'success',
    labelKey: 'sla.inTime',
    time: short(minutes),
  };
}

function short(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
