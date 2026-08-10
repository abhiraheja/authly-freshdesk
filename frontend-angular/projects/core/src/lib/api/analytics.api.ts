import { Injectable, inject } from '@angular/core';
import { ApiService, type QueryParams } from './api.service';
import type { UserSummary } from './tickets.api';

/**
 * Workspace analytics, and the reward goals built on top of them.
 *
 * Its own file rather than more of `tickets.api.ts`: that one is already the
 * ticket domain end to end, and none of this is about a single ticket. Everything
 * here is agent/admin — the API refuses a customer outright.
 */

export interface DailyCount {
  /** `yyyy-MM-dd`. Zero-filled, so a chart axis is continuous. */
  date: string;
  count: number;
}

export interface LabeledCount {
  /** Empty string is a real bucket: "no department", "no answer". Render it as such. */
  label: string;
  count: number;
}

/**
 * One agent's numbers. Two different questions in one row, and the distinction
 * matters: `resolved` is what they finished over the window, `openNow` is what
 * they are carrying this minute. An agent can top the leaderboard and be drowning.
 */
export interface AgentLeaderRow {
  agent: UserSummary;
  resolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  /** 1–5, null when nobody rated them. */
  avgCsat: number | null;
  /** 0–1, null when none of their tickets had a deadline. */
  firstResponseSlaAttainment: number | null;
  resolutionSlaAttainment: number | null;
  openNow: number;
  /** Their open tickets whose resolve deadline has already passed. */
  overdueNow: number;
  pendingTasks: number;
  rewardPoints: number;
  badges: number;
}

/** @param since When the earliest still-open ticket first reported it — "down since". */
export interface ServiceTroubleRow {
  serviceId: string;
  name: string;
  ownerTeamName: string | null;
  level: string;
  openTicketCount: number;
  since: string;
}

/** `today` · `1-3d` · `4-7d` · `8-30d` · `30d+`. Always all five, zeroes included. */
export interface AgingBucket {
  label: string;
  count: number;
}

/**
 * The workspace over a trailing window, plus the state of the desk right now.
 *
 * Both halves are here on purpose. "Are we keeping up?" is a trend and "what is on
 * fire?" is this moment; they are the two questions an admin actually has, and
 * splitting them across two screens means nobody ever reads them together.
 */
export interface AnalyticsOverview {
  days: number;
  createdInWindow: number;
  resolvedInWindow: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  /** 0–1, null when no ticket in the window had a deadline. */
  firstResponseSlaAttainment: number | null;
  resolutionSlaAttainment: number | null;
  avgCsat: number | null;
  csatResponses: number;
  volume: DailyCount[];
  byChannel: LabeledCount[];
  byStatus: LabeledCount[];
  leaderboard: AgentLeaderRow[];

  // ── Right now ────────────────────────────────────────────────────────────
  openNow: number;
  unassignedNow: number;
  overdueNow: number;
  /** Open tickets that have never had a reply. */
  awaitingFirstReply: number;
  /** Age of the oldest unfinished ticket, in days. Null when nothing is open. */
  oldestOpenDays: number | null;
  aging: AgingBucket[];
  byPriority: LabeledCount[];
  byTeam: LabeledCount[];
  servicesInTrouble: ServiceTroubleRow[];
  openTasks: number;
  overdueTasks: number;
}

/**
 * One agent's own dashboard, in one call.
 *
 * The window applies to the achievement figures — resolved, response times, CSAT.
 * The load figures (`openNow` onward) are this moment regardless of window, because
 * "what is on me" has no useful trailing version.
 */
export interface AgentOverview {
  days: number;
  agent: UserSummary;
  resolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  firstResponseSlaAttainment: number | null;
  resolutionSlaAttainment: number | null;
  avgCsat: number | null;
  csatResponses: number;
  openNow: number;
  overdueNow: number;
  /** Their open tickets the customer is still waiting on a first reply for. */
  awaitingFirstReply: number;
  pendingTasks: number;
  overdueTasks: number;
  watchingCount: number;
  mentioningMeCount: number;
  rewardPoints: number;
  badges: number;
  resolvedPerDay: DailyCount[];
  /** Their OPEN tickets by priority — the shape of what they are holding. */
  byPriority: LabeledCount[];
  rewards: RewardProgress[];
}

/** What a reward goal can measure. Every one is derived from data already recorded. */
export type RewardMetric =
  | 'tickets_resolved'
  | 'first_response_sla'
  | 'resolution_sla'
  | 'csat_score'
  | 'tasks_completed';

