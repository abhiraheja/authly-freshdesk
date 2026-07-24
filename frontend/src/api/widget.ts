import { api } from './client'

export interface WidgetFields {
  fields?: string[]
  required?: string[]
}

export interface WidgetConfig {
  embedType: 'floating' | 'inline' | 'link'
  fields: WidgetFields
  theme: 'light' | 'dark'
  snippet: string
}

export function getWidget() {
  return api<WidgetConfig>('/api/admin/widget')
}

export function saveWidget(body: { embedType: string; fields: WidgetFields; theme: string }) {
  return api<WidgetConfig>('/api/admin/widget', { method: 'PUT', body: JSON.stringify(body) })
}
