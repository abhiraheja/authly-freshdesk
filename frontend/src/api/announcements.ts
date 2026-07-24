import { api } from './client'

export interface AnnouncementSummary {
  id: string
  type: string
  subject: string
  problemId: string | null
  scheduledAt: string | null
  sentAt: string | null
  recipientCount: number
  successCount: number
  failureCount: number
  createdAt: string
}

export interface AnnouncementDetail extends AnnouncementSummary {
  body: string
}

export const ANNOUNCEMENT_TYPES: { value: string; label: string }[] = [
  { value: 'planned_outage', label: 'Planned outage' },
  { value: 'unplanned_outage', label: 'Unplanned outage' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'general', label: 'General' },
]

export function listAnnouncements() {
  return api<AnnouncementSummary[]>('/api/announcements')
}

export function createAnnouncement(body: {
  type: string
  subject: string
  body: string
  problemId?: string | null
  scheduledAt?: string | null
}) {
  return api<AnnouncementDetail>('/api/announcements', { method: 'POST', body: JSON.stringify(body) })
}

export function sendAnnouncement(id: string) {
  return api<AnnouncementDetail>(`/api/announcements/${id}/send`, { method: 'POST' })
}