export const REWARD_METRICS: readonly RewardMetric[] = [
  'tickets_resolved',
  'first_response_sla',
  'resolution_sla',
  'csat_score',
  'tasks_completed',
];

/**
 * Whether a metric's target is a percentage rather than a count.
 *
 * Decides the unit beside the target, whether `minimumSample` means anything, and
 * whether the progress bar can be read as a fraction of 100.
 */
export function isPercentageMetric(metric: string): boolean {
  return metric === 'first_response_sla' || metric === 'resolution_sla' || metric === 'csat_score';
}

export type RewardPeriod = 'week' | 'month' | 'quarter' | 'all_time';
export const REWARD_PERIODS: readonly RewardPeriod[] = ['week', 'month', 'quarter', 'all_time'];

export type RewardTier = 'bronze' | 'silver' | 'gold';
export const REWARD_TIERS: readonly RewardTier[] = ['bronze', 'silver', 'gold'];

export interface RewardGoal {
  id: string;
  name: string;
  description: string | null;
  metric: string;
  /** A count, or a whole percentage — see `isPercentageMetric`. */
  target: number;
  period: string;
  points: number;
  tier: string;
  /**
   * Minimum sample before a rate goal can be earned at all.
   *
   * What stops the scoreboard being nonsense: one ticket answered inside SLA is
   * 100% attainment, and without a floor that would out-rank 96% across two hundred.
   */
  minimumSample: number;
  isActive: boolean;
  sortOrder: number;
  /** How many badges it has handed out. Non-zero makes delete refuse. */
  awardedCount: number;
}

/** @param value What the agent has reached in the CURRENT period. */
export interface RewardProgress {
  goal: RewardGoal;
  value: number;
  earned: boolean;
  earnedAt: string | null;
}

export interface RewardAward {
  id: string;
  goalId: string;
  goalName: string;
  tier: string;
  metric: string;
  target: number;
  agent: UserSummary;
  /** `2026-08` · `2026-W32` · `2026-Q3` · `all`. */
  periodKey: string;
  value: number;
  points: number;
  awardedAt: string;
}

/** Every field optional: one shape for create and update. */
export interface SaveRewardGoalBody {
  name?: string;
  description?: string | null;
  metric?: string;
  target?: number;
  period?: string;
  points?: number;
  tier?: string;
  minimumSample?: number;
  sortOrder?: number;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly api = inject(ApiService);

  /** Admin-only. `days` is clamped 1–365 server-side; 30 is the default. */
  overview(days = 30): Promise<AnalyticsOverview> {
    return this.api.get<AnalyticsOverview>('/api/dashboard/analytics', { days });
  }

  /**
   * One agent's own figures.
   *
   * `agent` is honoured for an **admin only** — an agent always gets themselves
   * whatever is passed, enforced server-side. Omit it for the caller.
   */
  me(agent?: string, days = 30): Promise<AgentOverview> {
    return this.api.get<AgentOverview>('/api/dashboard/me', { agent, days } as QueryParams);
  }

  // ── Reward goals ──────────────────────────────────────────────────────────

  goals(includeInactive = false): Promise<RewardGoal[]> {
    return this.api.get<RewardGoal[]>('/api/rewards/goals', { includeInactive });
  }

  createGoal(body: SaveRewardGoalBody): Promise<RewardGoal> {
    return this.api.post<RewardGoal>('/api/rewards/goals', body);
  }

  updateGoal(id: string, body: SaveRewardGoalBody): Promise<RewardGoal> {
    return this.api.put<RewardGoal>(`/api/rewards/goals/${id}`, body);
  }

  /** 409 once anything has been awarded — retire it instead. */
  deleteGoal(id: string): Promise<void> {
    return this.api.delete<void>(`/api/rewards/goals/${id}`);
  }

  /**
   * One agent's standing against every active goal.
   *
   * `agent` takes an id or the literal `me`; omitted returns the goals with no
   * progress attached, which is what an admin reviewing the config wants.
   */
  progress(agent?: string): Promise<RewardProgress[]> {
    return this.api.get<RewardProgress[]>('/api/rewards/progress', { agent } as QueryParams);
  }

  /** Badges earned, newest first. `agent` omitted means the whole workspace. */
  awards(agent?: string, limit = 50): Promise<RewardAward[]> {
    return this.api.get<RewardAward[]>('/api/rewards/awards', { agent, limit } as QueryParams);
  }
}
