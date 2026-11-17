import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type CallId, type Session, type Summary } from './api'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import { CallDetailView } from './views/CallDetailView'
import { DashboardView } from './views/DashboardView'
import { LoginView } from './views/LoginView'
import { PartDetailView } from './views/PartDetailView'
import { PartsListView } from './views/PartsListView'

type RouteState =
  | { name: 'dashboard' }
  | { name: 'call'; id: CallId }
  | { name: 'parts'; status?: string; call?: string }
  | { name: 'part'; id: number }

function parseHashRoute(): RouteState {
  const rawHash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : ''
  const rawPath = rawHash || (typeof window !== 'undefined' ? window.location.pathname : '/')
  const [pathPart, qsPart = ''] = rawPath.split('?')
  const clean = pathPart.startsWith('/') ? pathPart : `/${pathPart}`

  const callMatch = /^\/calls\/([^/]+)$/.exec(clean)
  if (callMatch) {
    return { name: 'call', id: decodeURIComponent(callMatch[1]) as CallId }
  }

  const partMatch = /^\/parts\/(\d+)$/.exec(clean)
  if (partMatch) {
    return { name: 'part', id: Number(partMatch[1]) }
  }

  if (clean === '/parts') {
    const params = new URLSearchParams(qsPart)
    return {
      name: 'parts',
      status: params.get('status') || undefined,
      call: params.get('call') || undefined,
    }
  }

  return { name: 'dashboard' }
}

function toHash(route: RouteState): string {
  switch (route.name) {
    case 'dashboard':
      return '#/'
    case 'call':
      return `#/calls/${encodeURIComponent(route.id)}`
    case 'part':
      return `#/parts/${route.id}`
    case 'parts': {
      const qs = new URLSearchParams()
      if (route.status) qs.set('status', route.status)
      if (route.call) qs.set('call', route.call)
      const q = qs.toString()
      return `#/parts${q ? `?${q}` : ''}`
    }
  }
}

