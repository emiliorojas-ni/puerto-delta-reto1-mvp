import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '../src/api/errors'
import { getCsrfToken, readCookie } from '../src/lib/csrf'

describe('CSRF cookie parsing', () => {
  it('parses csrftoken from cookie header strings', () => {
    const raw = 'sessionid=xyz987; csrftoken=token_abc_123; theme=dark'
    expect(getCsrfToken(raw)).toBe('token_abc_123')
    expect(readCookie(raw, 'sessionid')).toBe('xyz987')
    expect(readCookie(raw, 'missing')).toBeNull()
    expect(getCsrfToken('')).toBeNull()
  })

  it('decodes URL-encoded cookie values safely', () => {
    const raw = 'csrftoken=abc%2B123%3D'
    expect(getCsrfToken(raw)).toBe('abc+123=')
  })
})

describe('API error mapping ({detail, code} + status)', () => {
  it('maps contract {detail, code} payloads to typed ApiError', () => {
    const conflict = toApiError(409, {
      detail: 'La versión enviada no coincide con la versión actual.',
      code: 'version_conflict',
    })
    expect(conflict).toBeInstanceOf(ApiError)
    expect(conflict.status).toBe(409)
    expect(conflict.code).toBe('version_conflict')
    expect(conflict.isConflict).toBe(true)

    const reused = toApiError(409, {
      detail: 'UUID reutilizado con distinto payload.',
      code: 'operation_reused',
    })
    expect(reused.code).toBe('operation_reused')
    expect(reused.isConflict).toBe(true)
  })

  it('detects 403 permission_denied and CSRF failures', () => {
    const forbidden = toApiError(403, { detail: 'No tienes rol validador.', code: 'permission_denied' })
    expect(forbidden.isForbidden).toBe(true)
    expect(forbidden.code).toBe('permission_denied')

    const csrf = toApiError(403, { detail: 'CSRF Failed: CSRF token missing or incorrect.' })
    expect(csrf.isForbidden).toBe(true)
    expect(csrf.code).toBe('csrf_failed')
  })

  it('maps DRF field validation dictionaries on 400', () => {
    const err = toApiError(400, {
      reason: ['Asegúrese de que este campo tenga al menos 5 caracteres.'],
    })
    expect(err.status).toBe(400)
    expect(err.code).toBe('validation')
    expect(err.fields.reason).toEqual(['Asegúrese de que este campo tenga al menos 5 caracteres.'])
    expect(err.detail).toContain('reason:')
  })
})
