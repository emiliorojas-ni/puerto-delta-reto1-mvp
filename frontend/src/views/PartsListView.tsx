import { useEffect, useState, type KeyboardEvent } from 'react'
import { api, ApiError, type CallId, type PartStatusFilter, type PartSummary } from '../api'
import { ExportBar } from '../components/ExportBar'
import { DestinationBadge, StatusBadge } from '../components/StatusBadge'
import { addMoney, formatQty, formatUSD } from '../lib/money'

interface PartsListViewProps {
  initialStatus?: string
  initialCall?: string
  online: boolean
  staleOffline: boolean
  onFilterChange: (query: { status?: string; call?: string }) => void
  onSelectPart: (partId: number) => void
}

const STATUS_OPTIONS: { value: PartStatusFilter | ''; label: string }[] = [
  { value: '', label: 'Todos los estados (35)' },
  { value: 'pendientes', label: 'Pendientes de validar (Sugerido + Pendiente)' },
  { value: 'sugerido', label: 'Solo Sugeridos (con candidato)' },
  { value: 'pendiente', label: 'Solo Pendientes (sin candidato único)' },
  { value: 'confirmado', label: 'Confirmados por regla' },
  { value: 'validado', label: 'Validados por revisor' },
]

const CALL_OPTIONS: { value: CallId | ''; label: string }[] = [
  { value: '', label: 'Todos los destinos / candidatos' },
  { value: 'REC-2051', label: 'REC-2051 · MN ORION BAY (M1)' },
  { value: 'REC-2052', label: 'REC-2052 · MV PACIFIC CONDOR (M2)' },
  { value: 'REC-2053', label: 'REC-2053 · MV ALTIPLANO STAR (M3)' },
  { value: 'REC-SSGG', label: 'REC-SSGG · Servicios generales' },
]

