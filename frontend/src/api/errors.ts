/** Error tipado de la API: `{detail, code}` + status HTTP (0 = sin red). */
export type ApiErrorCode =
  | 'version_conflict'
  | 'operation_reused'
  | 'not_authenticated'
  | 'permission_denied'
  | 'csrf_failed'
  | 'not_found'
  | 'validation'
  | 'invalid_credentials'
  | 'network'
  | 'server_error'
  | (string & {})

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly detail: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: ApiErrorCode, detail: string, fields: Record<string, string[]> = {}) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.fields = fields
  }

  get isConflict(): boolean {
    return this.status === 409
  }
  get isForbidden(): boolean {
    return this.status === 403
  }
  get isUnauthenticated(): boolean {
    return this.status === 401
  }
  get isNetwork(): boolean {
    return this.status === 0
  }
}

const DEFAULT_CODES: Record<number, ApiErrorCode> = {
  400: 'validation',
  401: 'not_authenticated',
  403: 'permission_denied',
  404: 'not_found',
  409: 'version_conflict',
}

const DEFAULT_DETAIL: Record<number, string> = {
  0: 'Sin conexión con el servidor.',
  400: 'Los datos enviados no son válidos.',
  401: 'Tu sesión expiró. Ingresa nuevamente.',
  403: 'Acceso denegado para tu rol.',
  404: 'No encontrado.',
  409: 'Conflicto: el registro cambió en el servidor.',
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string') return [v]
  return []
}

/**
 * Mapea una respuesta de error a ApiError. Acepta el formato del contrato `{detail, code}`
 * y, por robustez, el formato de validación por campo de DRF `{campo: ["msg"]}`.
 */
export function toApiError(status: number, body: unknown): ApiError {
  const fallbackCode = DEFAULT_CODES[status] ?? (status >= 500 ? 'server_error' : 'error')
  const fallbackDetail = DEFAULT_DETAIL[status] ?? `Error del servidor (${status}).`

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>
    const fields: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'detail' || k === 'code') continue
      const list = asStringList(v)
      if (list.length) fields[k] = list
    }
    const detail =
      typeof obj.detail === 'string' && obj.detail.trim()
        ? obj.detail
        : Object.keys(fields).length
          ? Object.entries(fields)
              .map(([k, v]) => (k === 'non_field_errors' ? v.join(' ') : `${k}: ${v.join(' ')}`))
              .join(' · ')
          : fallbackDetail
    let code: ApiErrorCode = typeof obj.code === 'string' && obj.code ? obj.code : fallbackCode
    // Django devuelve 403 con texto "CSRF Failed" cuando falta/vence el token.
    if (status === 403 && /csrf/i.test(detail) && code === 'permission_denied') code = 'csrf_failed'
    return new ApiError(status, code, detail, fields)
  }
  return new ApiError(status, fallbackCode, fallbackDetail)
}
