import { beforeEach, describe, expect, it } from 'vitest'
import { MockApi, mockBumpVersion, resetMockState } from '../src/api/mock'
import { addMoney } from '../src/lib/money'

describe('MockApi contract v1 parity & control reconciliation', () => {
  let api: MockApi

  beforeEach(() => {
    resetMockState()
    api = new MockApi(0)
  })

  it('requires authentication and reconciles exact USD 23158.24 control', async () => {
    await expect(api.getSummary()).rejects.toMatchObject({ status: 401, code: 'not_authenticated' })

    const session = await api.login('validador', 'delta-validador-2026')
    expect(session.authenticated).toBe(true)
    expect(session.user?.roles).toContain('validador')

    const summary = await api.getSummary()
    expect(summary.rate_jornal_usd).toBe('81.31')
    expect(summary.totals.lines).toBe(55)
    expect(summary.totals.jornal_lines).toBe(35)
    expect(summary.totals.destajo_lines).toBe(20)
    expect(summary.totals.jornales).toBe('118')
    expect(summary.totals.jornal_usd).toBe('9594.58')
    expect(summary.totals.destajo_usd).toBe('13563.66')
    expect(summary.totals.total_usd).toBe('23158.24')
    expect(summary.ssgg.jornal_usd).toBe('1463.58')
    expect(summary.control.expected_usd).toBe('23158.24')
    expect(summary.control.ledger_usd).toBe('23158.24')
    expect(summary.control.recomputed_usd).toBe('23158.24')
    expect(summary.control.difference_usd).toBe('0.00')
    expect(summary.control.ok).toBe(true)

    // Suma de subtotales de recaladas + REC-SSGG + pendiente = total del período
    const callsTotal = addMoney(...summary.calls.map((c) => c.total_usd))
    const grandTotal = addMoney(callsTotal, summary.ssgg.jornal_usd, summary.pending.jornal_usd)
    expect(grandTotal).toBe('23158.24')
  })

  it('separates confirmed parts from suggested_parts in call detail', async () => {
    await api.login('consulta', 'delta-consulta-2026')
    const rec2051 = await api.getCall('REC-2051')
    expect(rec2051.call.id).toBe('REC-2051')
    expect(rec2051.parts.every((p) => p.status === 'confirmado' || p.status === 'validado')).toBe(true)
    expect(rec2051.suggested_parts.every((p) => p.status === 'sugerido' && p.suggested === 'REC-2051')).toBe(true)

    // El subtotal de jornal de la recalada solo suma los confirmados/validados
    const confirmedSum = addMoney(...rec2051.parts.map((p) => p.amount_usd))
    expect(confirmedSum).toBe(rec2051.totals.jornal_usd)

    // Filtro 'pendientes' devuelve sugeridos + pendientes
    const pendingList = await api.listParts({ status: 'pendientes' })
    expect(pendingList.count).toBe(10)
    expect(pendingList.results.every((p) => p.status === 'sugerido' || p.status === 'pendiente')).toBe(true)
  })

  it('enforces role permissions, version conflict (409), idempotency replay, and operation_reused (409)', async () => {
    // Rol consulta no puede revisar (403)
    await api.login('consulta', 'delta-consulta-2026')
    const detailReadOnly = await api.getPart(7) // fila 8, sugerido REC-2051
    expect(detailReadOnly.can_review).toBe(false)
    await expect(
      api.postReview(7, {
        destination: 'REC-2051',
        reason: 'Intento sin permiso',
        reference: '',
        expected_version: 1,
        operation_id: 'op-forbidden-1',
      })
    ).rejects.toMatchObject({ status: 403, code: 'permission_denied' })

    // Rol validador puede revisar
    await api.login('validador', 'delta-validador-2026')
    const partBefore = await api.getPart(7)
    expect(partBefore.can_review).toBe(true)
    expect(partBefore.status).toBe('sugerido')

    // Validación: motivo corto (<5) devuelve 400
    await expect(
      api.postReview(7, {
        destination: 'REC-2051',
        reason: 'ok',
        reference: '',
        expected_version: partBefore.version,
        operation_id: 'op-short-reason',
      })
    ).rejects.toMatchObject({ status: 400, code: 'validation' })

    // Revisión válida
    const opId = '6f1c0000-1111-4222-8333-444455556666'
    const res1 = await api.postReview(7, {
      destination: 'REC-2051',
      reason: 'Confirmado con jefe de muelle 1',
      reference: 'Acta turno C',
      expected_version: 1,
      operation_id: opId,
    })
    expect(res1.replayed).toBe(false)
    expect(res1.part.status).toBe('validado')
    expect(res1.part.destination).toBe('REC-2051')
    expect(res1.part.version).toBe(2)
    expect(res1.part.amount_usd).toBe(partBefore.amount_usd)

    // Reintento idéntico con el mismo operation_id devuelve replayed: true
    const resReplay = await api.postReview(7, {
      destination: 'REC-2051',
      reason: 'Confirmado con jefe de muelle 1',
      reference: 'Acta turno C',
      expected_version: 1,
      operation_id: opId,
    })
    expect(resReplay.replayed).toBe(true)

    // Mismo operation_id con distinto contenido → 409 operation_reused
    await expect(
      api.postReview(7, {
        destination: 'REC-2052',
        reason: 'Otro destino distinto',
        reference: '',
        expected_version: 2,
        operation_id: opId,
      })
    ).rejects.toMatchObject({ status: 409, code: 'operation_reused' })

    // Conflicto de versión (expected_version obsoleta) → 409 version_conflict
    mockBumpVersion(7)
    await expect(
      api.postReview(7, {
        destination: null,
        reason: 'Volver a pendiente por duda',
        reference: '',
        expected_version: 2,
        operation_id: 'op-stale-version',
      })
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })

    // El control global sigue siendo exactamente USD 23158.24 tras la revisión
    const summaryAfter = await api.getSummary()
    expect(summaryAfter.control.ok).toBe(true)
    expect(summaryAfter.totals.total_usd).toBe('23158.24')
  })
})
