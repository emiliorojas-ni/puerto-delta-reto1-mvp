import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type CallId, type Session, type Summary } from './api'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import { CallDetailView } from './views/CallDetailView'
import { CallsHistoryView } from './views/CallsHistoryView'
import { DashboardView } from './views/DashboardView'
import { LoginView } from './views/LoginView'
import { PartDetailView } from './views/PartDetailView'
import { PartsListView } from './views/PartsListView'

type NavIconName = 'dashboard' | 'parts' | 'pending' | 'call'

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    parts: (
      <>
        <path d="M8 4h8" />
        <path d="M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1Z" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14H4V6a2 2 0 0 1 2-2h2" />
        <path d="M8 11h8M8 15h6" />
      </>
    ),
    pending: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    call: (
      <>
        <path d="M4 18h16M6 18V9l6-4 6 4v9" />
        <path d="M9 18v-5h6v5M3 9l9-6 9 6" />
      </>
    ),
  }

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

type RouteState =
  | { name: 'dashboard' }
  | { name: 'calls' }
  | { name: 'call'; id: CallId }
  | { name: 'parts'; status?: string; call?: string }
  | { name: 'part'; id: number }

function parseHashRoute(): RouteState {
  const rawHash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : ''
  const rawPath = rawHash || (typeof window !== 'undefined' ? window.location.pathname : '/')
  const [pathPart, qsPart = ''] = rawPath.split('?')
  const clean = pathPart.startsWith('/') ? pathPart : `/${pathPart}`

  if (clean === '/calls') {
    return { name: 'calls' }
  }

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
    case 'calls':
      return '#/calls'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('deltaops-sidebar-collapsed') === 'true'
  })

  useEffect(() => {
    window.localStorage.setItem('deltaops-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

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

      <div className={`portal-layout ${!session.authenticated ? 'auth-layout' : sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
        {session.authenticated && (
          <aside className="sidebar" data-collapsed={sidebarCollapsed}>
          <div className="sidebar-photo">
            <img
              src="https://images.unsplash.com/photo-1508404999913-79a3a2e75437?w=400&q=70&fit=crop"
              alt=""
              aria-hidden="true"
            />
            <div className="sidebar-photo-overlay" />
            <div className="sidebar-logo">
              <a
                id="nav-brand-link"
                href="#/"
                onClick={(e) => {
                  e.preventDefault()
                  navigate({ name: 'dashboard' })
                }}
              >
                <img src="/icons/icon.svg" alt="" className="brand-mark" />
                <span className="sidebar-brand-copy">
                  <span className="sidebar-logo-name">Puerto Delta</span>
                  <span className="sidebar-logo-sub">Sistema Logístico Integrado · Costeo por Recalada</span>
                </span>
              </a>
            </div>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={sidebarCollapsed ? 'Desplegar navegación' : 'Ocultar navegación'}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Desplegar navegación' : 'Ocultar navegación'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={sidebarCollapsed ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
              </svg>
            </button>
          </div>

            <nav className="sidebar-nav" aria-label="Navegación principal">
              <div className="nav-group">
                <span className="nav-group-label">Operación</span>
                <a
                  id="nav-dashboard-link"
                  href="#/"
                  className={`nav-link ${route.name === 'dashboard' ? 'active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate({ name: 'dashboard' })
                  }}
                >
                  <NavIcon name="dashboard" />
                  <span className="nav-link-label">Tablero</span>
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
                  <NavIcon name="parts" />
                  <span className="nav-link-label">Partes (35)</span>
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
                  <NavIcon name="pending" />
                  <span className="nav-link-label">Pendientes</span>
                  {summary && (
                    <span className="badge badge-sugerido mono" style={{ padding: '1px 7px' }}>
                      {summary.pending.parts}
                    </span>
                  )}
                </a>
              </div>

              <div className="nav-group">
                <span className="nav-group-label">Gestión portuaria</span>
                <a
                  id="nav-calls-link"
                  href="#/calls"
                  className={`nav-link ${route.name === 'calls' || route.name === 'call' ? 'active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate({ name: 'calls' })
                  }}
                >
                  <NavIcon name="call" />
                  <span className="nav-link-label">Recaladas</span>
                </a>
              </div>
            </nav>

          <div className="sidebar-footer">
            <span>DeltaOps · v1.0 — Hackathon Arequipa 2026<br />
              Control de personal eventual portuario</span>
          </div>
          </aside>
        )}

        <section className="workspace">
          <header className="utilitybar">
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
        ) : route.name === 'calls' ? (
          <CallsHistoryView
            online={online}
            staleOffline={staleOffline}
            onSelectCall={(id) => navigate({ name: 'call', id })}
          />
        ) : route.name === 'call' ? (
          <CallDetailView
            callId={route.id}
            online={online}
            staleOffline={staleOffline}
            onBack={() => navigate({ name: 'calls' })}
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
        </section>
      </div>
    </div>
  )
}
