import type { KeyboardEvent } from 'react'
import type { CallId, Summary } from '../api'
import { ExportBar } from '../components/ExportBar'
import { addMoney, formatQty, formatUSD, ratio } from '../lib/money'

interface DashboardViewProps {
  summary: Summary | null
  loading: boolean
  error: string | null
  online: boolean
  staleOffline: boolean
  onRefresh: () => void
  onNavigateCall: (id: CallId) => void
  onNavigateParts: (query?: { status?: string; call?: string }) => void
}

export function DashboardView({
  summary,
  loading,
  error,
  online,
  staleOffline,
  onRefresh,
  onNavigateCall,
  onNavigateParts,
}: DashboardViewProps) {
  if (loading && !summary) {
    return (
      <section aria-busy="true" aria-label="Cargando tablero de costos">
        <div className="page-header">
          <div>
            <h1 className="page-title">Tablero de Costeo por Recalada</h1>
            <p className="page-subtitle">Cargando resumen del lote y conciliación monetaria…</p>
          </div>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="skeleton" style={{ height: 118 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 150, marginBottom: 20 }} />
        <div className="calls-grid">
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: 240 }} />
          ))}
        </div>
      </section>
    )
  }

  if (error && !summary) {
    return (
      <section className="glass-card" role="alert">
        <h1 className="page-title">No se pudo cargar el tablero</h1>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          {error}
        </p>
        <button id="dashboard-retry-btn" type="button" className="btn btn-primary" onClick={onRefresh}>
          Reintentar carga
        </button>
      </section>
    )
  }

  if (!summary) {
    return (
      <section className="glass-card">
        <h1 className="page-title">Sin lote activo</h1>
        <p className="page-subtitle">No se encontraron datos importados para el período.</p>
      </section>
    )
  }

  const { batch, rate_jornal_usd, calls, ssgg, pending, totals, control, status_counts } = summary
  const shaShort = batch.sha256 ? batch.sha256.slice(0, 12) : '—'

  // Segmentos para la visualización de barra apilada sobre el total del período
  const segments = [
    ...calls.map((c, idx) => ({
      id: c.id,
      label: `${c.id} (${c.nave})`,
      amount: c.total_usd,
      pct: Math.max(0, ratio(c.total_usd, totals.total_usd) * 100),
      color: idx === 0 ? 'hsl(171, 77%, 52%)' : idx === 1 ? 'hsl(199, 90%, 56%)' : 'hsl(156, 72%, 46%)',
    })),
    {
      id: 'REC-SSGG',
      label: 'REC-SSGG (Servicios generales)',
      amount: ssgg.jornal_usd,
      pct: Math.max(0, ratio(ssgg.jornal_usd, totals.total_usd) * 100),
      color: 'hsl(258, 82%, 68%)',
    },
    {
      id: 'PENDIENTE',
      label: 'Pendiente / Sugerido (sin confirmar)',
      amount: pending.jornal_usd,
      pct: Math.max(0, ratio(pending.jornal_usd, totals.total_usd) * 100),
      color: 'hsl(40, 96%, 56%)',
    },
  ]

  const onRowKey = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  return (
    <div id="dashboard-view">
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title">Tablero de Costeo por Recalada</h1>
            {(!online || staleOffline) && (
              <span className="badge badge-unconfirmed">datos de la última conexión, no confirmados</span>
            )}
          </div>
          <p className="page-subtitle">
            Lote <span className="mono">#{batch.id}</span> · Versión de resultados{' '}
            <span className="mono">v{batch.results_version}</span> · SHA-256{' '}
            <code className="mono" title={batch.sha256}>
              {shaShort}…
            </code>{' '}
            · {batch.source_rows} filas fuente · Tarifa jornal {formatUSD(rate_jornal_usd)}
          </p>
        </div>
        <div className="header-actions">
          <ExportBar idPrefix="dashboard-export" />
          <button
            id="dashboard-refresh-btn"
            type="button"
            className="btn btn-sm"
            onClick={onRefresh}
            disabled={!online}
            title={!online ? 'Sin conexión para actualizar' : 'Actualizar datos del servidor'}
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner warning" role="alert">
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <section className="kpi-grid" aria-label="Indicadores clave del período">
        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-teal)' }}>
          <span className="kpi-label">Total Período</span>
          <span className="kpi-value">{formatUSD(totals.total_usd)}</span>
          <div className="kpi-meta">
            <span>{totals.lines} líneas de costo</span>
            <span className="mono">
              {totals.jornal_lines}J + {totals.destajo_lines}D
            </span>
          </div>
        </article>

        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-sky)' }}>
          <span className="kpi-label">Jornal Total</span>
          <span className="kpi-value">{formatUSD(totals.jornal_usd)}</span>
          <div className="kpi-meta">
            <span>{formatQty(totals.jornales)} jornales</span>
            <span>{totals.jornal_lines} partes</span>
          </div>
        </article>

        <article className="glass-card kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-emerald)' }}>
          <span className="kpi-label">Destajo Total</span>
          <span className="kpi-value">{formatUSD(totals.destajo_usd)}</span>
          <div className="kpi-meta">
            <span>{totals.destajo_lines} producciones</span>
            <span>Destino directo</span>
          </div>
        </article>

        <article
          id="kpi-ssgg-card"
          className="glass-card kpi-card interactive"
          style={{ ['--kpi-accent' as string]: 'var(--accent-violet)' }}
          tabIndex={0}
          role="button"
          aria-label={`Ver ficha REC-SSGG: ${formatUSD(ssgg.jornal_usd)}`}
          onClick={() => onNavigateCall('REC-SSGG')}
          onKeyDown={(e) => onRowKey(e, () => onNavigateCall('REC-SSGG'))}
        >
          <span className="kpi-label">REC-SSGG · Generales</span>
          <span className="kpi-value">{formatUSD(ssgg.jornal_usd)}</span>
          <div className="kpi-meta">
            <span>
              {formatQty(ssgg.jornales)} jornales · {ssgg.parts} partes
            </span>
            <span style={{ color: 'var(--accent-violet)' }}>Ver ficha →</span>
          </div>
        </article>

        <article
          id="kpi-pending-card"
          className="glass-card kpi-card interactive"
          style={{ ['--kpi-accent' as string]: 'var(--accent-amber)' }}
          tabIndex={0}
          role="button"
          aria-label={`Ver partes pendientes: ${formatUSD(pending.jornal_usd)}`}
          onClick={() => onNavigateParts({ status: 'pendientes' })}
          onKeyDown={(e) => onRowKey(e, () => onNavigateParts({ status: 'pendientes' }))}
        >
          <span className="kpi-label">Pendiente de Confirmar</span>
          <span className="kpi-value">{formatUSD(pending.jornal_usd)}</span>
          <div className="kpi-meta">
            <span>
              {formatQty(pending.jornales)} j. ({pending.by_status.sugerido} sug. / {pending.by_status.pendiente} pend.)
            </span>
            <span style={{ color: 'var(--accent-amber)' }}>Revisar →</span>
          </div>
        </article>
      </section>

      {/* Control Monetario y Barra Apilada */}
      <section
        className={`glass-card control-panel ${control.ok ? '' : 'control-alert'}`}
        aria-labelledby="control-heading"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 id="control-heading" style={{ margin: 0, fontSize: '1.12rem', fontFamily: 'var(--font-display)' }}>
              Control Monetario del Período (R10 · R11)
            </h2>
            <p className="field-hint" style={{ margin: '2px 0 0' }}>
              El importe de partes sugeridos y pendientes se contabiliza en el control global sin inflar los subtotales confirmados por recalada.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {control.ok ? (
              <span className="badge badge-validado">Control OK · Cuadrado ({formatUSD(control.expected_usd)})</span>
            ) : (
              <span className="badge badge-pendiente">Alerta de diferencia: {formatUSD(control.difference_usd)}</span>
            )}
            <span className="badge badge-neutral mono">
              Confirmados: {status_counts.confirmado} · Validados: {status_counts.validado} · Sugeridos:{' '}
              {status_counts.sugerido} · Pendientes: {status_counts.pendiente}
            </span>
          </div>
        </div>

        <div className="control-grid">
          <div className="control-metric">
            <div className="control-metric-label">Control esperado</div>
            <div className="control-metric-value">{formatUSD(control.expected_usd)}</div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Libro (Ledger)</div>
            <div className="control-metric-value">{formatUSD(control.ledger_usd)}</div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Recalculado desde origen</div>
            <div className="control-metric-value">{formatUSD(control.recomputed_usd)}</div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Diferencia</div>
            <div
              className="control-metric-value"
              style={{ color: control.ok ? 'var(--accent-emerald)' : 'var(--accent-coral)' }}
            >
              {formatUSD(control.difference_usd)}
            </div>
          </div>
        </div>

        {control.discrepancies.length > 0 && (
          <div className="alert-banner danger" style={{ marginTop: 14, marginBottom: 0 }}>
            <div>
              <strong>Discrepancias detectadas por referencia:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {control.discrepancies.map((d) => (
                  <li key={d.ref} className="mono">
                    {d.ref} ({d.kind}): libro {formatUSD(d.ledger_usd)} vs recalculado {formatUSD(d.recomputed_usd)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Visualización de barra apilada (CSS/SVG puro) */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>Distribución del control del período ({formatUSD(totals.total_usd)})</span>
            <span>Subtotales confirmados + REC-SSGG + Pendiente</span>
          </div>
          <div className="stacked-bar-track" role="img" aria-label="Barra apilada de costos por recalada, servicios generales y pendientes">
            {segments.map((seg) => (
              <div
                key={seg.id}
                className="stacked-bar-seg"
                style={{ width: `${seg.pct.toFixed(2)}%`, background: seg.color }}
                title={`${seg.label}: ${formatUSD(seg.amount)} (${seg.pct.toFixed(1)}%)`}
              />
            ))}
          </div>
          <div className="stacked-legend">
            {segments.map((seg) => (
              <span key={seg.id} className="legend-item">
                <span className="legend-dot" style={{ background: seg.color }} />
                <span>
                  <strong>{seg.id}</strong>: {formatUSD(seg.amount)} ({seg.pct.toFixed(1)}%)
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Tarjetas por Recalada */}
      <section aria-labelledby="calls-cards-heading" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 id="calls-cards-heading" style={{ margin: 0, fontSize: '1.18rem', fontFamily: 'var(--font-display)' }}>
            Recaladas Operativas del Lote
          </h2>
          <button
            id="dashboard-all-parts-btn"
            type="button"
            className="btn btn-sm"
            onClick={() => onNavigateParts({})}
          >
            Explorar los {totals.jornal_lines} partes de jornal →
          </button>
        </div>

        <div className="calls-grid">
          {calls.map((c) => {
            const scenarioTotal = addMoney(c.total_usd, c.suggested_usd)
            return (
              <article
                key={c.id}
                id={`call-card-${c.id}`}
                className="glass-card interactive"
                tabIndex={0}
                role="button"
                aria-label={`Abrir ficha de recalada ${c.id} ${c.nave}, total confirmado ${formatUSD(c.total_usd)}`}
                onClick={() => onNavigateCall(c.id)}
                onKeyDown={(e) => onRowKey(e, () => onNavigateCall(c.id))}
              >
                <div className="call-card-header">
                  <div>
                    <div className="call-id">{c.id}</div>
                    <h3 className="call-ship">{c.nave}</h3>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {c.cliente} · {c.muelle}
                    </div>
                  </div>
                  <span className="badge badge-confirmado mono">{formatUSD(c.total_usd)}</span>
                </div>

                <div style={{ fontSize: '0.79rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  <div>Carga: {c.tipo_carga}</div>
                  <div className="mono" style={{ marginTop: 2 }}>
                    Ventana: {c.atraque.replace('T', ' ')} → {c.desatraque.replace('T', ' ')}
                  </div>
                </div>

                <div className="call-breakdown">
                  <div>
                    <div className="control-metric-label">Jornal confirmado</div>
                    <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
                      {formatUSD(c.jornal_usd)}
                    </div>
                    <div className="field-hint">
                      {formatQty(c.jornales)} jornales ({c.parts} partes)
                    </div>
                  </div>
                  <div>
                    <div className="control-metric-label">Destajo</div>
                    <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
                      {formatUSD(c.destajo_usd)}
                    </div>
                    <div className="field-hint">{c.piecework_lines} líneas prod.</div>
                  </div>
                </div>

                <div className="suggested-scenario-box">
                  <div className="suggested-scenario-tag">escenario con sugeridos, no confirmado</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      +{formatQty(c.suggested_jornales)} j. sugeridos ({formatUSD(c.suggested_usd)})
                    </span>
                    <strong className="mono"> Hipotético: {formatUSD(scenarioTotal)}</strong>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* Tabla comparativa de Recaladas + REC-SSGG + Pendiente */}
      <section className="glass-card" aria-labelledby="calls-table-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 id="calls-table-heading" style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-display)' }}>
              Cuadro Consolidado por Destino y Estado
            </h2>
            <p className="field-hint" style={{ margin: '2px 0 0' }}>
              Haz clic o presiona Enter en cualquier fila para abrir el detalle de la recalada o de los partes pendientes.
            </p>
          </div>
          <span className="badge badge-unconfirmed">
            Columna sugeridos = escenario con sugeridos, no confirmado
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table" aria-label="Resumen de costos por recalada">
            <thead>
              <tr>
                <th>Destino / Recalada</th>
                <th>Nave / Ámbito</th>
                <th>Muelle</th>
                <th className="right">Jornales conf.</th>
                <th className="right">Jornal (USD)</th>
                <th className="right">Destajo (USD)</th>
                <th className="right">Subtotal Confirmado</th>
                <th className="right">Escenario con sugeridos, no confirmado</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const hyp = addMoney(c.total_usd, c.suggested_usd)
                return (
                  <tr
                    key={c.id}
                    id={`summary-row-${c.id}`}
                    className="clickable-row"
                    tabIndex={0}
                    role="link"
                    onClick={() => onNavigateCall(c.id)}
                    onKeyDown={(e) => onRowKey(e, () => onNavigateCall(c.id))}
                  >
                    <td className="mono" style={{ fontWeight: 600, color: 'var(--accent-teal)' }}>
                      {c.id}
                    </td>
                    <td>
                      <strong>{c.nave}</strong>
                      <div className="field-hint">{c.cliente}</div>
                    </td>
                    <td>{c.muelle}</td>
                    <td className="right mono">
                      {formatQty(c.jornales)} ({c.parts})
                    </td>
                    <td className="right mono">{formatUSD(c.jornal_usd)}</td>
                    <td className="right mono">{formatUSD(c.destajo_usd)}</td>
                    <td className="right mono" style={{ fontWeight: 700 }}>
                      {formatUSD(c.total_usd)}
                    </td>
                    <td className="right mono" style={{ color: 'var(--accent-amber)' }}>
                      +{formatUSD(c.suggested_usd)} ({formatQty(c.suggested_jornales)} j.) → {formatUSD(hyp)}
                    </td>
                  </tr>
                )
              })}

              <tr
                id="summary-row-REC-SSGG"
                className="clickable-row"
                tabIndex={0}
                role="link"
                onClick={() => onNavigateCall('REC-SSGG')}
                onKeyDown={(e) => onRowKey(e, () => onNavigateCall('REC-SSGG'))}
              >
                <td className="mono" style={{ fontWeight: 600, color: 'var(--accent-violet)' }}>
                  REC-SSGG
                </td>
                <td>
                  <strong>Servicios Generales (R8)</strong>
                  <div className="field-hint">Barrido de almacén y apoyo en señalización</div>
                </td>
                <td>Almacén / Vías</td>
                <td className="right mono">
                  {formatQty(ssgg.jornales)} ({ssgg.parts})
                </td>
                <td className="right mono">{formatUSD(ssgg.jornal_usd)}</td>
                <td className="right mono">{formatUSD('0.00')}</td>
                <td className="right mono" style={{ fontWeight: 700 }}>
                  {formatUSD(ssgg.jornal_usd)}
                </td>
                <td className="right mono" style={{ color: 'var(--text-muted)' }}>
                  No aplica
                </td>
              </tr>

              <tr
                id="summary-row-PENDIENTE"
                className="clickable-row"
                tabIndex={0}
                role="link"
                onClick={() => onNavigateParts({ status: 'pendientes' })}
                onKeyDown={(e) => onRowKey(e, () => onNavigateParts({ status: 'pendientes' }))}
              >
                <td className="mono" style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>
                  PENDIENTE
                </td>
                <td>
                  <strong>Por validar ({pending.by_status.sugerido} sugeridos + {pending.by_status.pendiente} sin candidato)</strong>
                  <div className="field-hint">Contabilizado en el control global; pendiente de resolución humana</div>
                </td>
                <td>Por confirmar</td>
                <td className="right mono">
                  {formatQty(pending.jornales)} ({pending.parts})
                </td>
                <td className="right mono">{formatUSD(pending.jornal_usd)}</td>
                <td className="right mono">{formatUSD('0.00')}</td>
                <td className="right mono" style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>
                  {formatUSD(pending.jornal_usd)}
                </td>
                <td className="right mono" style={{ color: 'var(--accent-amber)' }}>
                  En revisión
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsla(210, 48%, 10%, 0.9)', fontWeight: 700 }}>
                <td colSpan={3}>TOTAL CONTROL DEL PERÍODO ({totals.lines} líneas)</td>
                <td className="right mono">{formatQty(totals.jornales)} j.</td>
                <td className="right mono">{formatUSD(totals.jornal_usd)}</td>
                <td className="right mono">{formatUSD(totals.destajo_usd)}</td>
                <td className="right mono" style={{ color: 'var(--accent-teal)' }}>
                  {formatUSD(totals.total_usd)}
                </td>
                <td className="right mono">Control: {formatUSD(control.expected_usd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}
