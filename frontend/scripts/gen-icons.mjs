// Genera public/icons/icon-192.png e icon-512.png sin dependencias (solo node:zlib/fs).
// Dibuja el mismo motivo que icon.svg: delta (triángulo) y olas sobre fondo marino.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t))
const cov = (d, half) => Math.max(0, Math.min(1, half - d + 0.5))

function render(size) {
  const s = size / 512
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const tri = [[256, 104], [376, 320], [136, 320]]
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const X = (x + 0.5) / s, Y = (y + 0.5) / s
      // Fondo con esquinas redondeadas (r=112 en 512)
      const r = 112
      const qx = Math.max(Math.abs(X - 256) - (256 - r), 0)
      const qy = Math.max(Math.abs(Y - 256) - (256 - r), 0)
      const inside = cov(Math.hypot(qx, qy) - r, 0) // 1 dentro, 0 fuera
      let col = mix([27, 54, 93], [16, 38, 65], (X + Y) / 1024)
      // Triángulo
      let d = Infinity
      for (let i = 0; i < 3; i++) {
        const [a, b] = [tri[i], tri[(i + 1) % 3]]
        d = Math.min(d, distSeg(X, Y, a[0], a[1], b[0], b[1]))
      }
      col = mix(col, mix([255, 255, 255], [231, 237, 243], (X + Y) / 1024), cov(d * s, 17 * s))
      // Olas
      if (X >= 92 && X <= 420) {
        const w1 = 372 - 14 * Math.sin(((X - 104) / 76) * Math.PI)
        col = mix(col, [255, 195, 0], cov(Math.abs(Y - w1) * s, 13 * s))
        const w2 = 424 - 14 * Math.sin(((X - 104) / 76) * Math.PI)
        col = mix(col, [255, 107, 53], cov(Math.abs(Y - w2) * s, 10 * s))
      }
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = Math.round(col[0]); raw[o + 1] = Math.round(col[1]); raw[o + 2] = Math.round(col[2])
      raw[o + 3] = Math.round(255 * inside)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`)
  if (existsSync(file) && !process.argv.includes('--force')) continue
  writeFileSync(file, render(size))
  console.log('icono generado:', file)
}
