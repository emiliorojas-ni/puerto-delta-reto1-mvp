import { useEffect, useState, type FormEvent } from 'react'
import {
  api,
  ApiError,
  simulateVersionConflict,
  type CallId,
  type PartDetail,
} from '../api'
import { DestinationBadge, StatusBadge } from '../components/StatusBadge'
import { formatQty, formatUSD } from '../lib/money'

interface PartDetailViewProps {
  partId: number
  online: boolean
  staleOffline: boolean
  onBack: () => void
  onNavigateCall: (id: CallId) => void
  onReviewed: () => void
}

const PENDING_SELECT_VALUE = '__NULL_PENDING__'

function makeOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function PartDetailView({
  partId,
  online,
  staleOffline,
  onBack,
  onNavigateCall,
  onReviewed,
}: PartDetailViewProps) {
  const [part, setPart] = useState<PartDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Estado del formulario de revisión
  const [destValue, setDestValue] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [reference, setReference] = useState<string>('')
  // Se conserva el mismo operation_id para reintentar exactamente el mismo envío sin duplicar.
  const [operationId, setOperationId] = useState<string>(() => makeOperationId())

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const syncFormWithPart = (p: PartDetail) => {
    const defaultDest = p.destination ?? p.suggested ?? p.allowed_destinations[0] ?? PENDING_SELECT_VALUE
    setDestValue(defaultDest)
  }

  const fetchPart = async (preserveDraft = false) => {
    setLoading(true)
    setLoadError(null)
    try {
      const detail = await api.getPart(partId)
      setPart(detail)
      if (!preserveDraft) {
        syncFormWithPart(detail)
        setReason('')
        setReference('')
        setOperationId(makeOperationId())
      }
      setSubmitError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.detail : 'Error al cargar el detalle del parte.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSubmitSuccess(null)
    void fetchPart(false)
  }, [partId])

  // Cuando cambia el contenido del formulario, se genera un nuevo operation_id (nuevo intento lógico).
  // Si el usuario reintenta enviar sin tocar los campos tras un fallo de red/timeout, conserva el mismo UUID.
  const handleDestChange = (val: string) => {
    setDestValue(val)
    setOperationId(makeOperationId())
    setSubmitError(null)
    setSubmitSuccess(null)
  }

  const handleReasonChange = (val: string) => {
    setReason(val)
    setOperationId(makeOperationId())
    setSubmitError(null)
    setSubmitSuccess(null)
  }

  const handleReferenceChange = (val: string) => {
    setReference(val)
    setOperationId(makeOperationId())
    setSubmitError(null)
    setSubmitSuccess(null)
  }

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!part) return
    if (!online) {
      setSubmitError(new ApiError(0, 'network', 'La validación requiere conexión'))
      return
    }

    const trimmedReason = reason.trim()
    if (trimmedReason.length < 5) {
      setSubmitError(
        new ApiError(400, 'validation', 'El motivo es obligatorio (mínimo 5 caracteres).', {
          reason: ['Ingresa al menos 5 caracteres explicando la evidencia o confirmación.'],
        })
      )
      return
    }

    const destination: CallId | null = destValue === PENDING_SELECT_VALUE ? null : (destValue as CallId)
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)

    try {
      const res = await api.postReview(part.id, {
        destination,
        reason: trimmedReason,
        reference: reference.trim(),
        expected_version: part.version,
        operation_id: operationId,
      })
      setPart(res.part)
      setSubmitSuccess(
        res.replayed
          ? `Operación deduplicada (${res.review.operation_id.slice(0, 8)}…): se recuperó la revisión registrada previamente.`
          : `Revisión v${res.review.version_after} registrada por ${res.review.actor}. El importe del parte (${formatUSD(res.part.amount_usd)}) se mantiene intacto.`
      )
      setReason('')
      setReference('')
      setOperationId(makeOperationId())
      onReviewed()
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err)
      } else {
        setSubmitError(new ApiError(500, 'server_error', 'Error inesperado al enviar la revisión.'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !part) {
    return (
      <section aria-busy="true" aria-label={`Cargando parte #${partId}`}>
        <div className="skeleton" style={{ height: 110, marginBottom: 18 }} />
        <div className="evidence-grid">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="skeleton" style={{ height: 170 }} />
          ))}
        </div>
      </section>
    )
  }

  if (loadError && !part) {
    return (
      <section className="glass-card" role="alert">
        <h1 className="page-title">No se pudo cargar el parte #{partId}</h1>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          {loadError}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button id="part-back-error-btn" type="button" className="btn" onClick={onBack}>
            ← Volver
          </button>
          <button id="part-retry-btn" type="button" className="btn btn-primary" onClick={() => void fetchPart(false)}>
            Reintentar
          </button>
        </div>
      </section>
    )
  }

  if (!part) return null

  const { evidence } = part

  return (
    <div id="part-detail-view">
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <button id="part-back-btn" type="button" className="btn btn-sm" onClick={onBack}>
              ← Volver a partes
            </button>
            <span className="badge badge-neutral mono">{part.ref}</span>
            <span className="badge badge-neutral mono">Versión v{part.version}</span>
            <StatusBadge status={part.status} strength={part.strength} />
            <DestinationBadge destination={part.destination} suggested={part.suggested} status={part.status} />
            {(!online || staleOffline) && (
              <span className="badge badge-unconfirmed">datos de la última conexión, no confirmados</span>
            )}
          </div>
          <h1 className="page-title">
            Parte #{part.id} · {part.tarea}{' '}
            <span style={{ color: 'var(--accent-teal)' }}>({formatUSD(part.amount_usd)})</span>
          </h1>
          <p className="page-subtitle">
            Fecha <strong className="mono">{part.fecha}</strong> · Turno <strong className="mono">{part.turno}</strong> (
            <span className="mono">
              {evidence.shift.start.slice(11)}–{evidence.shift.end.slice(11)}
            </span>
            ) · Cuadrilla <strong className="mono">{part.cuadrilla}</strong> ·{' '}
            <strong>{part.personas}</strong> personas · <strong>{formatQty(part.jornales)}</strong> jornales · Supervisor de origen:{' '}
            <span className="mono">{part.supervisor}</span> (no acredita validación R12)
          </p>
        </div>

        <div className="header-actions">
          {part.destination && (
            <button
              id="part-goto-call-btn"
              type="button"
              className="btn btn-sm"
              onClick={() => onNavigateCall(part.destination!)}
            >
              Ficha {part.destination} →
            </button>
          )}
          <button
            id="part-reload-top-btn"
            type="button"
            className="btn btn-sm"
            onClick={() => void fetchPart(true)}
            disabled={!online}
          >
            Recargar parte
          </button>
        </div>
      </div>

      {/* Bloque Decisión actual y Alertas */}
      <section className="glass-card" style={{ marginBottom: 18 }} aria-labelledby="decision-block-heading">
        <div className="evidence-block-title">
          <span id="decision-block-heading">1. Decisión de Atribución e Importe (Inalterable R4 · R5 · R10)</span>
          <span className="mono" style={{ fontSize: '1.08rem', color: 'var(--text-primary)' }}>
            Importe línea: {formatUSD(part.amount_usd)}
          </span>
        </div>

        <div className="control-grid" style={{ marginTop: 8 }}>
          <div className="control-metric">
            <div className="control-metric-label">Estado actual</div>
            <div style={{ marginTop: 6 }}>
              <StatusBadge status={part.status} strength={part.strength} />
            </div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Destino / Candidato</div>
            <div style={{ marginTop: 6 }}>
              <DestinationBadge destination={part.destination} suggested={part.suggested} status={part.status} />
            </div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Regla aplicada</div>
            <div className="control-metric-value" style={{ fontSize: '0.94rem', color: 'var(--accent-teal)' }}>
              {part.rule}
            </div>
          </div>
          <div className="control-metric">
            <div className="control-metric-label">Candidatos compatibles</div>
            <div className="control-metric-value" style={{ fontSize: '0.92rem' }}>
              {part.candidates.length ? part.candidates.join(', ') : 'Ninguno'}
            </div>
          </div>
        </div>

        <p style={{ margin: '12px 0 0', fontSize: '0.92rem', color: 'var(--text-primary)' }}>
          <strong>Motivo explicado:</strong> {part.reason}
        </p>

        {part.alerts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {part.alerts.map((a) => (
              <div key={a.code} className="alert-banner warning" style={{ marginBottom: 8 }}>
                <div>
                  <strong className="mono">⚠ {a.code}:</strong> {a.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Cuadrícula de 4 Bloques de Evidencia Separados */}
      <div className="evidence-grid">
        {/* Bloque 2: Observación original */}
        <section className="glass-card" aria-labelledby="obs-block-heading">
          <h2 id="obs-block-heading" className="evidence-block-title">
            <span>2. Observación Original (Lo ejecutado · R7)</span>
            <span className="badge badge-neutral mono">Fila #{part.row_number}</span>
          </h2>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'hsla(212, 52%, 7%, 0.75)',
              border: '1px solid var(--border-subtle)',
              marginBottom: 10,
            }}
          >
            <div className="field-hint">Texto crudo en CSV:</div>
            <div className="mono" style={{ fontSize: '0.98rem', fontWeight: 600, marginTop: 2 }}>
              {evidence.observation.raw ? `«${evidence.observation.raw}»` : '— Sin observación (nota vacía) —'}
            </div>
            {evidence.observation.normalized && (
              <div className="field-hint" style={{ marginTop: 4 }}>
                Normalizado: <code className="mono">{evidence.observation.normalized}</code>
              </div>
            )}
          </div>

          <div className="field-hint" style={{ marginBottom: 6 }}>
            Coincidencias detectadas en el texto:
          </div>
          {evidence.observation.matches.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              La observación no menciona alias de nave ni código de muelle inequívoco.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.86rem' }}>
              {evidence.observation.matches.map((m, idx) => (
                <li key={`${m.call}-${m.term}-${idx}`}>
                  Apunta a <strong className="mono">{m.call}</strong> por <strong>{m.by}</strong> (término:{' '}
                  <code className="mono">«{m.term}»</code>)
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Bloque 3: Frente planificado (Nombrada) */}
        <section className="glass-card" aria-labelledby="front-block-heading">
          <h2 id="front-block-heading" className="evidence-block-title">
            <span>3. Frente Planificado (Nombrada diaria)</span>
            <span className="badge badge-neutral">
              {evidence.planned_front.nombrada_refs.length} registros
            </span>
          </h2>
          {evidence.planned_front.frentes.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              Sin frente planificado en la nombrada para la clave ({part.fecha} · {part.turno} · {part.cuadrilla}). La ejecución no requiere que exista nombrada.
            </p>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <span className="field-hint">Frentes convocados: </span>
                <strong>{evidence.planned_front.frentes.join(', ')}</strong>
                {evidence.planned_front.call && (
                  <span style={{ marginLeft: 8 }} className="badge badge-confirmado mono">
                    Sugiere {evidence.planned_front.call}
                  </span>
                )}
              </div>
              <div className="field-hint">
                Referencias agrupadas (6 integrantes de cuadrilla R2):
                <div className="mono" style={{ marginTop: 4, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  {evidence.planned_front.nombrada_refs.join(', ')}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Bloque 4: Destajo del contexto */}
        <section className="glass-card" aria-labelledby="pw-context-heading">
          <h2 id="pw-context-heading" className="evidence-block-title">
            <span>4. Destajo del Contexto ({part.fecha} · {part.turno} · {part.cuadrilla})</span>
            <span className="badge badge-neutral">{evidence.piecework.length} líneas</span>
          </h2>
          {evidence.piecework.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              La cuadrilla {part.cuadrilla} no registra producción a destajo en este turno.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Recalada</th>
                    <th>Concepto</th>
                    <th className="right">Toneladas</th>
                    <th className="right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.piecework.map((w) => (
                    <tr key={w.id}>
                      <td className="mono">{w.ref}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--accent-teal)' }}>
                        {w.call}
                      </td>
                      <td>{w.concepto}</td>
                      <td className="right mono">{formatQty(w.toneladas)} t</td>
                      <td className="right mono">{formatUSD(w.amount_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Bloque 5: Ventanas de atraque */}
        <section className="glass-card" aria-labelledby="windows-block-heading">
          <h2 id="windows-block-heading" className="evidence-block-title">
            <span>5. Ventanas de Atraque (Solape con Turno {part.turno})</span>
            <span className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              480 min (8 h)
            </span>
          </h2>
          <div>
            {evidence.windows.map((w) => {
              const pct = Math.min(100, Math.round((w.overlap_minutes / 480) * 100))
              return (
                <div key={w.call} className="overlap-row">
                  <div className="overlap-header">
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {w.call}{' '}
                      {w.active ? (
                        <span className="badge badge-confirmado" style={{ marginLeft: 4 }}>
                          Activa
                        </span>
                      ) : (
                        <span className="badge badge-neutral" style={{ marginLeft: 4 }}>
                          Sin solape
                        </span>
                      )}
                    </span>
                    <span className="mono" style={{ color: w.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {w.overlap_minutes} / 480 min ({pct}%)
                    </span>
                  </div>
                  <div
                    className="overlap-bar-bg"
                    role="progressbar"
                    aria-valuenow={w.overlap_minutes}
                    aria-valuemin={0}
                    aria-valuemax={480}
                    aria-label={`Solape de ${w.call}: ${w.overlap_minutes} minutos`}
                  >
                    <div className="overlap-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* Bloque 6: Historial de Revisiones */}
      <section className="glass-card" style={{ marginBottom: 20 }} aria-labelledby="reviews-history-heading">
        <h2 id="reviews-history-heading" className="evidence-block-title">
          <span>6. Historial de Revisiones Auditables (R12)</span>
          <span className="badge badge-neutral">{part.reviews.length} registros</span>
        </h2>

        {part.reviews.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Este parte aún no tiene revisiones manuales registradas; conserva la decisión automática inicial (v{part.version}).
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" aria-label="Historial de revisiones del parte">
              <thead>
                <tr>
                  <th>Versión</th>
                  <th>Fecha / Hora</th>
                  <th>Validador</th>
                  <th>Transición de estado</th>
                  <th>Cambio de destino</th>
                  <th>Motivo y Referencia</th>
                  <th>Operation UUID</th>
                </tr>
              </thead>
              <tbody>
                {part.reviews.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">
                      v{r.version_before} → <strong>v{r.version_after}</strong>
                    </td>
                    <td className="mono">{r.created_at.replace('T', ' ')}</td>
                    <td className="mono" style={{ fontWeight: 600, color: 'var(--accent-emerald)' }}>
                      {r.actor}
                    </td>
                    <td>
                      <StatusBadge status={r.from_status} /> → <StatusBadge status={r.to_status} />
                    </td>
                    <td className="mono">
                      {r.from_destination ?? 'PENDIENTE'} → <strong>{r.to_destination ?? 'PENDIENTE'}</strong>
                    </td>
                    <td>
                      <div>{r.reason}</div>
                      {r.reference && <div className="field-hint">Ref: {r.reference}</div>}
                    </td>
                    <td className="mono" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {r.operation_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bloque 7: Formulario de Revisión (solo si can_review) */}
      <section className="glass-card" aria-labelledby="review-form-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <h2 id="review-form-heading" className="evidence-block-title" style={{ marginBottom: 2 }}>
              <span>7. Registrar Resolución del Validador</span>
            </h2>
            <p className="field-hint" style={{ margin: 0 }}>
              La revisión actualiza el destino o marca el parte como pendiente con control optimista de versión (<code>expected_version={part.version}</code>) e idempotencia (<code>operation_id</code>). El importe ({formatUSD(part.amount_usd)}) nunca cambia.
            </p>
          </div>
          {api.mode === 'mock' && part.can_review && (
            <button
              id="simulate-conflict-btn"
              type="button"
              className="btn btn-sm"
              onClick={() => {
                simulateVersionConflict(part.id)
                setSubmitSuccess('Se incrementó la versión en el servidor sintético. Al enviar ahora verás el manejo de 409 version_conflict.')
              }}
              title="Prueba de demostración: simula que otro validador editó el parte antes de tu envío"
            >
              Simular conflicto 409
            </button>
          )}
        </div>

        <div aria-live="assertive" aria-atomic="true">
          {!online && (
            <div className="alert-banner warning" role="alert">
              <span>
                <strong>La validación requiere conexión:</strong> puedes inspeccionar la evidencia en pantalla, pero el envío al servidor está deshabilitado hasta recuperar red.
              </span>
            </div>
          )}

          {submitSuccess && (
            <div className="alert-banner success" role="status">
              <span>{submitSuccess}</span>
            </div>
          )}

          {submitError && submitError.code === 'version_conflict' && (
            <div id="version-conflict-banner" className="alert-banner danger" role="alert">
              <div>
                <strong>Conflicto de versión (409 version_conflict):</strong> {submitError.detail}
              </div>
              <button
                id="conflict-reload-btn"
                type="button"
                className="btn btn-sm btn-amber"
                onClick={() => void fetchPart(true)}
              >
                Recargar parte actualizado
              </button>
            </div>
          )}

          {submitError && submitError.code === 'operation_reused' && (
            <div id="operation-reused-banner" className="alert-banner danger" role="alert">
              <div>
                <strong>Identificador de operación reutilizado (409 operation_reused):</strong> {submitError.detail}
              </div>
              <button
                id="regenerate-uuid-btn"
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setOperationId(makeOperationId())
                  setSubmitError(null)
                }}
              >
                Generar nuevo UUID
              </button>
            </div>
          )}

          {submitError && submitError.isForbidden && (
            <div id="forbidden-banner" className="alert-banner danger" role="alert">
              <div>
                <strong>Acceso denegado (403):</strong> {submitError.detail}
              </div>
            </div>
          )}

          {submitError &&
            submitError.code !== 'version_conflict' &&
            submitError.code !== 'operation_reused' &&
            !submitError.isForbidden && (
              <div className="alert-banner danger" role="alert">
                <span>{submitError.detail}</span>
              </div>
            )}
        </div>

        {!part.can_review ? (
          <div className="alert-banner warning" style={{ marginBottom: 0 }}>
            <span>
              <strong>Modo de solo lectura para tu rol:</strong> solo los usuarios con rol <code>validador</code> están autorizados para registrar resoluciones de partes (R12).
            </span>
          </div>
        ) : (
          <form id="part-review-form" onSubmit={handleReviewSubmit} noValidate>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="review-destination-select" className="form-label">
                  Destino de atribución
                </label>
                <select
                  id="review-destination-select"
                  className="form-select"
                  value={destValue}
                  onChange={(e) => handleDestChange(e.target.value)}
                  disabled={!online || submitting}
                >
                  {part.allowed_destinations.map((d) => (
                    <option key={d} value={d}>
                      Confirmar destino: {d} {d === 'REC-SSGG' ? '(Servicios generales)' : ''}
                    </option>
                  ))}
                  <option value={PENDING_SELECT_VALUE}>Marcar como pendiente (duda)</option>
                </select>
                <span className="field-hint">
                  Elegir un destino cambia el estado a <code>validado</code>. «Marcar como pendiente (duda)» envía{' '}
                  <code>destination: null</code> y deja el parte en <code>pendiente</code>.
                </span>
                {submitError?.fields?.destination && (
                  <span className="field-error">{submitError.fields.destination.join(' ')}</span>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="review-reference-input" className="form-label">
                  Referencia / Respaldo documental (opcional, máx. 200 car.)
                </label>
                <input
                  id="review-reference-input"
                  type="text"
                  maxLength={200}
                  className="form-input"
                  placeholder="Ej. Acta jefe de muelle 2 · WhatsApp 11/06 15:02"
                  value={reference}
                  onChange={(e) => handleReferenceChange(e.target.value)}
                  disabled={!online || submitting}
                />
                <span className="field-hint">
                  Queda registrado en la bitácora auditable junto con tu usuario y marca de tiempo.
                </span>
                {submitError?.fields?.reference && (
                  <span className="field-error">{submitError.fields.reference.join(' ')}</span>
                )}
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="review-reason-textarea" className="form-label">
                Motivo de la resolución (obligatorio, mínimo 5 caracteres)
              </label>
              <textarea
                id="review-reason-textarea"
                className="form-textarea"
                required
                minLength={5}
                placeholder="Explica la evidencia verificada con el área solicitante o el motivo de duda…"
                value={reason}
                onChange={(e) => handleReasonChange(e.target.value)}
                disabled={!online || submitting}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span className="field-hint">
                  Longitud actual: <strong>{reason.trim().length}</strong> caracteres (mínimo 5).
                </span>
                <span className="field-hint mono">
                  expected_version={part.version} · operation_id={operationId}
                </span>
              </div>
              {submitError?.fields?.reason && (
                <span className="field-error">{submitError.fields.reason.join(' ')}</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <span className="field-hint">
                {!online
                  ? 'La validación requiere conexión'
                  : 'Si ocurre un corte de red al enviar, puedes reintentar con el mismo botón sin duplicar el registro.'}
              </span>
              <button
                id="review-submit-btn"
                type="submit"
                className="btn btn-primary"
                disabled={!online || submitting}
              >
                {!online
                  ? 'La validación requiere conexión'
                  : submitting
                    ? 'Registrando revisión…'
                    : destValue === PENDING_SELECT_VALUE
                      ? 'Marcar como pendiente (duda)'
                      : `Validar hacia ${destValue}`}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
