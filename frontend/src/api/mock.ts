/**
 * Adaptador sintético (VITE_USE_MOCK=1). Datos 100 % sintéticos que respetan el contrato v1
 * y cuadran con el control del período (USD 23.158,24) para desarrollar la UI sin backend.
 * No contiene datos oficiales ni padrón de trabajadores.
 */
import { addMoney, fromCents, subMoney, toCents } from '../lib/money'
import { ApiError } from './errors'
import type {
  Alert,
  Api,
  CallDetail,
  CallId,
  CallSummary,
  Evidence,
  PartDetail,
  PartsList,
  PartsQuery,
  PartStatus,
  PartSummary,
  Piecework,
  Review,
  ReviewRequest,
  ReviewResponse,
  Role,
  Session,
  Strength,
  Summary,
} from './types'

const RATE = '81.31'
const EXPECTED = '23158.24'
const OPERATIVE: CallId[] = ['REC-2051', 'REC-2052', 'REC-2053']
const ALLOWED: CallId[] = [...OPERATIVE, 'REC-SSGG']

interface CallInfo {
  id: CallId
  nave: string
  cliente: string
  tipo_carga: string
  muelle: string
  atraque: string
  desatraque: string
  aliases: string[]
  muelleTerms: string[]
}

const CALLS: CallInfo[] = [
  {
    id: 'REC-2051', nave: 'MN ORION BAY', cliente: 'Cliente Andes Metal',
    tipo_carga: 'Productos de acero (bobinas y planchas)', muelle: 'Muelle 1',
    atraque: '2026-06-10T07:30', desatraque: '2026-06-12T15:10',
    aliases: ['orion bay', 'orio bay', 'orion'], muelleTerms: ['muelle 1', 'm1'],
  },
  {
    id: 'REC-2052', nave: 'MV PACIFIC CONDOR', cliente: 'Cliente Minera Sur',
    tipo_carga: 'Maquinaria y carga general', muelle: 'Muelle 2',
    atraque: '2026-06-10T14:00', desatraque: '2026-06-11T22:30',
    aliases: ['pacific condor', 'condor'], muelleTerms: ['muelle 2', 'm2'],
  },
  {
    id: 'REC-2053', nave: 'MV ALTIPLANO STAR', cliente: 'Cliente Molienda Andina',
    tipo_carga: 'Bolas de acero y granel mineral', muelle: 'Muelle 3',
    atraque: '2026-06-11T05:00', desatraque: '2026-06-12T23:40',
    aliases: ['altiplano star', 'altiplano'], muelleTerms: ['muelle 3', 'm3'],
  },
]

const SHIFTS: Record<string, [string, string]> = { A: ['00:00', '08:00'], B: ['08:00', '16:00'], C: ['16:00', '24:00'] }

// ---------- utilidades de tiempo ----------
function toMinutes(dt: string): number {
  const [d, t] = dt.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  return Date.UTC(y, m - 1, day) / 60000 + hh * 60 + mm
}
function shiftInterval(fecha: string, turno: string): { start: string; end: string } {
  const [s, e] = SHIFTS[turno]
  const start = `${fecha}T${s}`
  if (e === '24:00') {
    const d = new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10) + 1))
    return { start, end: `${d.toISOString().slice(0, 10)}T00:00` }
  }
  return { start, end: `${fecha}T${e}` }
}
function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  return Math.max(0, Math.min(toMinutes(aEnd), toMinutes(bEnd)) - Math.max(toMinutes(aStart), toMinutes(bStart)))
}
function nowLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
function trimQty(v: string): string {
  return v.replace(/\.?0+$/, '') || '0'
}
function sumQty(values: string[]): string {
  return trimQty(values.length ? addMoney(...values) : '0')
}
function jornalAmount(jornales: string): string {
  const jc = toCents(jornales) // jornales × 100
  const raw = jc * toCents(RATE) // × 10^4
  return fromCents((raw + 50n) / 100n)
}

// ---------- partes sintéticos ----------
type Row = [
  row: number, fecha: string, turno: string, cuadrilla: string, tarea: string, personas: number,
  jornales: string, supervisor: string, observacion: string, status: PartStatus,
  destination: CallId | null, suggested: CallId | null, strength: Strength | null,
  rule: string, reason: string, front: string | null, alerts?: Alert[],
]