export function PartsListView({
  initialStatus = '',
  initialCall = '',
  online,
  staleOffline,
  onFilterChange,
  onSelectPart,
}: PartsListViewProps) {
  const [status, setStatus] = useState<string>(initialStatus)
  const [call, setCall] = useState<string>(initialCall)
  const [search, setSearch] = useState('')
  const [parts, setParts] = useState<PartSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStatus(initialStatus)
    setCall(initialCall)
  }, [initialStatus, initialCall])

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.listParts({
          status: (status as PartStatusFilter) || '',
          call: (call as CallId) || '',
        })
        if (active) setParts(res.results)
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.detail : 'Error al consultar partes de jornal.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [status, call])

  const handleStatusChange = (nextStatus: string) => {
    setStatus(nextStatus)
    onFilterChange({ status: nextStatus || undefined, call: call || undefined })
  }

  const handleCallChange = (nextCall: string) => {
    setCall(nextCall)
    onFilterChange({ status: status || undefined, call: nextCall || undefined })
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? parts.filter(
        (p) =>
          p.ref.toLowerCase().includes(q) ||
          p.cuadrilla.toLowerCase().includes(q) ||
          p.tarea.toLowerCase().includes(q) ||
          p.observacion.toLowerCase().includes(q) ||
          p.reason.toLowerCase().includes(q)
      )
    : parts

  const totalFilteredUsd = filtered.length ? addMoney(...filtered.map((p) => p.amount_usd)) : '0.00'
  const totalFilteredJornales = filtered.length ? addMoney(...filtered.map((p) => p.jornales)).replace(/\.00$/, '') : '0'

  const onRowKey = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  return (
    <div id="parts-list-view">
      <div className="view-hero">
        <img className="view-hero-img" src="https://images.unsplash.com/photo-1508404999913-79a3a2e75437?w=1400&q=80&fit=crop" alt="Operaciones portuarias Puerto Delta" />
        <div className="view-hero-gradient" />
        <div className="view-hero-content">
          <div>
            <div className="view-hero-eyebrow">
              Auditoría y Control Operativo
              {(!online || staleOffline) && <span className="badge badge-unconfirmed" style={{ marginLeft: 10 }}>datos de la última conexión</span>}
            </div>
            <h1 className="view-hero-title">Partes de Jornal y Revisión de Excepciones</h1>
            <p className="view-hero-sub">Filtra por estado o recalada para auditar reglas, alertas y registrar validaciones</p>
          </div>
          <div className="view-hero-actions">
            <ExportBar idPrefix="parts-export" />
          </div>
        </div>
      </div>
      <div className="page-content">

      {/* Controles de filtrado */}
      <section className="glass-card" style={{ marginBottom: 18 }} aria-label="Filtros de partes">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-status-select" className="form-label">
              Estado del parte
            </label>
            <select
              id="filter-status-select"
              className="form-select"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-call-select" className="form-label">
              Recalada (destino o candidato sugerido)
            </label>
            <select
              id="filter-call-select"
              className="form-select"
              value={call}
              onChange={(e) => handleCallChange(e.target.value)}
            >
              {CALL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-search-input" className="form-label">
              Búsqueda rápida (ref, cuadrilla, tarea, nota)
            </label>
            <input
              id="filter-search-input"
              type="search"
              className="form-input"
              placeholder="Ej. CU-01, fila 13, Orio bay, M3…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              id="quick-filter-pendientes-btn"
              type="button"
              className={`btn btn-sm ${status === 'pendientes' ? 'btn-amber' : ''}`}
              onClick={() => handleStatusChange(status === 'pendientes' ? '' : 'pendientes')}
            >
              Solo Pendientes (Sugerido + Pendiente)
            </button>
            <button
              id="quick-filter-reset-btn"
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setSearch('')
                setStatus('')
                setCall('')
                onFilterChange({})
              }}
            >
              Limpiar filtros
            </button>
          </div>

          <div className="mono" style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Mostrando <strong>{filtered.length}</strong> partes · <strong>{formatQty(totalFilteredJornales)}</strong> jornales ·{' '}
            <strong style={{ color: 'var(--accent-teal)' }}>{formatUSD(totalFilteredUsd)}</strong>
          </div>
        </div>
      </section>

      {error && (
        <div className="alert-banner danger" role="alert">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 340 }} aria-busy="true" />
      ) : filtered.length === 0 ? (
        <section className="glass-card" style={{ textAlign: 'center', padding: '42px 20px' }}>
          <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>Sin partes que coincidan con el filtro</h2>
          <p className="field-hint">Prueba cambiando el estado o limpiando los criterios de búsqueda.</p>
        </section>
      ) : (
        <section className="glass-card" aria-label="Tabla de partes de jornal">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref / Fila</th>
                  <th>Fecha · Turno</th>
                  <th>Cuadrilla</th>
                  <th>Tarea</th>
                  <th>Observación original</th>
                  <th>Estado</th>
                  <th>Destino / Candidato sugerido</th>
                  <th>Regla y evidencia / motivo</th>
                  <th className="right">Pers. / Jorn.</th>
                  <th className="right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    id={`parts-row-${p.id}`}
                    className="clickable-row"
                    tabIndex={0}
                    role="link"
                    onClick={() => onSelectPart(p.id)}
                    onKeyDown={(e) => onRowKey(e, () => onSelectPart(p.id))}
                  >
                    <td className="mono">
                      <strong style={{ color: 'var(--accent-sky)' }}>#{p.id}</strong>
                      <div className="field-hint">{p.ref}</div>
                    </td>
                    <td className="mono">
                      {p.fecha} · <strong>{p.turno}</strong>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {p.cuadrilla}
                    </td>
                    <td>{p.tarea}</td>
                    <td>
                      {p.observacion ? (
                        <span>«{p.observacion}»</span>
                      ) : (
                        <span className="field-hint">(sin nota)</span>
                      )}
                      {p.alerts.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {p.alerts.map((a) => (
                            <span key={a.code} className="badge badge-sugerido" title={a.message}>
                              ⚠ {a.code}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={p.status} strength={p.strength} />
                    </td>
                    <td>
                      <DestinationBadge
                        destination={p.destination}
                        suggested={p.suggested}
                        status={p.status}
                      />
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--accent-teal)' }}>
                        {p.rule} · v{p.version}
                      </div>
                      <div className="field-hint">{p.reason}</div>
                    </td>
                    <td className="right mono">
                      {p.personas}p / <strong>{formatQty(p.jornales)}j</strong>
                    </td>
                    <td className="right mono" style={{ fontWeight: 700 }}>
                      {formatUSD(p.amount_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}
