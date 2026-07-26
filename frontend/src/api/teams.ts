import { api } from './client'
import type { UserSummary } from './tickets'

export interface Team {
  id: string
  name: string
  members: UserSummary[]
}

export function listTeams() {
  return api<Team[]>('/api/teams')
}

export function createTeam(name: string) {
  return api<Team>('/api/teams', { method: 'POST', body: JSON.stringify({ name }) })
}

export function deleteTeam(id: string) {
  return api<void>(`/api/teams/${id}`, { method: 'DELETE' })
}

export function addTeamMember(teamId: string, userId: string) {
  return api<void>(`/api/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ userId }) })
}

export function removeTeamMember(teamId: string, userId: string) {
  return api<void>(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' })
}
