import { api } from './client'

export interface AiSettings {
  enabled: boolean
  configured: boolean // deployment-level API key present
}

export function getAiSettings() {
  return api<AiSettings>('/api/admin/ai')
}

export function setAiEnabled(enabled: boolean) {
  return api<AiSettings>('/api/admin/ai', { method: 'PUT', body: JSON.stringify({ enabled }) })
}
