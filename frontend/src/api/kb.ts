import { api } from './client'

export interface KbArticleSummary {
  id: string
  title: string
  categoryName: string | null
  status: string
  updatedAt: string
}

export interface KbArticle {
  id: string
  title: string
  body: string
  categoryId: string | null
  categoryName: string | null
  status: string
  updatedAt: string
  publishedAt: string | null
}

export interface SaveKbArticle {
  title: string
  body: string
  categoryId?: string | null
  status: string
}

export function listKbArticles() {
  return api<KbArticleSummary[]>('/api/kb/articles')
}

export function getKbArticle(id: string) {
  return api<KbArticle>(`/api/kb/articles/${id}`)
}

export function createKbArticle(body: SaveKbArticle) {
  return api<KbArticle>('/api/kb/articles', { method: 'POST', body: JSON.stringify(body) })
}

export function updateKbArticle(id: string, body: SaveKbArticle) {
  return api<KbArticle>(`/api/kb/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteKbArticle(id: string) {
  return api<void>(`/api/kb/articles/${id}`, { method: 'DELETE' })
}

// ---- Public ----

export interface PublicKbSummary {
  id: string
  title: string
  categoryName: string | null
  excerpt: string
}

export interface PublicKbArticle {
  id: string
  title: string
  body: string
  categoryName: string | null
  publishedAt: string | null
}

export function listPublicKb(slug: string) {
  return api<PublicKbSummary[]>(`/api/public/workspaces/${slug}/kb`)
}

export function getPublicKbArticle(slug: string, id: string) {
  return api<PublicKbArticle>(`/api/public/workspaces/${slug}/kb/${id}`)
}

export function suggestKb(slug: string, q: string) {
  return api<PublicKbSummary[]>(`/api/public/workspaces/${slug}/kb/suggest?q=${encodeURIComponent(q)}`)
}
