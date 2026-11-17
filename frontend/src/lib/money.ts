/**
 * Utilidades de dinero y cantidades sobre cadenas decimales (contrato: dinero como texto).
 * Nunca se convierte a float para mostrar o sumar importes: se trabaja con BigInt en centavos.
 */

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/

/** Agrupa miles con punto (es-PE/es-ES estilo «23.158»). */
function groupThousands(int: string): string {
  const clean = int.replace(/^0+(?=\d)/, '')
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Redondea una cadena decimal a `scale` decimales (ROUND_HALF_UP) sin floats. */
export function roundDecimalString(value: string, scale = 2): string {
  const m = DECIMAL_RE.exec(value.trim())
  if (!m) throw new Error(`Decimal inválido: ${value}`)
  const [, sign, int, frac = ''] = m
  const padded = (frac + '0'.repeat(scale + 1)).slice(0, scale + 1)
  let units = BigInt(int + padded.slice(0, scale))
  if (Number(padded[scale]) >= 5) units += 1n
  const neg = sign === '-' && units !== 0n
  const s = units.toString().padStart(scale + 1, '0')
  const out = scale > 0 ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s
  return (neg ? '-' : '') + out
}

/** Convierte "23158.24" → 2315824n (centavos). */
export function toCents(value: string): bigint {
  const r = roundDecimalString(value, 2)
  const neg = r.startsWith('-')
  const digits = r.replace('-', '').replace('.', '')
  const n = BigInt(digits)
  return neg ? -n : n
}

/** Convierte centavos a cadena decimal con 2 decimales: 2315824n → "23158.24". */
export function fromCents(cents: bigint): string {
  const neg = cents < 0n
  const abs = (neg ? -cents : cents).toString().padStart(3, '0')
  return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`
}

/** Suma cadenas monetarias de forma exacta. */
export function addMoney(...values: string[]): string {
  return fromCents(values.reduce((acc, v) => acc + toCents(v), 0n))
}

/** Resta exacta a − b. */
export function subMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b))
}

/** Formatea "23158.24" → "23.158,24" (sin prefijo). */
export function formatAmount(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const r = roundDecimalString(String(value), 2)
  const neg = r.startsWith('-')
  const [int, frac] = r.replace('-', '').split('.')
  return `${neg ? '−' : ''}${groupThousands(int)},${frac}`
}

/** Formatea "23158.24" → "USD 23.158,24". */
export function formatUSD(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return `USD ${formatAmount(value)}`
}

/** Cantidades (jornales, toneladas): conserva los decimales de origen. "1525.629" → "1.525,629". */
export function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const m = DECIMAL_RE.exec(String(value).trim())
  if (!m) return String(value)
  const [, sign, int, frac] = m
  return `${sign === '-' ? '−' : ''}${groupThousands(int)}${frac ? ',' + frac : ''}`
}

/** Proporción visual (solo para barras/gráficos; nunca para mostrar importes). */
export function ratio(part: string, total: string): number {
  const t = toCents(total)
  if (t === 0n) return 0
  return Number((toCents(part) * 10000n) / t) / 10000
}
