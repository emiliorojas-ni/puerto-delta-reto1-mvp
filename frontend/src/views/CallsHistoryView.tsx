import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { api, ApiError, type CallHistoryItem, type CallId } from '../api'
import { formatQty, formatUSD } from '../lib/money'

interface CallsHistoryViewProps {
  online: boolean
  staleOffline: boolean
  onSelectCall: (id: CallId) => void
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function CallsHistoryView({ online, staleOffline, onSelectCall }: CallsHistoryViewProps) {
  const [calls, setCalls] = useState<CallHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [dock, setDock] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.listCalls()
        if (active) setCalls(response.results)
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.detail : 'No se pudo consultar el historial de recaladas.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const docks = useMemo(
    () => Array.from(new Set(calls.map((call) => call.muelle))).sort((a, b) => a.localeCompare(b)),
    [calls],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return calls.filter((call) => {
      const callDate = call.atraque.slice(0, 10)
      const matchesSearch =
        !query ||
        call.id.toLowerCase().includes(query) ||
        call.nave.toLowerCase().includes(query) ||
        call.cliente.toLowerCase().includes(query) ||
        call.tipo_carga.toLowerCase().includes(query)
      return (
        matchesSearch &&
        (!status || call.operational_status === status) &&
        (!dock || call.muelle === dock) &&
        (!dateFrom || callDate >= dateFrom) &&
        (!dateTo || callDate <= dateTo)
      )
    })
  }, [calls, dateFrom, dateTo, dock, search, status])

  const activeCount = calls.filter((call) => call.operational_status === 'activa').length
  const completedCount = calls.filter((call) => call.operational_status === 'finalizada').length
  const statusLabels = {
    pendiente: 'Pendiente',
    activa: 'Lote activo',
    finalizada: 'Lote anterior',
  } as const
  const clearFilters = () => {
    setSearch('')
    setStatus('')
    setDock('')
    setDateFrom('')
    setDateTo('')
  }
  const openCall = (call: CallHistoryItem) => {
    if (call.is_current_batch) onSelectCall(call.id)
  }
  const onRowKey = (event: KeyboardEvent, call: CallHistoryItem) => {
    if (call.is_current_batch && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      openCall(call)
    }
  }

  return (
    <div id="calls-history-view">
      <div className="view-hero">
        <img
          className="view-hero-img"
          src="https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?w=1600&q=82&fit=crop"
          alt="Terminal portuario y buques de carga"
        />
        <div className="view-hero-gradient" />
        <div className="view-hero-content">
          <div>
            <div className="view-hero-eyebrow">
              Control de operaciones portuarias
              {(!online || staleOffline) && <span className="badge badge-unconfirmed">datos de la última conexión</span>}
            </div>
            <h1 className="view-hero-title">Historial de Recaladas</h1>
            <p className="view-hero-sub">Consulta recaladas vigentes y anteriores por nave, período, estado o muelle</p>
          </div>
          <div className="history-hero-stats" aria-label="Resumen de recaladas">
            <div><strong>{calls.length}</strong><span>Total</span></div>
            <div><strong>{activeCount}</strong><span>En lote activo</span></div>
            <div><strong>{completedCount}</strong><span>En lotes anteriores</span></div>
          </div>
        </div>
      </div>

      <div className="page-content">
        <section className="history-filter-panel" aria-label="Filtros del historial de recaladas">
          <div className="history-filter-heading">
            <div>
              <h2>Explorar recaladas</h2>
              <p>Combina criterios para localizar una operación específica.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={clearFilters}>Limpiar filtros</button>
          </div>
          <div className="history-filters">
            <div className="form-field">
              <label className="form-label" htmlFor="calls-search">Nave, código, cliente o carga</label>
              <input
                id="calls-search"
                type="search"
                className="form-input"
                placeholder="Ej. REC-2051, Orion, acero…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="calls-status">Estado</label>
              <select id="calls-status" className="form-select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="activa">En lote activo</option>
                <option value="finalizada">En lotes anteriores</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="calls-dock">Muelle</label>
              <select id="calls-dock" className="form-select" value={dock} onChange={(event) => setDock(event.target.value)}>
                <option value="">Todos los muelles</option>
                {docks.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="calls-from">Desde</label>
              <input id="calls-from" type="date" className="form-input" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="calls-to">Hasta</label>
              <input id="calls-to" type="date" className="form-input" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
          </div>
        </section>

        {error && <div className="alert-banner danger" role="alert">{error}</div>}

        {loading ? (
          <div className="history-list">
            {[1, 2, 3].map((item) => <div key={item} className="skeleton" style={{ height: 134 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <section className="glass-card history-empty">
            <h2>No encontramos recaladas</h2>
            <p>Prueba ampliando el rango de fechas o eliminando alguno de los filtros.</p>
            <button type="button" className="btn btn-primary" onClick={clearFilters}>Ver todo el historial</button>
          </section>
        ) : (
          <section aria-labelledby="calls-results-heading">
            <div className="section-header">
              <div>
                <h2 id="calls-results-heading" className="section-title">Recaladas registradas</h2>
                <p className="section-sub">Mostrando {filtered.length} de {calls.length} operaciones</p>
              </div>
            </div>
            <div className="history-list">
              {filtered.map((call) => (
                <article
                  key={`${call.batch_id}-${call.id}`}
                  className={`history-call-card status-${call.operational_status} ${call.is_current_batch ? 'is-current' : ''}`}
                  tabIndex={call.is_current_batch ? 0 : undefined}
                  role={call.is_current_batch ? 'link' : undefined}
                  onClick={() => openCall(call)}
                  onKeyDown={(event) => onRowKey(event, call)}
                >
                  <div className="history-call-date">
                    <span>{new Date(call.atraque).toLocaleDateString('es-PE', { month: 'short' })}</span>
                    <strong>{new Date(call.atraque).getDate().toString().padStart(2, '0')}</strong>
                    <small>{new Date(call.atraque).getFullYear()}</small>
                  </div>
                  <div className="history-call-main">
                    <div className="history-call-topline">
                      <span className="call-card-id">{call.id}</span>
                      <span className={`badge call-status-badge status-${call.operational_status}`}>
                        {statusLabels[call.operational_status]}
                      </span>
                    </div>
                    <h3>{call.nave}</h3>
                    <p>{call.cliente} · {call.tipo_carga}</p>
                    <div className="history-call-window">
                      <span><b>Atraque</b>{formatDateTime(call.atraque)}</span>
                      <span><b>Desatraque</b>{formatDateTime(call.desatraque)}</span>
                      <span><b>Ubicación</b>{call.muelle}</span>
                    </div>
                  </div>
                  <div className="history-call-cost">
                    <span>Costo total</span>
                    <strong>{formatUSD(call.total_usd)}</strong>
                    <small>{formatQty(call.jornales)} jornales · {call.parts} partes</small>
                    {call.is_current_batch ? <em>Ver detalle</em> : <em>Lote #{call.batch_id}</em>}
                  </div>
                  <div className="call-status-progress" aria-label={`Estado del registro: ${statusLabels[call.operational_status]}`}>
                    {(['pendiente', 'activa', 'finalizada'] as const).map((step) => (
                      <div
                        key={step}
                        className={`call-status-step ${call.operational_status === step ? 'is-selected' : ''}`}
                        aria-current={call.operational_status === step ? 'step' : undefined}
                      >
                        <span />
                        <small>{statusLabels[step]}</small>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