function nowTimeStr(): string {
  const d = new Date()
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function App() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [staleOffline, setStaleOffline] = useState<boolean>(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  const [session, setSession] = useState<Session>({ authenticated: false, user: null })
  const [authChecking, setAuthChecking] = useState<boolean>(true)

  const [route, setRoute] = useState<RouteState>(() => parseHashRoute())
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const navigate = useCallback((next: RouteState) => {
    const hash = toHash(next)
    if (typeof window !== 'undefined' && window.location.hash !== hash) {
      window.location.hash = hash
    }
    setRoute(next)
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(parseHashRoute())
    const onOnline = () => setOnline(true)
    const onOffline = () => {
      setOnline(false)
      setStaleOffline(true)
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const s = await api.getSummary()
      setSummary(s)
      setLastSyncedAt(nowTimeStr())
      if (typeof navigator === 'undefined' || navigator.onLine) {
        setStaleOffline(false)
      }
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthenticated) {
        setSession({ authenticated: false, user: null })
      } else {
        setSummaryError(err instanceof ApiError ? err.detail : 'No se pudo obtener el resumen del período.')
      }
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const init = async () => {
      setAuthChecking(true)
      try {
        const s = await api.getSession()
        if (!active) return
        setSession(s)
        if (s.authenticated) {
          await loadSummary()
        }
      } catch {
        if (active) setSession({ authenticated: false, user: null })
      } finally {
        if (active) setAuthChecking(false)
      }
    }
    void init()
    return () => {
      active = false
    }
  }, [loadSummary])

  // Al recuperar conexión, refrescar automáticamente el resumen para limpiar estado stale
  useEffect(() => {
    if (online && session.authenticated && staleOffline) {
      void loadSummary()
    }
  }, [online, session.authenticated, staleOffline, loadSummary])

  const handleLoginSuccess = (s: Session) => {
    setSession(s)
    void loadSummary()
  }

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch {
      // ignore logout error
    }
    setSession({ authenticated: false, user: null })
    setSummary(null)
  }

  return (
    <div className="app-shell">
      <ConnectivityBanner
        online={online}
        hasCachedData={Boolean(summary) || session.authenticated}
        lastSyncedAt={lastSyncedAt}
      />

      <header className="topbar">
        <a
          id="nav-brand-link"
          href="#/"
          className="brand"
          onClick={(e) => {
            e.preventDefault()
            navigate({ name: 'dashboard' })
          }}
        >
          <img src="/icons/icon.svg" alt="" className="brand-mark" />
          <div>
            <span>Puerto Delta</span>
            <span className="brand-sub">Costeo de Personal Eventual por Recalada</span>
          </div>
        </a>

        {session.authenticated && (
          <nav className="nav-links" aria-label="Navegación principal">
            <a
              id="nav-dashboard-link"
              href="#/"
              className={`nav-link ${route.name === 'dashboard' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'dashboard' })
              }}
            >
              Tablero
            </a>
            <a
              id="nav-parts-all-link"
              href="#/parts"
              className={`nav-link ${route.name === 'parts' && !route.status ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'parts' })
              }}
            >
              Partes (35)
            </a>
            <a
              id="nav-parts-pending-link"
              href="#/parts?status=pendientes"
              className={`nav-link ${route.name === 'parts' && route.status === 'pendientes' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'parts', status: 'pendientes' })
              }}
            >
              Pendientes
              {summary && (
                <span className="badge badge-sugerido mono" style={{ padding: '1px 7px' }}>
                  {summary.pending.parts}
                </span>
              )}
            </a>
            {(['REC-2051', 'REC-2052', 'REC-2053', 'REC-SSGG'] as CallId[]).map((cid) => (
              <a
                key={cid}
                id={`nav-call-${cid}-link`}
                href={`#/calls/${cid}`}
                className={`nav-link mono ${route.name === 'call' && route.id === cid ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate({ name: 'call', id: cid })
                }}
              >
                {cid}
              </a>
            ))}
          </nav>
        )}

        <div className="topbar-right">
          <span
            className={`badge ${online ? 'badge-validado' : 'badge-pendiente'}`}
            title={online ? 'Conectado al origen' : 'Sin conexión de red'}
          >
            {online ? '● En línea' : '○ Sin conexión'}
          </span>

          <span className="badge badge-neutral mono" title="Modo del cliente API">
            {api.mode === 'mock' ? 'MOCK v1' : 'API v1'}
          </span>

          {session.authenticated && session.user && (
            <>
              <span className="badge badge-confirmado mono" title="Usuario y rol de sesión">
                {session.user.username} ({session.user.roles.join(',')})
              </span>
              <button id="logout-btn" type="button" className="btn btn-sm" onClick={() => void handleLogout()}>
                Salir
              </button>
            </>
          )}
        </div>
      </header>

      <main className="main-content">
        {authChecking ? (
          <div className="skeleton" style={{ height: 260 }} aria-busy="true" aria-label="Verificando sesión" />
        ) : !session.authenticated ? (
          <LoginView onSuccess={handleLoginSuccess} online={online} />
        ) : route.name === 'dashboard' ? (
          <DashboardView
            summary={summary}
            loading={summaryLoading}
            error={summaryError}
            online={online}
            staleOffline={staleOffline}
            onRefresh={() => void loadSummary()}
            onNavigateCall={(id) => navigate({ name: 'call', id })}
            onNavigateParts={(q) => navigate({ name: 'parts', status: q?.status, call: q?.call })}
          />
        ) : route.name === 'call' ? (
          <CallDetailView
            callId={route.id}
            online={online}
            staleOffline={staleOffline}
            onBack={() => navigate({ name: 'dashboard' })}
            onSelectPart={(id) => navigate({ name: 'part', id })}
            onFilterParts={(q) => navigate({ name: 'parts', status: q.status, call: q.call })}
          />
        ) : route.name === 'parts' ? (
          <PartsListView
            initialStatus={route.status}
            initialCall={route.call}
            online={online}
            staleOffline={staleOffline}
            onFilterChange={(q) => navigate({ name: 'parts', status: q.status, call: q.call })}
            onSelectPart={(id) => navigate({ name: 'part', id })}
          />
        ) : (
          <PartDetailView
            partId={route.id}
            online={online}
            staleOffline={staleOffline}
            onBack={() => navigate({ name: 'parts', status: 'pendientes' })}
            onNavigateCall={(id) => navigate({ name: 'call', id })}
            onReviewed={() => void loadSummary()}
          />
        )}
      </main>
    </div>
  )
}
