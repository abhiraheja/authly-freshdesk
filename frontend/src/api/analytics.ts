import { api } from './client'

export interface DailyCount {
  date: string
  count: number
}

export interface LabeledCount {
  label: string
  count: number
}

export interface AgentLeaderRow {
  agentId: string
  name: string
  resolved: number
  avgFirstResponseMinutes: number | null
  avgResolutionMinutes: number | null
  avgCsat: number | null
}

export interface AnalyticsOverview {
  days: number
  createdInWindow: number
  resolvedInWindow: number
  avgFirstResponseMinutes: number | null
  avgResolutionMinutes: number | null
  firstResponseSlaAttainment: number | null
  resolutionSlaAttainment: number | null
  avgCsat: number | null
  csatResponses: number
  volume: DailyCount[]
  byChannel: LabeledCount[]
  byStatus: LabeledCount[]
  leaderboard: AgentLeaderRow[]
}

export function getAnalytics(days: number) {
  return api<AnalyticsOverview>(`/api/dashboard/analytics?days=${days}`)
}
