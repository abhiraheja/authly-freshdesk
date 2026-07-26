import { api } from './client'

export interface CannedResponse {
  id: string
  title: string
  body: string
}

export function listCannedResponses() {
  return api<CannedResponse[]>('/api/canned-responses')
}

export function createCannedResponse(body: { title: string; body: string }) {
  return api<CannedResponse>('/api/canned-responses', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCannedResponse(id: string, body: { title: string; body: string }) {
  return api<CannedResponse>(`/api/canned-responses/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteCannedResponse(id: string) {
  return api<void>(`/api/canned-responses/${id}`, { method: 'DELETE' })
}
