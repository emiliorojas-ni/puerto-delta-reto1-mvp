import { useEffect, useState, type KeyboardEvent } from 'react'
import { api, ApiError, type CallDetail, type CallId } from '../api'
import { ExportBar } from '../components/ExportBar'
import { StatusBadge } from '../components/StatusBadge'
import { addMoney, formatQty, formatUSD } from '../lib/money'

interface CallDetailViewProps {
  callId: CallId
  online: boolean
  staleOffline: boolean
  onBack: () => void
  onSelectPart: (partId: number) => void
  onFilterParts: (query: { status?: string; call?: string }) => void
}

export function CallDetailView({
  callId,
  online,
  staleOffline,
  onBack,
  onSelectPart,
  onFilterParts,
}: CallDetailViewProps) {
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadCall = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getCall(callId)
      setDetail(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Error al cargar la ficha de recalada.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCall()
  }, [callId])

  const onRowKey = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  if (loading && !detail) {
    return (
      <section aria-busy="true" aria-label={`Cargando ficha de recalada ${callId}`}>
        <div className="skeleton" style={{ height: 110, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 240, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </section>
    )
  }

  if (error && !detail) {
    return (
      <section className="glass-card" role="alert">
        <h1 className="page-title">No se pudo cargar la recalada {callId}</h1>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          {error}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button id="call-back-error-btn" type="button" className="btn" onClick={onBack}>
            ← Volver al tablero
          </button>
          <button id="call-retry-btn" type="button" className="btn btn-primary" onClick={() => void loadCall()}>
            Reintentar
          </button>
        </div>
      </section>
    )
  }

  if (!detail) return null

  const { call, parts, suggested_parts, piecework, totals } = detail
  const scenarioTotal = addMoney(totals.total_usd, call.suggested_usd)

  return (
    <div id="call-detail-view">
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <button id="call-back-btn" type="button" className="btn btn-sm" onClick={onBack}>
              ← Tablero
            </button>
            <span className="badge badge-confirmado mono">{call.id}</span>
            {(!online || staleOffline) && (
              <span className="badge badge-unconfirmed">datos de la última conexión, no confirmados</span>
            )}
          </div>
          <h1 className="page-title">
            {call.nave} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {call.muelle}</span>
          </h1>
          <p className="page-subtitle">
            Cliente: <strong>{call.cliente}</strong> · Carga: {call.tipo_carga} · Ventana:{' '}
            <span className="mono">
              {call.atraque.replace('T', ' ')} → {call.desatraque.replace('T', ' ')}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <ExportBar idPrefix="call-export" />
          <button
            id="call-filter-all-parts-btn"
            type="button"
            className="btn btn-sm"
            onClick={() => onFilterParts({ call: call.id })}
          >
            Ver en buscador de partes
          </button>
        </div>
      </div>

      {/* Totales de la Recalada */}
      <section className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} aria-label="Totales de la recalada">
        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-sky)' }}>
          <span className="kpi-label">Jornal Confirmado</span>
          <span className="kpi-value">{formatUSD(totals.jornal_usd)}</span>
          <div className="kpi-meta">
            <span>{formatQty(call.jornales)} jornales</span>
            <span>{parts.length} partes</span>
          </div>
        </article>

        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-emerald)' }}>
          <span className="kpi-label">Destajo Confirmado</span>
          <span className="kpi-value">{formatUSD(totals.destajo_usd)}</span>
          <div className="kpi-meta">
            <span>{piecework.length} líneas de producción</span>
            <span>Tonelaje medido</span>
          </div>
        </article>

        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-teal)' }}>
          <span className="kpi-label">Total Confirmado ({call.id})</span>
          <span className="kpi-value">{formatUSD(totals.total_usd)}</span>
          <div className="kpi-meta">
            <span>Jornal + Destajo</span>
            <span>Suma al subtotal oficial</span>
          </div>
        </article>

        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-amber)' }}>
          <span className="kpi-label">Escenario con sugeridos, no confirmado</span>
          <span className="kpi-value" style={{ color: 'var(--accent-amber)' }}>
            {formatUSD(scenarioTotal)}
          </span>
          <div className="kpi-meta">
            <span>
              +{formatUSD(call.suggested_usd)} ({formatQty(call.suggested_jornales)} j. en {suggested_parts.length} partes)
            </span>
          </div>
        </article>
      </section>

      {/* Tabla 1: Partes Confirmados y Validados */}
      <section className="glass-card" style={{ marginBottom: 20 }} aria-labelledby="confirmed-parts-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 id="confirmed-parts-heading" style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-display)' }}>
              Partes de Jornal Confirmados y Validados ({parts.length})
            </h2>
            <p className="field-hint" style={{ margin: '2px 0 0' }}>
              Suman al subtotal oficial de {call.id} ({formatUSD(totals.jornal_usd)}). Haz clic en una fila para inspeccionar su evidencia.
            </p>
          </div>
          <span className="badge badge-confirmado">Confirmados + Validados</span>
        </div>

        {parts.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No hay partes confirmados o validados para este destino.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" aria-label={`Partes confirmados de ${call.id}`}>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Fecha / Turno</th>
                  <th>Cuadrilla</th>
                  <th>Tarea</th>
                  <th>Observación</th>
                  <th>Estado</th>
                  <th>Regla / Motivo</th>
                  <th className="right">Personas</th>
                  <th className="right">Jornales</th>
                  <th className="right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr
                    key={p.id}
                    id={`call-confirmed-part-row-${p.id}`}
                    className="clickable-row"
                    tabIndex={0}
                    role="link"
                    onClick={() => onSelectPart(p.id)}
                    onKeyDown={(e) => onRowKey(e, () => onSelectPart(p.id))}
                  >
                    <td className="mono" style={{ color: 'var(--accent-sky)' }}>
                      {p.ref}
                    </td>
                    <td className="mono">
                      {p.fecha} · {p.turno}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {p.cuadrilla}
                    </td>
                    <td>{p.tarea}</td>
                    <td>
                      {p.observacion ? (
                        <span>«{p.observacion}»</span>
                      ) : (
                        <span className="field-hint">(vacía)</span>
                      )}
                      {p.alerts.length > 0 && (
                        <div style={{ marginTop: 4 }}>
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
                      <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-teal)' }}>
                        {p.rule}
                      </div>
                      <div className="field-hint">{p.reason}</div>
                    </td>
                    <td className="right mono">{p.personas}</td>
                    <td className="right mono">{formatQty(p.jornales)}</td>
                    <td className="right mono" style={{ fontWeight: 700 }}>
                      {formatUSD(p.amount_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tabla 2: Partes Sugeridos (separados, etiquetados) */}
      <section
        className="glass-card"
        style={{ marginBottom: 20, borderColor: 'hsla(40, 96%, 58%, 0.38)' }}
        aria-labelledby="suggested-parts-heading"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 id="suggested-parts-heading" style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-display)', color: 'var(--accent-amber)' }}>
              Partes Sugeridos con Candidato {call.id} ({suggested_parts.length}) — escenario con sugeridos, no confirmado
            </h2>
            <p className="field-hint" style={{ margin: '2px 0 0' }}>
              Estos partes no tienen evidencia concluyente en la nota; su importe ({formatUSD(call.suggested_usd)}) permanece en «Pendiente» hasta validación humana.
            </p>
          </div>
          <span className="badge badge-unconfirmed">escenario con sugeridos, no confirmado</span>
        </div>

        {suggested_parts.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No existen partes sugeridos pendientes para {call.id}.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" aria-label={`Partes sugeridos de ${call.id}`}>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Fecha / Turno</th>
                  <th>Cuadrilla</th>
                  <th>Tarea</th>
                  <th>Observación</th>
                  <th>Estado / Fuerza</th>
                  <th>Evidencia faltante y motivo</th>
                  <th className="right">Jornales</th>
                  <th className="right">Importe (en Pendiente)</th>
                </tr>
              </thead>
              <tbody>
                {suggested_parts.map((p) => (
                  <tr
                    key={p.id}
                    id={`call-suggested-part-row-${p.id}`}
                    className="clickable-row"
                    tabIndex={0}
                    role="link"
                    onClick={() => onSelectPart(p.id)}
                    onKeyDown={(e) => onRowKey(e, () => onSelectPart(p.id))}
                  >
                    <td className="mono" style={{ color: 'var(--accent-amber)' }}>
                      {p.ref}
                    </td>
                    <td className="mono">
                      {p.fecha} · {p.turno}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {p.cuadrilla}
                    </td>
                    <td>{p.tarea}</td>
                    <td>
                      {p.observacion ? <span>«{p.observacion}»</span> : <span className="field-hint">(nota vacía)</span>}
                    </td>
                    <td>
                      <StatusBadge status={p.status} strength={p.strength} />
                    </td>
                    <td>
                      <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-amber)' }}>
                        {p.rule}
                      </div>
                      <div className="field-hint">{p.reason}</div>
                    </td>
                    <td className="right mono">{formatQty(p.jornales)}</td>
                    <td className="right mono" style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>
                      {formatUSD(p.amount_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tabla 3: Producción a Destajo */}
      <section className="glass-card" aria-labelledby="piecework-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 id="piecework-heading" style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-display)' }}>
              Producción a Destajo ({piecework.length} líneas)
            </h2>
            <p className="field-hint" style={{ margin: '2px 0 0' }}>
              Cada línea de producción tiene destino directo a la recalada y tarifa según concepto del tarifario (R6 · R10).
            </p>
          </div>
          <span className="badge badge-validado mono">Subtotal Destajo: {formatUSD(totals.destajo_usd)}</span>
        </div>

        {piecework.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Este destino no registra líneas de producción a destajo (aplica solo a recaladas operativas de carga).
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" aria-label={`Producción a destajo de ${call.id}`}>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Fecha / Turno</th>
                  <th>Cuadrilla</th>
                  <th>Concepto</th>
                  <th className="right">Personas</th>
                  <th className="right">Toneladas (t)</th>
                  <th className="right">Tarifa (USD/t)</th>
                  <th className="right">Importe (USD)</th>
                </tr>
              </thead>
              <tbody>
                {piecework.map((w) => (
                  <tr key={w.id} id={`piecework-row-${w.id}`}>
                    <td className="mono">{w.ref}</td>
                    <td className="mono">
                      {w.fecha} · {w.turno}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {w.cuadrilla}
                    </td>
                    <td>{w.concepto}</td>
                    <td className="right mono">{w.personas}</td>
                    <td className="right mono">{formatQty(w.toneladas)}</td>
                    <td className="right mono">{formatUSD(w.tarifa_usd)}</td>
                    <td className="right mono" style={{ fontWeight: 700 }}>
                      {formatUSD(w.amount_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'hsla(210, 48%, 10%, 0.9)', fontWeight: 700 }}>
                  <td colSpan={7}>TOTAL CONFIRMADO {call.id} (Jornal {formatUSD(totals.jornal_usd)} + Destajo {formatUSD(totals.destajo_usd)})</td>
                  <td className="right mono" style={{ color: 'var(--accent-teal)' }}>
                    {formatUSD(totals.total_usd)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
