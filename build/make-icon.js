// Generates a multi-size Windows .ico (PNG-compressed entries) plus preview PNGs.
// The folder is drawn geometrically with 4x4 supersampling, so every size is
// rendered at its own resolution rather than upscaled from a small bitmap.
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// ── PNG encoding ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── geometry, in normalised 0..1 coords ─────────────────────────────────────
// Signed-distance-ish coverage test for a rounded rectangle.
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// Folder: a tab on the upper left, a body, and a lighter front flap.
const TAB = [0.09, 0.155, 0.46, 0.34, 0.045]
const BODY = [0.06, 0.27, 0.94, 0.845, 0.075]
const FLAP = [0.06, 0.435, 0.94, 0.845, 0.075]

const ACCENT = [0x63, 0x66, 0xf1] // app accent indigo
const FLAP_C = [0x84, 0x87, 0xf7] // a touch lighter, so the fold reads

function render(size, ss = 4) {
  const rgba = Buffer.alloc(size * size * 4) // transparent
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let back = 0
      let front = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          if (inRoundRect(x, y, ...TAB) || inRoundRect(x, y, ...BODY)) back++
          if (inRoundRect(x, y, ...FLAP)) front++
        }
      }
      const n = ss * ss
      const aBack = back / n
      const aFront = front / n
      if (aBack === 0 && aFront === 0) continue
      // composite the flap over the body
      const alpha = Math.max(aBack, aFront)
      const t = alpha === 0 ? 0 : aFront / Math.max(alpha, 1e-6)
      const col = [0, 1, 2].map((i) => Math.round(ACCENT[i] * (1 - t) + FLAP_C[i] * t))
      const o = (py * size + px) * 4
      rgba[o] = col[0]
      rgba[o + 1] = col[1]
      rgba[o + 2] = col[2]
      rgba[o + 3] = Math.round(alpha * 255)
    }
  }
  return rgba
}

// ── ICO container (PNG-compressed entries) ──────────────────────────────────
function buildIco(entries) {
  const dir = Buffer.alloc(6 + 16 * entries.length)
  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(entries.length, 4)
  let offset = dir.length
  const blobs = []
  entries.forEach((e, i) => {
    const p = 6 + 16 * i
    dir[p] = e.size >= 256 ? 0 : e.size // 0 means 256
    dir[p + 1] = e.size >= 256 ? 0 : e.size
    dir[p + 2] = 0 // palette
    dir[p + 3] = 0 // reserved
    dir.writeUInt16LE(1, p + 4) // colour planes
    dir.writeUInt16LE(32, p + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += e.png.length
    blobs.push(e.png)
  })
  return Buffer.concat([dir, ...blobs])
}

const outDir = process.argv[2]
fs.mkdirSync(outDir, { recursive: true })

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const entries = SIZES.map((size) => ({ size, png: encodePng(size, size, render(size)) }))

const ico = buildIco(entries)
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
console.log(`icon.ico: ${ico.length} bytes, ${SIZES.length} sizes (${SIZES.join(', ')})`)

// standalone previews so the shape can be eyeballed
for (const s of [64, 256]) {
  const p = path.join(outDir, `preview-${s}.png`)
  fs.writeFileSync(p, encodePng(s, s, render(s)))
  console.log(`preview-${s}.png written`)
}
