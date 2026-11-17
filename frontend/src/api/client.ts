import { getCsrfToken } from '../lib/csrf'
import { ApiError, toApiError } from './errors'
import type {
  Api,
  CallDetail,
  CallHistoryList,
  CallId,
  PartDetail,
  PartsList,
  PartsQuery,
  ReviewRequest,
  ReviewResponse,
  Session,
  Summary,
} from './types'

export const API_BASE = '/api/v1'

type Method = 'GET' | 'POST'

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text.slice(0, 300) }
  }
}

/** Cliente HTTP del contrato v1: mismo origen, cookies de sesión y CSRF en escrituras. */
export class HttpApi implements Api {
  readonly mode = 'http' as const

  private async ensureCsrf(): Promise<string | null> {
    let token = getCsrfToken()
    if (!token) {
      // GET /auth/session fija la cookie csrftoken.
      await this.request<Session>('GET', '/auth/session')
      token = getCsrfToken()
    }
    return token
  }

  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      const token = await this.ensureCsrf()
      if (token) headers['X-CSRFToken'] = token
    }
    let res: Response
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, 'network', 'Sin conexión con el servidor.')
    }
    const data = await parseBody(res)
    if (!res.ok) throw toApiError(res.status, data)
    return data as T
  }

  getSession() {
    return this.request<Session>('GET', '/auth/session')
  }
  login(username: string, password: string) {
    return this.request<Session>('POST', '/auth/login', { username, password })
  }
  logout() {
    return this.request<Session>('POST', '/auth/logout', {})
  }
  getSummary() {
    return this.request<Summary>('GET', '/summary')
  }
  listCalls() {
    return this.request<CallHistoryList>('GET', '/calls')
  }
  getCall(id: CallId) {
    return this.request<CallDetail>('GET', `/calls/${encodeURIComponent(id)}`)
  }
  listParts(query: PartsQuery = {}) {
    const qs = new URLSearchParams()
    if (query.status) qs.set('status', query.status)
    if (query.call) qs.set('call', query.call)
    const s = qs.toString()
    return this.request<PartsList>('GET', `/parts${s ? `?${s}` : ''}`)
  }
  getPart(id: number) {
    return this.request<PartDetail>('GET', `/parts/${id}`)
  }
  postReview(id: number, body: ReviewRequest) {
    return this.request<ReviewResponse>('POST', `/parts/${id}/reviews`, body)
  }
  exportUrl(kind: 'csv' | 'xlsx') {
    return `${API_BASE}/exports/${kind}`
  }
}