const SSGG_REASON = 'Tarea tipificada de servicios generales (R8): se asigna a REC-SSGG.'
const ROWS: Row[] = [
  [2, '2026-06-10', 'A', 'CU-05', 'Barrido de almacén', 3, '3', 'SUP-02', 'almacen 2', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
  [3, '2026-06-10', 'A', 'CU-02', 'Atrinque muro', 4, '4', 'SUP-01', 'orion bodega 1', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «orion») y la ventana de REC-2051 solapa el turno.', 'Muelle 1'],
  [4, '2026-06-10', 'B', 'CU-03', 'Desatrinque zona', 4, '4', 'SUP-01', 'M1 orion', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave y el muelle 1; destino único compatible.', 'Muelle 1'],
  [5, '2026-06-10', 'B', 'CU-07', 'Atrinque muro', 4, '4', 'SUP-03', 'condor M2', 'confirmado', 'REC-2052', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «condor») y el muelle 2.', 'Muelle 2'],
  [6, '2026-06-10', 'C', 'CU-04', 'Barrido de bodega', 4, '4', 'SUP-01', 'bodega 3 orion', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «orion»).', 'Muelle 1'],
  [7, '2026-06-10', 'C', 'CU-06', 'Limpieza de muelle', 4, '4', 'SUP-02', 'muelle 1', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 1 y solo REC-2051 opera en ese muelle durante el turno.', 'Muelle 1'],
  [8, '2026-06-10', 'C', 'CU-10', 'Atrinque muro', 6, '6', 'SUP-02', '', 'sugerido', null, 'REC-2051', 'fuerte', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía. Frente planificado Muelle 1 y destajo de la misma cuadrilla en REC-2051; también está activa REC-2052.', 'Muelle 1'],
  [9, '2026-06-10', 'C', 'CU-09', 'Apoyo en señalización', 3, '3', 'SUP-03', 'vías internas', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
  [10, '2026-06-11', 'A', 'CU-02', 'Atrinque muro', 4, '4', 'SUP-01', 'orion', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «orion»).', 'Muelle 1'],
  [11, '2026-06-11', 'A', 'CU-06', 'Desatrinque zona', 6, '6', 'SUP-02', '', 'sugerido', null, 'REC-2051', 'debil', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía y sin destajo de la clave. Solo el frente planificado (Muelle 1) apunta a REC-2051; hay tres recaladas activas.', 'Muelle 1'],
  [12, '2026-06-11', 'A', 'CU-12', 'Barrido de bodega', 4, '4', 'SUP-03', '', 'sugerido', null, 'REC-2051', 'debil', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía y sin destajo de la clave. El frente planificado ayuda a sugerir, sin evidencia suficiente para confirmar.', 'Muelle 1'],
  [13, '2026-06-11', 'A', 'CU-03', 'Desatrinque zona', 2, '4', 'SUP-01', 'Orio bay', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «orio bay»); frente M1 y destajo coherentes.', 'Muelle 1',
    [{ code: 'JORNALES_GT_PERSONAS', message: '4 jornales para 2 personas: se preserva el costo original (USD 325,24) y se pide aclaración (R5).' }]],
  [14, '2026-06-11', 'A', 'CU-08', 'Desatrinque zona', 4, '4', 'SUP-03', 'M2', 'confirmado', 'REC-2052', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 2; REC-2052 es la única recalada en ese muelle.', 'Muelle 2'],
  [15, '2026-06-11', 'A', 'CU-09', 'Atrinque muro', 4, '4', 'SUP-03', '', 'sugerido', null, 'REC-2052', 'debil', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía. Frente planificado Muelle 2, sin destajo de la clave.', 'Muelle 2'],
  [16, '2026-06-11', 'B', 'CU-01', 'Atrinque muro', 4, '4', 'SUP-02', 'M2', 'confirmado', 'REC-2052', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 2; coincide con nombrada y destajo.', 'Muelle 2'],
  [17, '2026-06-11', 'B', 'CU-01', 'Barrido de bodega', 1, '1', 'SUP-02', 'apoyo M3 bod 2', 'confirmado', 'REC-2053', null, null, 'R7_NOTA_MUELLE', 'La observación dice «M3»: prevalece lo ejecutado sobre la nombrada en M2 (R7).', 'Muelle 2',
    [{ code: 'NOTA_CONTRADICE_PLAN', message: 'La nombrada y el destajo de la cuadrilla están en M2; la observación indica M3. Se conservan ambas evidencias.' }]],
  [18, '2026-06-11', 'B', 'CU-01', 'Limpieza de muelle', 1, '1', 'SUP-02', '', 'sugerido', null, 'REC-2052', 'fuerte', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía. Nombrada y destajo de la cuadrilla en M2 sugieren REC-2052; política conservadora: no se confirma sin nota.', 'Muelle 2'],
  [19, '2026-06-11', 'B', 'CU-10', 'Barrido de bodega', 2, '2', 'SUP-03', 'pacific condor', 'confirmado', 'REC-2052', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave PACIFIC CONDOR.', 'Muelle 2'],
  [20, '2026-06-11', 'C', 'CU-08', 'Limpieza de muelle', 2, '2', 'SUP-03', 'muelle 2', 'confirmado', 'REC-2052', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 2; REC-2052 activa hasta 22:30.', 'Muelle 2'],
  [21, '2026-06-11', 'B', 'CU-14', 'Espera operativa', 2, '2', 'SUP-01', '', 'pendiente', null, null, null, 'R13_SIN_CANDIDATO', 'Tres recaladas activas, frente planificado vacío y sin destajo de la clave: no hay candidato único.', null],
  [22, '2026-06-11', 'B', 'CU-11', 'Barrido de almacén', 3, '3', 'SUP-02', '', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
  [23, '2026-06-11', 'C', 'CU-05', 'Apoyo en señalización', 3, '3', 'SUP-03', 'señalización vías internas', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
  [24, '2026-06-11', 'C', 'CU-03', 'Desatrinque zona', 6, '6', 'SUP-01', 'bodega', 'sugerido', null, 'REC-2051', 'debil', 'R12_SUGERIDO_CONTEXTO', 'La nota «bodega» es genérica; el frente planificado sugiere REC-2051 entre tres recaladas activas.', 'Muelle 1'],
  [25, '2026-06-11', 'C', 'CU-14', 'Atrinque muro', 4, '4', 'SUP-01', 'ORION', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave aunque el frente esté vacío y no haya destajo de la clave.', null],
  [26, '2026-06-11', 'C', 'CU-13', 'Atrinque muro', 2, '2', 'SUP-03', 'altiplano', 'confirmado', 'REC-2053', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave (alias «altiplano»).', 'Muelle 3'],
  [27, '2026-06-12', 'A', 'CU-04', 'Desatrinque zona', 4, '4', 'SUP-01', 'orion bay', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave ORION BAY.', 'Muelle 1'],
  [28, '2026-06-12', 'A', 'CU-07', 'Desatrinque zona', 4, '4', 'SUP-03', 'M3', 'confirmado', 'REC-2053', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 3; destajo coherente.', 'Muelle 3'],
  [29, '2026-06-12', 'A', 'CU-10', 'Barrido de bodega', 4, '4', 'SUP-02', '', 'sugerido', null, 'REC-2051', 'fuerte', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía. Frente Muelle 1 y destajo de la cuadrilla en REC-2051.', 'Muelle 1'],
  [30, '2026-06-12', 'B', 'CU-06', 'Limpieza de muelle', 2, '2', 'SUP-02', 'M1 final', 'confirmado', 'REC-2051', null, null, 'R7_NOTA_MUELLE', 'La observación nombra el muelle 1.', 'Muelle 1'],
  [31, '2026-06-12', 'A', 'CU-09', 'Barrido de almacén', 3, '3', 'SUP-03', '', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
  [32, '2026-06-11', 'C', 'CU-15', 'Atrinque muro', 3, '3', 'SUP-03', '', 'sugerido', null, 'REC-2052', 'debil', 'R12_SUGERIDO_CONTEXTO', 'Nota vacía. Frente planificado Muelle 2; REC-2052 desatraca 22:30, dentro del turno.', 'Muelle 2'],
  [33, '2026-06-12', 'B', 'CU-13', 'Limpieza de muelle', 2, '2', 'SUP-03', 'altiplano star', 'confirmado', 'REC-2053', null, null, 'R7_NOTA_NAVE', 'La observación nombra la nave ALTIPLANO STAR.', 'Muelle 3'],
  [34, '2026-06-12', 'B', 'CU-12', 'Espera operativa', 2, '2', 'SUP-01', 'esperando grua M1', 'confirmado', 'REC-2051', null, null, 'R9_ESPERA_CAUSANTE', 'La espera se asigna a la recalada que la causó (R9): grúa en M1.', 'Muelle 1',
    [{ code: 'DESATRAQUE_EN_TURNO', message: 'REC-2051 desatraca 15:10 dentro del turno B; se pagan jornales completos (R3).' }]],
  [35, '2026-06-12', 'C', 'CU-07', 'Limpieza de muelle', 3, '3', 'SUP-03', 'final de nave', 'sugerido', null, 'REC-2053', 'fuerte', 'R12_SUGERIDO_CONTEXTO', '«final de nave» es genérico. REC-2053 es el único solape; coinciden destajo y frente M3. Inferencia fuerte, distinta de nota directa.', 'Muelle 3'],
  [36, '2026-06-12', 'C', 'CU-11', 'Apoyo en señalización', 3, '3', 'SUP-02', '', 'confirmado', 'REC-SSGG', null, null, 'R8_SSGG_TIPIFICADA', SSGG_REASON, 'Almacén'],
]

// ---------- destajo sintético (el último de cada recalada absorbe el resto para cuadrar) ----------
type PwSeed = [call: CallId, fecha: string, turno: string, cuadrilla: string, concepto: string, tarifa: string, personas: number, toneladas: string | null]
const PW_TARGET: Record<string, string> = { 'REC-2051': '6298.75', 'REC-2052': '3327.70', 'REC-2053': '3937.21' }
const PW_SEEDS: PwSeed[] = [
  ['REC-2051', '2026-06-10', 'B', 'CU-03', 'Manipuleo productos metálicos', '1.28', 6, '1000.500'],
  ['REC-2051', '2026-06-10', 'C', 'CU-03', 'Manipuleo productos metálicos', '1.28', 6, '640.250'],
  ['REC-2051', '2026-06-10', 'C', 'CU-03', 'Manipuleo carga general', '1.35', 6, '300.000'],
  ['REC-2051', '2026-06-10', 'C', 'CU-10', 'Manipuleo productos metálicos', '1.28', 6, '520.000'],
  ['REC-2051', '2026-06-11', 'A', 'CU-03', 'Manipuleo productos metálicos', '1.28', 6, '1525.629'],
  ['REC-2051', '2026-06-11', 'A', 'CU-02', 'Manipuleo maquinaria', '1.65', 6, '120.400'],
  ['REC-2051', '2026-06-12', 'A', 'CU-04', 'Manipuleo productos metálicos', '1.28', 6, '310.000'],
  ['REC-2051', '2026-06-12', 'A', 'CU-10', 'Manipuleo productos metálicos', '1.28', 6, '280.000'],
  ['REC-2051', '2026-06-12', 'B', 'CU-06', 'Manipuleo carga general', '1.35', 6, null],
  ['REC-2052', '2026-06-10', 'B', 'CU-07', 'Manipuleo maquinaria', '1.65', 6, '400.000'],
  ['REC-2052', '2026-06-10', 'C', 'CU-07', 'Manipuleo carga general', '1.35', 6, '520.000'],
  ['REC-2052', '2026-06-11', 'A', 'CU-08', 'Manipuleo maquinaria', '1.65', 6, '380.000'],
  ['REC-2052', '2026-06-11', 'B', 'CU-01', 'Manipuleo carga general', '1.35', 6, '560.000'],
  ['REC-2052', '2026-06-11', 'C', 'CU-08', 'Manipuleo maquinaria', '1.65', 6, null],
  ['REC-2053', '2026-06-11', 'B', 'CU-13', 'Manipuleo bolas de acero', '0.94', 6, '900.000'],
  ['REC-2053', '2026-06-11', 'C', 'CU-13', 'Manipuleo granel', '0.62', 6, '1100.000'],
  ['REC-2053', '2026-06-12', 'A', 'CU-07', 'Manipuleo bolas de acero', '0.94', 6, '800.000'],
  ['REC-2053', '2026-06-12', 'A', 'CU-07', 'Manipuleo granel', '0.62', 6, '600.000'],
  ['REC-2053', '2026-06-12', 'B', 'CU-13', 'Manipuleo bolas de acero', '0.94', 6, '700.000'],
  ['REC-2053', '2026-06-12', 'C', 'CU-07', 'Manipuleo granel', '0.62', 6, null],
]

function tonMilli(t: string): bigint {
  const [i, f = ''] = t.split('.')
  return BigInt(i + (f + '000').slice(0, 3))
}
function fmtMilli(m: bigint): string {
  const s = m.toString().padStart(4, '0')
  return `${s.slice(0, -3)}.${s.slice(-3)}`
}
function pieceAmount(milli: bigint, tarifaCents: bigint): bigint {
  // milli (×1000) × centavos → ×1000 centavos; ROUND_HALF_UP a centavos
  return (milli * tarifaCents + 500n) / 1000n
}

const PIECEWORK: Piecework[] = (() => {
  const acc: Record<string, bigint> = {}
  return PW_SEEDS.map((s, i) => {
    const [call, fecha, turno, cuadrilla, concepto, tarifa, personas, ton] = s
    const tc = toCents(tarifa)
    let milli: bigint
    if (ton) milli = tonMilli(ton)
    else {
      const remaining = toCents(PW_TARGET[call]) - (acc[call] ?? 0n)
      milli = (remaining * 1000n + tc / 2n) / tc
    }
    const amount = pieceAmount(milli, tc)
    acc[call] = (acc[call] ?? 0n) + amount
    return {
      id: i + 1, ref: `produccion_destajo.csv:${i + 2}`, call, fecha, turno, cuadrilla, concepto, personas,
      toneladas: fmtMilli(milli), tarifa_usd: tarifa, amount_usd: fromCents(amount),
    }
  })
})()

// ---------- estado mutable ----------
interface MockPart extends PartSummary {
  front: string | null
  reviews: Review[]
}

let nombradaCounter = 2
const nombradaRefs: Record<string, string[]> = {}
function refsFor(key: string): string[] {
  if (!nombradaRefs[key]) {
    nombradaRefs[key] = Array.from({ length: 6 }, () => `nombrada_diaria.csv:${nombradaCounter++}`)
  }
  return nombradaRefs[key]
}

const PARTS: MockPart[] = ROWS.map((r, i) => {
  const [row, fecha, turno, cuadrilla, tarea, personas, jornales, supervisor, observacion, status, destination, suggested, strength, rule, reason, front, alerts = []] = r
  return {
    id: i + 1, ref: `partes_jornal.csv:${row}`, row_number: row, fecha, turno, cuadrilla, tarea, personas, jornales,
    supervisor, observacion, status, destination, suggested, strength, rule, reason, alerts,
    amount_usd: jornalAmount(jornales), version: 1, front, reviews: [],
  }
})
let resultsVersion = 1
let reviewSeq = 1
const operations = new Map<string, { hash: string; partId: number; response: ReviewResponse }>()

// ---------- sesión ----------
const SESSION_KEY = 'pd-mock-session'
const DEMO_USERS: Record<string, Role[]> = { consulta: ['consulta'], operador: ['operador'], validador: ['validador'] }
let memorySession: Session['user'] = null

function getStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

function currentUser(): Session['user'] {
  const store = getStorage()
  if (!store) return memorySession
  try {
    const raw = store.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session['user']) : null
  } catch {
    return memorySession
  }
}

function saveUser(user: Session['user']): void {
  memorySession = user
  const store = getStorage()
  if (!store) return
  try {
    if (user) store.setItem(SESSION_KEY, JSON.stringify(user))
    else store.removeItem(SESSION_KEY)
  } catch {
    // ignore storage errors
  }
}

function delay<T>(value: () => T, ms = 120): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new ApiError(0, 'network', 'Sin conexión con el servidor.')
        }
        resolve(value())
      } catch (e) {
        reject(e)
      }
    }
    if (ms <= 0) run()
    else setTimeout(run, ms)
  })
}
function requireAuth(): NonNullable<Session['user']> {
  const u = currentUser()
  if (!u) throw new ApiError(401, 'not_authenticated', 'Necesitas iniciar sesión.')
  return u
}

// ---------- vistas derivadas ----------
const counts = (p: MockPart) => p.status === 'confirmado' || p.status === 'validado'
const pendingStatus = (p: MockPart) => p.status === 'sugerido' || p.status === 'pendiente'

function toSummary(p: MockPart): PartSummary {
  const { front: _f, reviews: _r, ...rest } = p
  void _f
  void _r
  return { ...rest, alerts: [...rest.alerts] }
}

function callSummary(c: CallInfo): CallSummary {
  const own = PARTS.filter((p) => counts(p) && p.destination === c.id)
  const sug = PARTS.filter((p) => p.status === 'sugerido' && p.suggested === c.id)
  const pw = PIECEWORK.filter((w) => w.call === c.id)
  const jornal = own.length ? addMoney(...own.map((p) => p.amount_usd)) : '0.00'
  const destajo = pw.length ? addMoney(...pw.map((w) => w.amount_usd)) : '0.00'
  return {
    id: c.id, nave: c.nave, cliente: c.cliente, tipo_carga: c.tipo_carga, muelle: c.muelle,
    atraque: c.atraque, desatraque: c.desatraque,
    jornales: sumQty(own.map((p) => p.jornales)), jornal_usd: jornal, destajo_usd: destajo,
    total_usd: addMoney(jornal, destajo),
    suggested_jornales: sumQty(sug.map((p) => p.jornales)),
    suggested_usd: sug.length ? addMoney(...sug.map((p) => p.amount_usd)) : '0.00',
    parts: own.length, piecework_lines: pw.length,
  }
}

function ssggCall(): CallSummary {
  const own = PARTS.filter((p) => counts(p) && p.destination === 'REC-SSGG')
  const jornal = own.length ? addMoney(...own.map((p) => p.amount_usd)) : '0.00'
  return {
    id: 'REC-SSGG', nave: 'Servicios generales', cliente: 'Terminal Puerto Delta',
    tipo_carga: 'Tareas generales (barrido de almacén, señalización)', muelle: 'Almacén y vías internas',
    atraque: '2026-06-10T00:00', desatraque: '2026-06-13T00:00',
    jornales: sumQty(own.map((p) => p.jornales)), jornal_usd: jornal, destajo_usd: '0.00', total_usd: jornal,
    suggested_jornales: '0', suggested_usd: '0.00', parts: own.length, piecework_lines: 0,
  }
}

function buildSummary(): Summary {
  const ssgg = PARTS.filter((p) => counts(p) && p.destination === 'REC-SSGG')
  const pend = PARTS.filter(pendingStatus)
  const jornalTotal = addMoney(...PARTS.map((p) => p.amount_usd))
  const destajoTotal = addMoney(...PIECEWORK.map((w) => w.amount_usd))
  const ledger = addMoney(jornalTotal, destajoTotal)
  // Recalculo independiente desde cantidades de origen (jornales × tarifa, toneladas × tarifa).
  const recomputed = fromCents(
    PARTS.reduce((a, p) => a + toCents(jornalAmount(p.jornales)), 0n) +
      PIECEWORK.reduce((a, w) => a + pieceAmount(tonMilli(w.toneladas), toCents(w.tarifa_usd)), 0n),
  )
  const status_counts: Record<PartStatus, number> = { confirmado: 0, validado: 0, sugerido: 0, pendiente: 0 }
  PARTS.forEach((p) => status_counts[p.status]++)
  return {
    batch: {
      id: 1, sha256: '9f3c2a7d41be08c5e6a1d2f4b7c9e03a5d8f61b2c4e7a90d3f5b8c1e2a4d6f70',
      imported_at: '2026-11-17T10:02', results_version: resultsVersion, source_rows: 343,
    },
    rate_jornal_usd: RATE,
    calls: CALLS.map(callSummary),
    ssgg: { jornales: sumQty(ssgg.map((p) => p.jornales)), jornal_usd: addMoney(...ssgg.map((p) => p.amount_usd), '0'), parts: ssgg.length },
    pending: {
      jornales: sumQty(pend.map((p) => p.jornales)),
      jornal_usd: addMoney('0', ...pend.map((p) => p.amount_usd)),
      parts: pend.length,
      by_status: { sugerido: status_counts.sugerido, pendiente: status_counts.pendiente },
    },
    totals: {
      jornal_usd: jornalTotal, destajo_usd: destajoTotal, total_usd: ledger,
      lines: PARTS.length + PIECEWORK.length, jornal_lines: PARTS.length, destajo_lines: PIECEWORK.length,
      jornales: sumQty(PARTS.map((p) => p.jornales)),
    },
    control: {
      expected_usd: EXPECTED, ledger_usd: ledger, recomputed_usd: recomputed,
      difference_usd: subMoney(ledger, EXPECTED), ok: ledger === EXPECTED && recomputed === EXPECTED, discrepancies: [],
    },
    status_counts,
  }
}

function evidenceFor(p: MockPart): Evidence {
  const shift = shiftInterval(p.fecha, p.turno)
  const normalized = normalize(p.observacion)
  const matches: Evidence['observation']['matches'] = []
  for (const c of CALLS) {
    const alias = c.aliases.find((a) => normalized.includes(a))
    if (alias) matches.push({ call: c.id, by: 'alias', term: alias })
    const mt = c.muelleTerms.find((t) => new RegExp(`(^|\\W)${t}(\\W|$)`).test(normalized))
    if (mt) matches.push({ call: c.id, by: 'muelle', term: mt })
  }
  const frontCall = CALLS.find((c) => c.muelle === p.front)?.id ?? (p.front === 'Almacén' ? 'REC-SSGG' : null)
  const key = `${p.fecha}|${p.turno}|${p.cuadrilla}`
  return {
    shift,
    observation: { raw: p.observacion, normalized, matches },
    planned_front: { frentes: p.front ? [p.front] : [], call: frontCall, nombrada_refs: p.front ? refsFor(key) : [] },
    piecework: PIECEWORK.filter((w) => w.fecha === p.fecha && w.turno === p.turno && w.cuadrilla === p.cuadrilla),
    windows: CALLS.map((c) => {
      const m = overlap(shift.start, shift.end, c.atraque, c.desatraque)
      return { call: c.id, overlap_minutes: m, active: m > 0 }
    }),
  }
}

function detailFor(p: MockPart, user: NonNullable<Session['user']>): PartDetail {
  const evidence = evidenceFor(p)
  const candidates: CallId[] =
    p.destination === 'REC-SSGG' ? ['REC-SSGG'] : evidence.windows.filter((w) => w.active).map((w) => w.call)
  return {
    ...toSummary(p), evidence, candidates, allowed_destinations: [...ALLOWED],
    reviews: p.reviews.map((r) => ({ ...r })), can_review: user.roles.includes('validador'),
  }
}

function toCsv(): string {
  const head = ['ref', 'modalidad', 'fecha', 'turno', 'cuadrilla', 'tarea_o_concepto', 'cantidad', 'unidad', 'tarifa_usd', 'importe_usd', 'destino', 'estado', 'candidato_sugerido', 'fuerza', 'regla', 'motivo', 'alertas', 'validado_por', 'validado_en', 'lote', 'version_resultados']
  const esc = (v: string) => {
    const s = /^[=+\-@]/.test(v) ? `'${v}` : v
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = PARTS.map((p) => {
    const last = p.reviews[p.reviews.length - 1]
    return [p.ref, 'jornal', p.fecha, p.turno, p.cuadrilla, p.tarea, p.jornales, 'jornal', RATE, p.amount_usd, p.destination ?? 'PENDIENTE', p.status, p.suggested ?? '', p.strength ?? '', p.rule, p.reason, p.alerts.map((a) => a.code).join('|'), last?.actor ?? '', last?.created_at ?? '', '1', String(resultsVersion)]
  }).concat(PIECEWORK.map((w) => [w.ref, 'destajo', w.fecha, w.turno, w.cuadrilla, w.concepto, w.toneladas, 't', w.tarifa_usd, w.amount_usd, w.call, 'confirmado', '', '', 'DESTAJO_DESTINO_DIRECTO', 'La producción registra su recalada.', '', '', '', '1', String(resultsVersion)]))
  return [head, ...lines].map((l) => l.map(esc).join(',')).join('\n')
}

// ---------- API sintética ----------
export class MockApi implements Api {
  readonly mode = 'mock' as const
  private readonly latencyMs: number

  constructor(latencyMs = 120) {
    this.latencyMs = latencyMs
  }

  getSession() {
    return delay(() => {
      const user = currentUser()
      return { authenticated: !!user, user }
    }, this.latencyMs)
  }

  login(username: string, password: string) {
    return delay(() => {
      const roles = DEMO_USERS[username.trim().toLowerCase()]
      if (!roles || !password) throw new ApiError(400, 'invalid_credentials', 'Usuario o contraseña inválidos.')
      const user = { username: username.trim().toLowerCase(), roles }
      saveUser(user)
      return { authenticated: true, user }
    }, this.latencyMs)
  }

  logout() {
    return delay(() => {
      saveUser(null)
      return { authenticated: false, user: null }
    }, this.latencyMs)
  }

  getSummary() {
    return delay(() => {
      requireAuth()
      return buildSummary()
    }, this.latencyMs)
  }

  getCall(id: CallId) {
    return delay((): CallDetail => {
      requireAuth()
      const info = CALLS.find((c) => c.id === id)
      const call = id === 'REC-SSGG' ? ssggCall() : info ? callSummary(info) : null
      if (!call) throw new ApiError(404, 'not_found', `La recalada ${id} no existe en el lote.`)
      return {
        call,
        parts: PARTS.filter((p) => counts(p) && p.destination === id).map(toSummary),
        suggested_parts: PARTS.filter((p) => p.status === 'sugerido' && p.suggested === id).map(toSummary),
        piecework: PIECEWORK.filter((w) => w.call === id),
        totals: { jornal_usd: call.jornal_usd, destajo_usd: call.destajo_usd, total_usd: call.total_usd },
      }
    }, this.latencyMs)
  }

  listParts(query: PartsQuery = {}) {
    return delay((): PartsList => {
      requireAuth()
      let list = PARTS
      if (query.status === 'pendientes') list = list.filter(pendingStatus)
      else if (query.status) list = list.filter((p) => p.status === query.status)
      if (query.call) list = list.filter((p) => p.destination === query.call || p.suggested === query.call)
      return { results: list.map(toSummary), count: list.length }
    }, this.latencyMs)
  }

  getPart(id: number) {
    return delay(() => {
      const user = requireAuth()
      const p = PARTS.find((x) => x.id === id)
      if (!p) throw new ApiError(404, 'not_found', `El parte ${id} no existe.`)
      return detailFor(p, user)
    }, this.latencyMs)
  }

  postReview(id: number, body: ReviewRequest) {
    return delay((): ReviewResponse => {
      const user = requireAuth()
      if (!user.roles.includes('validador')) {
        throw new ApiError(403, 'permission_denied', 'Solo el rol validador puede registrar revisiones.')
      }
      const p = PARTS.find((x) => x.id === id)
      if (!p) throw new ApiError(404, 'not_found', `El parte ${id} no existe.`)
      const hash = JSON.stringify([id, body.destination, body.reason, body.reference, body.expected_version])
      const prev = operations.get(body.operation_id)
      if (prev) {
        if (prev.hash !== hash) {
          throw new ApiError(409, 'operation_reused', 'El identificador de operación ya se usó con otro contenido.')
        }
        return { ...prev.response, part: detailFor(PARTS.find((x) => x.id === prev.partId)!, user), replayed: true }
      }
      const fields: Record<string, string[]> = {}
      if (!body.reason || body.reason.trim().length < 5) fields.reason = ['El motivo es obligatorio (mínimo 5 caracteres).']
      if ((body.reference ?? '').length > 200) fields.reference = ['La referencia admite hasta 200 caracteres.']
      if (body.destination !== null && !ALLOWED.includes(body.destination)) fields.destination = ['Destino no válido.']
      if (Object.keys(fields).length) {
        throw new ApiError(400, 'validation', Object.values(fields).flat().join(' '), fields)
      }
      if (body.expected_version !== p.version) {
        throw new ApiError(409, 'version_conflict', `El parte cambió (versión actual ${p.version}). Recarga antes de revisar.`)
      }
      const review: Review = {
        id: reviewSeq++, operation_id: body.operation_id, actor: user.username, created_at: nowLocal(),
        from_status: p.status, to_status: body.destination ? 'validado' : 'pendiente',
        from_destination: p.destination, to_destination: body.destination,
        reason: body.reason.trim(), reference: (body.reference ?? '').trim(),
        version_before: p.version, version_after: p.version + 1,
      }
      p.status = review.to_status
      p.destination = body.destination
      if (body.destination) {
        p.rule = 'REVISION_VALIDADOR'
        p.reason = `Validado por ${user.username}: ${review.reason}`
      } else {
        p.rule = 'REVISION_DUDA'
        p.reason = `Marcado como pendiente por ${user.username}: ${review.reason}`
      }
      p.version += 1
      p.reviews.push(review)
      resultsVersion += 1
      const response: ReviewResponse = { part: detailFor(p, user), review, replayed: false }
      operations.set(body.operation_id, { hash, partId: id, response })
      return response
    }, this.latencyMs)
  }

  exportUrl(kind: 'csv' | 'xlsx') {
    return `/api/v1/exports/${kind}`
  }
}

export function mockCsvDataUrl(): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + toCsv())}`
}

/** Utilidad de demo: simula que otra persona revisó el parte (provoca 409 version_conflict). */
export function mockBumpVersion(id: number): void {
  const p = PARTS.find((x) => x.id === id)
  if (p) p.version += 1
}

/** Reinicia estado mutable para pruebas unitarias. */
export function resetMockState(): void {
  saveUser(null)
  operations.clear()
  resultsVersion = 1
  reviewSeq = 1
  ROWS.forEach((r, i) => {
    const [row, fecha, turno, cuadrilla, tarea, personas, jornales, supervisor, observacion, status, destination, suggested, strength, rule, reason, front, alerts = []] = r
    PARTS[i] = {
      id: i + 1, ref: `partes_jornal.csv:${row}`, row_number: row, fecha, turno, cuadrilla, tarea, personas, jornales,
      supervisor, observacion, status, destination, suggested, strength, rule, reason, alerts,
      amount_usd: jornalAmount(jornales), version: 1, front, reviews: [],
    }
  })
}
