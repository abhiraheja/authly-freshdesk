import { api } from './client'

export interface TagUsage {
  id: string
  name: string
  color: string | null
  ticketCount: number
}

export function listTags() {
  return api<TagUsage[]>('/api/tags')
}
