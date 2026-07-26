import { api } from './client'

export interface Condition {
  field: string
  op: string
  value: string
}

export interface ActionDef {
  type: string
  value: string
}

export interface AutomationRule {
  id: string
  name: string
  trigger: string
  conditions: Condition[]
  actions: ActionDef[]
  enabled: boolean
  sortOrder: number
}

export type SaveAutomationRule = Omit<AutomationRule, 'id'>

export function listAutomationRules() {
  return api<AutomationRule[]>('/api/automation-rules')
}

export function createAutomationRule(body: SaveAutomationRule) {
  return api<AutomationRule>('/api/automation-rules', { method: 'POST', body: JSON.stringify(body) })
}

export function updateAutomationRule(id: string, body: SaveAutomationRule) {
  return api<AutomationRule>(`/api/automation-rules/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteAutomationRule(id: string) {
  return api<void>(`/api/automation-rules/${id}`, { method: 'DELETE' })
}
