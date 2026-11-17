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
        <div className="view-hero" style={{ background: 'var(--brand-deep)' }}>
          <div className="view-hero-gradient" />
          <div className="view-hero-content">
            <div>
              <div className="view-hero-eyebrow">Sistema Logístico Integrado</div>
              <h1 className="view-hero-title">Tablero de Costeo por Recalada</h1>
              <p className="view-hero-sub">Cargando resumen del lote y conciliación monetaria…</p>
            </div>
          </div>
        </div>
        <div className="page-content">
          <div className="kpi-grid">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="skeleton" style={{ height: 118, borderRadius: 0 }} />
            ))}
          </div>
          <div className="skeleton" style={{ height: 150, margin: '20px 0' }} />
          <div className="calls-grid">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton" style={{ height: 240 }} />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (error && !summary) {
    return (
      <section role="alert">
        <div className="view-hero" style={{ background: 'var(--brand-deep)' }}>
          <div className="view-hero-gradient" />
          <div className="view-hero-content">
            <div>
              <div className="view-hero-eyebrow">Error del sistema</div>
              <h1 className="view-hero-title">No se pudo cargar el tablero</h1>
            </div>
          </div>
        </div>
        <div className="page-content">
          <div className="glass-card">
            <p style={{ marginBottom: 16, color: 'var(--t2)' }}>{error}</p>
            <button id="dashboard-retry-btn" type="button" className="btn btn-primary" onClick={onRefresh}>
              Reintentar carga
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!summary) {
    return (
      <div>
        <div className="view-hero" style={{ background: 'var(--brand-deep)' }}>
          <div className="view-hero-gradient" />
          <div className="view-hero-content">
            <div>
              <div className="view-hero-eyebrow">Sistema Logístico Integrado</div>
              <h1 className="view-hero-title">Sin lote activo</h1>
            </div>
          </div>
        </div>
        <div className="page-content">
          <div className="glass-card">
            <p style={{ color: 'var(--t2)' }}>No se encontraron datos importados para el período.</p>
          </div>
        </div>
      </div>
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
      color: idx === 0 ? 'var(--brand-steel)' : idx === 1 ? 'var(--action)' : 'var(--accent-sky)',
    })),
    {
      id: 'REC-SSGG',
      label: 'REC-SSGG (Servicios generales)',
      amount: ssgg.jornal_usd,
      pct: Math.max(0, ratio(ssgg.jornal_usd, totals.total_usd) * 100),
      color: 'var(--accent-violet)',
    },
    {
      id: 'PENDIENTE',
      label: 'Pendiente / Sugerido (sin confirmar)',
      amount: pending.jornal_usd,
      pct: Math.max(0, ratio(pending.jornal_usd, totals.total_usd) * 100),
      color: 'var(--industrial-yellow)',
    },
  ]

  const onRowKey = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  const CALL_PHOTOS = [
    'https://images.unsplash.com/photo-1596422572215-801e9c6beeaf?w=640&q=80&fit=crop',
    'https://images.unsplash.com/photo-1597334948330-38795f25d05d?w=640&q=80&fit=crop',
    'https://images.unsplash.com/photo-1595263026408-d502567353ee?w=640&q=80&fit=crop',
  ]

  return (
    <div id="dashboard-view">
      <div className="view-hero">
        <img
          className="view-hero-img"
          src="https://images.unsplash.com/photo-1590497008432-598f04441de8?w=1400&q=80&fit=crop"
          alt="Operaciones portuarias Puerto Delta"
        />
        <div className="view-hero-gradient" />
        <div className="view-hero-content">
          <div>
            <div className="view-hero-eyebrow">
              Sistema Logístico Integrado · Lote #{batch.id} · v{batch.results_version}
              {(!online || staleOffline) && (
                <span className="badge badge-unconfirmed">datos de la última conexión</span>
              )}
            </div>
            <h1 className="view-hero-title">Tablero de Costeo por Recalada</h1>
            <p className="view-hero-sub">
              SHA-256 <span className="mono">{shaShort}…</span>
              {' · '}{batch.source_rows} filas fuente
              {' · '}Tarifa jornal {formatUSD(rate_jornal_usd)}
            </p>
          </div>
          <div className="view-hero-actions">
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
      </div>
      <div className="page-content">

      {error && (
        <div className="alert-banner warning" role="alert">
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <section aria-label="Indicadores clave del período" style={{ marginBottom: 24 }}>
        <div className="section-header">
          <div className="section-header-left">
            <div className="section-title">Indicadores del Período</div>
            <div className="section-sub">10 – 12 de junio de 2026 · {totals.lines} líneas de costo · {totals.jornal_lines} partes de jornal</div>
          </div>
        </div>
        <div className="kpi-grid">
        <article className="kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-teal)' }}>
          <span className="kpi-label">Total Período</span>
          <span className="kpi-value">{formatUSD(totals.total_usd)}</span>
          <div className="kpi-meta">
            <span>{totals.lines} líneas de costo</span>
            <span className="mono">
              {totals.jornal_lines}J + {totals.destajo_lines}D
            </span>
          </div>
        </article>

        <article className="kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-sky)' }}>
          <span className="kpi-label">Jornal Total</span>
          <span className="kpi-value">{formatUSD(totals.jornal_usd)}</span>
          <div className="kpi-meta">
            <span>{formatQty(totals.jornales)} jornales</span>
            <span>{totals.jornal_lines} partes</span>
          </div>
        </article>

        <article className="kpi-card" style={{ ['--kpi-accent' as string]: 'var(--accent-emerald)' }}>
          <span className="kpi-label">Destajo Total</span>
          <span className="kpi-value">{formatUSD(totals.destajo_usd)}</span>
          <div className="kpi-meta">
            <span>{totals.destajo_lines} producciones</span>
            <span>Destino directo</span>
          </div>
        </article>

        <article
          id="kpi-ssgg-card"
          className="kpi-card interactive"
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
          className="kpi-card interactive"
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
        </div>
      </section>

      {/* Control Monetario y Barra Apilada */}
      <section
        className={`glass-card control-panel ${control.ok ? '' : 'control-alert'}`}
        aria-labelledby="control-heading"
      >
        <div className="section-header" style={{ padding: 0, marginBottom: 10, borderBottom: 'none' }}>
          <div className="section-header-left">
            <div id="control-heading" className="section-title">Control Monetario del Período (R10 · R11)</div>
            <div className="section-sub">Sugeridos y pendientes se contabilizan en el control global sin inflar los subtotales confirmados por recalada</div>
          </div>
          <div className="section-actions">
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
        <div className="section-header">
          <div className="section-header-left">
            <div id="calls-cards-heading" className="section-title">Recaladas Operativas del Lote</div>
            <div className="section-sub">Haz clic en una recalada para ver el detalle de partes, destajo y ventana de operación</div>
          </div>
          <div className="section-actions">
            <button
              id="dashboard-all-parts-btn"
              type="button"
              className="btn btn-sm"
              onClick={() => onNavigateParts({})}
            >
              Explorar los {totals.jornal_lines} partes de jornal →
            </button>
          </div>
        </div>

        <div className="calls-grid">
          {calls.map((c, idx) => {
            const scenarioTotal = addMoney(c.total_usd, c.suggested_usd)
            return (
              <article
                key={c.id}
                id={`call-card-${c.id}`}
                className="call-card"
                tabIndex={0}
                role="button"
                aria-label={`Abrir ficha de recalada ${c.id} ${c.nave}, total confirmado ${formatUSD(c.total_usd)}`}
                onClick={() => onNavigateCall(c.id)}
                onKeyDown={(e) => onRowKey(e, () => onNavigateCall(c.id))}
              >
                <div className="call-card-banner">
                  <img src={CALL_PHOTOS[idx % CALL_PHOTOS.length]} alt={`Puerto Delta ${c.id}`} loading="lazy" />
                  <div className="call-card-banner-overlay">
                    <div>
                      <div className="call-card-id">{c.id}</div>
                      <div className="call-card-ship">{c.nave}</div>
                      <div className="call-card-meta">{c.muelle} · {c.tipo_carga}</div>
                    </div>
                    <span className="badge badge-confirmado mono">{formatUSD(c.total_usd)}</span>
                  </div>
                </div>
                <div className="call-card-body">
                <div className="call-breakdown">
                    <div className="call-stat">
                      <div className="call-stat-label">Jornal conf.</div>
                      <div className="call-stat-value mono">{formatUSD(c.jornal_usd)}</div>
                      <div className="field-hint">{formatQty(c.jornales)} j. · {c.parts} partes</div>
                    </div>
                    <div className="call-stat">
                      <div className="call-stat-label">Destajo</div>
                      <div className="call-stat-value mono">{formatUSD(c.destajo_usd)}</div>
                      <div className="field-hint">{c.piecework_lines} prod.</div>
                    </div>
                  </div>
                  <div className="suggested-scenario-box">
                    <div className="suggested-scenario-tag">Escenario con sugeridos · no confirmado</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>+{formatQty(c.suggested_jornales)} j. ({formatUSD(c.suggested_usd)})</span>
                      <strong className="mono">{formatUSD(scenarioTotal)}</strong>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* Tabla comparativa de Recaladas + REC-SSGG + Pendiente */}
      <section className="glass-card" aria-labelledby="calls-table-heading" style={{ marginBottom: 0 }}>
        <div className="section-header" style={{ padding: 0, marginBottom: 14, borderBottom: 'none' }}>
          <div className="section-header-left">
            <div id="calls-table-heading" className="section-title">Cuadro Consolidado por Destino y Estado</div>
            <div className="section-sub">Haz clic o presiona Enter en cualquier fila para abrir el detalle</div>
          </div>
          <div className="section-actions">
            <span className="badge badge-unconfirmed">sugeridos = escenario no confirmado</span>
          </div>
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
              <tr style={{ background: 'var(--brand-steel-soft)', fontWeight: 700 }}>
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
    </div>
  )
}
