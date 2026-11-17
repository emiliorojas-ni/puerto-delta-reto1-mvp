import { HttpApi } from './client'
import { MockApi, mockBumpVersion } from './mock'
import type { Api } from './types'

export * from './types'
export * from './errors'
export { HttpApi, API_BASE } from './client'
export { MockApi, mockBumpVersion, mockCsvDataUrl, resetMockState } from './mock'

const MOCK_PREF_KEY = 'pd-use-mock'

function readMockPref(): boolean {
  const envMock = String(import.meta.env.VITE_USE_MOCK ?? '').trim()
  if (envMock === '1' || envMock.toLowerCase() === 'true') return true
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(MOCK_PREF_KEY) === '1'
  } catch {
    return false
  }
}

const httpApi = new HttpApi()
const mockApi = new MockApi()

let activeMode: 'http' | 'mock' = readMockPref() ? 'mock' : 'http'

export function setApiMode(mode: 'http' | 'mock'): void {
  activeMode = mode
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (mode === 'mock') sessionStorage.setItem(MOCK_PREF_KEY, '1')
      else sessionStorage.removeItem(MOCK_PREF_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

export function getApiMode(): 'http' | 'mock' {
  return activeMode
}

export const api: Api = {
  get mode() {
    return activeMode
  },
  getSession() {
    return (activeMode === 'mock' ? mockApi : httpApi).getSession()
  },
  login(u, p) {
    return (activeMode === 'mock' ? mockApi : httpApi).login(u, p)
  },
  logout() {
    return (activeMode === 'mock' ? mockApi : httpApi).logout()
  },
  getSummary() {
    return (activeMode === 'mock' ? mockApi : httpApi).getSummary()
  },
  getCall(id) {
    return (activeMode === 'mock' ? mockApi : httpApi).getCall(id)
  },
  listParts(q) {
    return (activeMode === 'mock' ? mockApi : httpApi).listParts(q)
  },
  getPart(id) {
    return (activeMode === 'mock' ? mockApi : httpApi).getPart(id)
  },
  postReview(id, body) {
    return (activeMode === 'mock' ? mockApi : httpApi).postReview(id, body)
  },
  exportUrl(kind) {
    return (activeMode === 'mock' ? mockApi : httpApi).exportUrl(kind)
  },
}

export { mockBumpVersion as simulateVersionConflict }
