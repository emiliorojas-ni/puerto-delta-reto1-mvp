export interface ConnectivityBannerProps {
  online: boolean
  hasCachedData: boolean
  lastSyncedAt: string | null
}

export function ConnectivityBanner({ online, hasCachedData, lastSyncedAt }: ConnectivityBannerProps) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {!online && (
        <div className="connectivity-banner offline" role="status">
          <div>
            <strong>Modo sin conexión:</strong> La validación requiere conexión con el servidor.
            {hasCachedData && (
              <span>
                {' '}
                · Vista actual marcada como <strong>datos de la última conexión, no confirmados</strong>
                {lastSyncedAt ? ` (${lastSyncedAt})` : ''}.
              </span>
            )}
          </div>
          <span className="badge badge-unconfirmed">datos de la última conexión, no confirmados</span>
        </div>
      )}
    </div>
  )
}
