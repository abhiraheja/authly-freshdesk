import { api } from './client'

export interface SlaPolicy {
  priority: string
  firstResponseMinutes: number | null
  resolveMinutes: number | null
}

export function listSlaPolicies() {
  return api<SlaPolicy[]>('/api/admin/sla')
}

export function upsertSlaPolicy(policy: SlaPolicy) {
  return api<SlaPolicy>('/api/admin/sla', { method: 'PUT', body: JSON.stringify(policy) })
}

export function deleteSlaPolicy(priority: string) {
  return api<void>(`/api/admin/sla/${priority}`, { method: 'DELETE' })
}
