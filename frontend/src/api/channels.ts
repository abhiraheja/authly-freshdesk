import { api } from './client'

export interface ChannelConnector {
  provider: string
  enabled: boolean
  hasSecret: boolean
}

export function listChannels() {
  return api<ChannelConnector[]>('/api/admin/channels')
}

export function saveChannel(provider: string, body: { enabled: boolean; secret?: string | null }) {
  return api<ChannelConnector>(`/api/admin/channels/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
