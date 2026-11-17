import { useState, type FormEvent } from 'react'
import { api, ApiError, getApiMode, setApiMode, type Session } from '../api'

interface LoginViewProps {
  onSuccess: (session: Session) => void
  online: boolean
}

const DEMO_ACCOUNTS = [
  {
    username: 'validador',
    password: 'delta-validador-2026',
    envVar: 'DEMO_PASSWORD_VALIDADOR',
    roleLabel: 'Validador (lee + registra revisiones)',
  },
  {
    username: 'operador',
    password: 'delta-operador-2026',
    envVar: 'DEMO_PASSWORD_OPERADOR',
    roleLabel: 'Operador (lee + importa lotes CLI)',
  },
  {
    username: 'consulta',
    password: 'delta-consulta-2026',
    envVar: 'DEMO_PASSWORD_CONSULTA',
    roleLabel: 'Consulta (solo lectura y exportación)',
  },
] as const

export function LoginView({ onSuccess, online }: LoginViewProps) {
  const [username, setUsername] = useState('validador')
  const [password, setPassword] = useState('delta-validador-2026')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'http' | 'mock'>(getApiMode())

  const handleToggleMode = (nextMode: 'http' | 'mock') => {
    setApiMode(nextMode)
    setMode(nextMode)
    setError(null)
  }

  const handleQuickFill = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setUsername(acc.username)
    setPassword(acc.password)
    setError(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!online) {
      setError('Sin conexión: se requiere red para autenticar la sesión.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const session = await api.login(username.trim(), password)
      onSuccess(session)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.isNetwork && mode === 'http') {
          setError(
            'No se pudo conectar con el backend en /api/v1. Verifica que Django esté activo en 127.0.0.1:8000 o activa el Modo Sintético (Mock) abajo.'
          )
        } else {
          setError(err.detail)
        }
      } else {
        setError('Error inesperado al iniciar sesión.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-split">
      {/* ── Left: photo panel ── */}
      <div className="login-photo-panel" aria-hidden="true">
        <img
          src="https://images.unsplash.com/photo-1590496793907-4d66e2994b4d?w=1200&q=85&fit=crop"
          alt="Puerto Delta operaciones portuarias"
        />
        <div className="login-photo-gradient" />
        <div className="login-photo-content">
          <p className="login-eyebrow">Sistema Logístico Integrado · Puerto Delta</p>
          <h1 className="login-headline">
            Control de<br />
            <span>Recaladas</span><br />
            y Costeo Operativo
          </h1>
          <p className="login-description">
            Plataforma de atribución de jornales, destajo y costeo de personal eventual
            por recalada. Conciliación monetaria en tiempo real, auditoría de reglas
            y validación de excepciones con trazabilidad completa.
          </p>
          <div className="login-features">
            <div className="login-feature">
              <span className="login-feature-dot" />
              Atribución determinista R1–R13 con evidencia estructurada por fila
            </div>
            <div className="login-feature">
              <span className="login-feature-dot" />
              Control monetario dual: libro vs recalculado (USD 23.158,24)
            </div>
            <div className="login-feature">
              <span className="login-feature-dot" />
              Revisión auditable con bloqueo de fila, versión optimista e idempotencia
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: form panel ── */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-form-logo">
            <img src="/icons/icon.svg" alt="Logo Puerto Delta" />
            <div>
              <div className="login-form-brand">Puerto Delta</div>
              <div className="login-form-brand-sub">Costeo de Personal Eventual por Recalada</div>
            </div>
          </div>

          <h2 id="login-heading" className="login-heading">Acceso al portal</h2>
          <p className="login-subheading">Ingrese sus credenciales para continuar</p>

          <div aria-live="assertive" aria-atomic="true">
            {error && (
              <div className="alert-banner danger" role="alert">
                <span>{error}</span>
              </div>
            )}
          </div>

          <form id="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="login-username-input" className="form-label">Usuario</label>
              <input
                id="login-username-input"
                name="username"
                type="text"
                autoComplete="username"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="login-password-input" className="form-label">Contraseña</label>
              <input
                id="login-password-input"
                name="password"
                type="password"
                autoComplete="current-password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <span className="field-hint">
                Contraseñas de demo definidas en <code>.env.example</code> (<code>DEMO_PASSWORD_*</code>).
              </span>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 6, minHeight: 44 }}
              disabled={loading || !online}
            >
              {!online ? 'Sin conexión de red' : loading ? 'Verificando credenciales…' : 'Ingresar al sistema'}
            </button>
          </form>

          <hr className="login-divider" />

          <div>
            <div className="form-label" style={{ marginBottom: 8 }}>
              Cuentas de demostración — autocompletar rápido
            </div>
            <div className="demo-accounts-grid" role="group" aria-label="Autocompletar cuenta de demostración">
              {DEMO_ACCOUNTS.map((acc) => {
                const active = username === acc.username
                return (
                  <button
                    key={acc.username}
                    id={`demo-fill-${acc.username}-btn`}
                    type="button"
                    onClick={() => handleQuickFill(acc)}
                    className={`btn btn-sm ${active ? 'btn-amber' : ''}`}
                    title={`${acc.roleLabel} (${acc.envVar})`}
                  >
                    {acc.username}
                  </button>
                )
              })}
            </div>
            <p className="field-hint" style={{ marginTop: 8 }}>
              <strong>validador</strong> puede registrar revisiones · <strong>consulta</strong> y <strong>operador</strong> son de solo lectura.
            </p>
          </div>

          <div
            style={{
              marginTop: 18, paddingTop: 14,
              borderTop: '1px solid var(--b1)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
            }}
          >
            <span className="field-hint">
              Fuente: <strong>{mode === 'mock' ? 'Mock v1' : 'API Django'}</strong>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                id="mode-http-btn"
                type="button"
                className={`btn btn-sm ${mode === 'http' ? 'btn-amber' : ''}`}
                onClick={() => handleToggleMode('http')}
              >
                Backend API
              </button>
              <button
                id="mode-mock-btn"
                type="button"
                className={`btn btn-sm ${mode === 'mock' ? 'btn-amber' : ''}`}
                onClick={() => handleToggleMode('mock')}
              >
                Datos sintéticos
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
