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
    <div className="login-shell">
      <section className="glass-card login-card" aria-labelledby="login-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <img src="/icons/icon.svg" alt="Logo Puerto Delta" className="brand-mark" />
          <div>
            <h1 id="login-heading" className="page-title" style={{ fontSize: '1.38rem' }}>
              Puerto Delta · Control de Recaladas
            </h1>
            <p className="page-subtitle" style={{ margin: 0 }}>
              Costeo de personal eventual (jornal y destajo) y revisión auditable
            </p>
          </div>
        </div>

        <div aria-live="assertive" aria-atomic="true">
          {error && (
            <div className="alert-banner danger" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>

        <form id="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="login-username-input" className="form-label">
              Usuario
            </label>
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
            <label htmlFor="login-password-input" className="form-label">
              Contraseña
            </label>
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
              Las contraseñas de demostración están definidas en <code>.env</code> /{' '}
              <code>.env.example</code> (<code>DEMO_PASSWORD_CONSULTA</code>,{' '}
              <code>DEMO_PASSWORD_OPERADOR</code>, <code>DEMO_PASSWORD_VALIDADOR</code>).
            </span>
          </div>

          <button
            id="login-submit-btn"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 4, padding: '10px 16px' }}
            disabled={loading || !online}
          >
            {!online ? 'Sin conexión' : loading ? 'Verificando credenciales…' : 'Ingresar a la terminal'}
          </button>
        </form>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-subtle)', margin: '20px 0 14px' }} />

        <div>
          <div className="form-label" style={{ marginBottom: 6 }}>
            Cuentas de demostración (autocompletar rápido)
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
          <p className="field-hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Selecciona <strong>validador</strong> para registrar resoluciones de partes sugeridos/pendientes, o{' '}
            <strong>consulta</strong> / <strong>operador</strong> para probar permisos de solo lectura (403 en escritura).
          </p>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span className="field-hint">
            Fuente de datos: <strong>{mode === 'mock' ? 'Adaptador sintético (Mock v1)' : 'API Django (/api/v1)'}</strong>
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
      </section>
    </div>
  )
}
