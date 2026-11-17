import type { CallId, PartStatus, Strength } from '../api'

const STATUS_LABELS: Record<PartStatus, string> = {
  confirmado: 'Confirmado',
  validado: 'Validado',
  sugerido: 'Sugerido',
  pendiente: 'Pendiente',
}

export function StatusBadge({ status, strength }: { status: PartStatus; strength?: Strength | null }) {
  return (
    <span className={`badge badge-${status}`}>
      <span>{STATUS_LABELS[status] ?? status}</span>
      {status === 'sugerido' && strength && (
        <span style={{ opacity: 0.85 }}>({strength === 'fuerte' ? 'fuerte' : 'débil'})</span>
      )}
    </span>
  )
}

export function DestinationBadge({
  destination,
  suggested,
  status,
}: {
  destination: CallId | null
  suggested?: CallId | null
  status: PartStatus
}) {
  if (destination) {
    const isSsgg = destination === 'REC-SSGG'
    return <span className={`badge mono ${isSsgg ? 'badge-ssgg' : 'badge-confirmado'}`}>{destination}</span>
  }
  if (status === 'sugerido' && suggested) {
    return (
      <span className="badge badge-sugerido mono" title="Candidato sugerido por contexto (no suma al subtotal confirmado)">
        Sugerido: {suggested}
      </span>
    )
  }
  return <span className="badge badge-pendiente">Sin destino (Pendiente)</span>
}
