/**
 * Tipos del contrato API v1 (docs/contrato-api.md). Dinero y cantidades como texto decimal.
 */

export type Money = string
export type DecimalStr = string
/** `YYYY-MM-DD` */
export type DateStr = string
/** `YYYY-MM-DDTHH:MM` hora local de la terminal, sin zona. */
export type LocalDateTime = string

export type CallId = 'REC-2051' | 'REC-2052' | 'REC-2053' | 'REC-SSGG' | (string & {})
export type PartStatus = 'confirmado' | 'validado' | 'sugerido' | 'pendiente'
export type PartStatusFilter = PartStatus | 'pendientes'
export type Strength = 'fuerte' | 'debil'
export type Role = 'consulta' | 'operador' | 'validador'

export interface SessionUser {
  username: string
  roles: Role[]
}

export interface Session {
  authenticated: boolean
  user: SessionUser | null
}

export interface Batch {
  id: number
  sha256: string
  imported_at: LocalDateTime
  results_version: number
  source_rows: number
}

export interface CallSummary {
  id: CallId
  nave: string
  cliente: string
  tipo_carga: string
  muelle: string
  atraque: LocalDateTime
  desatraque: LocalDateTime
  jornales: DecimalStr
  jornal_usd: Money
  destajo_usd: Money
  total_usd: Money
  suggested_jornales: DecimalStr
  suggested_usd: Money
  parts: number
  piecework_lines: number
}

export interface SsggSummary {
  jornales: DecimalStr
  jornal_usd: Money
  parts: number
}

export interface PendingSummary {
  jornales: DecimalStr
  jornal_usd: Money
  parts: number
  by_status: { sugerido: number; pendiente: number }
}

export interface Totals {
  jornal_usd: Money
  destajo_usd: Money
  total_usd: Money
  lines: number
  jornal_lines: number
  destajo_lines: number
  jornales: DecimalStr
}

export type DiscrepancyKind = 'missing' | 'duplicated' | 'amount'

export interface Discrepancy {
  ref: string
  kind: DiscrepancyKind
  ledger_usd: Money
  recomputed_usd: Money
}

export interface Control {
  expected_usd: Money
  ledger_usd: Money
  recomputed_usd: Money
  difference_usd: Money
  ok: boolean
  discrepancies: Discrepancy[]
}

export interface Summary {
  batch: Batch
  rate_jornal_usd: Money
  calls: CallSummary[]
  ssgg: SsggSummary
  pending: PendingSummary
  totals: Totals
  control: Control
  status_counts: Record<PartStatus, number>
}

export interface Alert {
  code: string
  message: string
}

export interface PartSummary {
  id: number
  ref: string
  row_number: number
  fecha: DateStr
  turno: string
  cuadrilla: string
  tarea: string
  personas: number
  jornales: DecimalStr
  supervisor: string
  observacion: string
  status: PartStatus
  destination: CallId | null
  suggested: CallId | null
  strength: Strength | null
  rule: string
  reason: string
  alerts: Alert[]
  amount_usd: Money
  version: number
}

export interface Piecework {
  id: number
  ref: string
  call: CallId
  fecha: DateStr
  turno: string
  cuadrilla: string
  concepto: string
  personas: number
  toneladas: DecimalStr
  tarifa_usd: Money
  amount_usd: Money
}

export interface CallDetail {
  call: CallSummary
  parts: PartSummary[]
  suggested_parts: PartSummary[]
  piecework: Piecework[]
  totals: { jornal_usd: Money; destajo_usd: Money; total_usd: Money }
}

export interface PartsList {
  results: PartSummary[]
  count: number
}

export interface ObservationMatch {
  call: CallId
  by: 'alias' | 'muelle' | (string & {})
  term: string
}

export interface Evidence {
  shift: { start: LocalDateTime; end: LocalDateTime }
  observation: { raw: string; normalized: string; matches: ObservationMatch[] }
  planned_front: { frentes: string[]; call: CallId | null; nombrada_refs: string[] }
  piecework: Piecework[]
  windows: { call: CallId; overlap_minutes: number; active: boolean }[]
}

export interface Review {
  id: number
  operation_id: string
  actor: string
  created_at: LocalDateTime
  from_status: PartStatus
  to_status: PartStatus
  from_destination: CallId | null
  to_destination: CallId | null
  reason: string
  reference: string
  version_before: number
  version_after: number
}

export interface PartDetail extends PartSummary {
  evidence: Evidence
  candidates: CallId[]
  allowed_destinations: CallId[]
  reviews: Review[]
  can_review: boolean
}

export interface ReviewRequest {
  destination: CallId | null
  reason: string
  reference: string
  expected_version: number
  operation_id: string
}

export interface ReviewResponse {
  part: PartDetail
  review: Review
  replayed: boolean
}

export interface PartsQuery {
  status?: PartStatusFilter | ''
  call?: CallId | ''
}

/** Superficie común del cliente HTTP y del adaptador sintético. */
export interface Api {
  readonly mode: 'http' | 'mock'
  getSession(): Promise<Session>
  login(username: string, password: string): Promise<Session>
  logout(): Promise<Session>
  getSummary(): Promise<Summary>
  getCall(id: CallId): Promise<CallDetail>
  listParts(query?: PartsQuery): Promise<PartsList>
  getPart(id: number): Promise<PartDetail>
  postReview(id: number, body: ReviewRequest): Promise<ReviewResponse>
  exportUrl(kind: 'csv' | 'xlsx'): string
}
