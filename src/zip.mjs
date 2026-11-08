// Minimal zip reader/writer, portable between Node 22 and browsers.
// Reads stored/deflated entries in memory, writes stored entries.
// No zip64, no encryption. Entries never touch a disk, so names can't escape.

const MAX_ENTRY = 256 * 1024 * 1024
const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()
export const utf8 = (s) => utf8Encoder.encode(s)
export const fromUtf8 = (bytes) => utf8Decoder.decode(bytes)
export const toBytes = (d) => (typeof d === 'string' ? utf8(d) : d instanceof Uint8Array ? d : new Uint8Array(d))

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}

async function inflateRaw(bytes, name) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_ENTRY) {
      await reader.cancel()
      throw new Error(`${name}: entry too large`)
    }
    chunks.push(value)
  }
  return concatBytes(chunks)
}

export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
}

/** @returns {Promise<{name: string, data: Uint8Array}[]>} file entries, directories skipped */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (p) => view.getUint16(p, true)
  const u32 = (p) => view.getUint32(p, true)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = u16(eocd + 10)
  let p = u32(eocd + 16)
  const entries = []
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(p) !== CENTRAL) throw new Error('corrupt zip central directory')
    const flags = u16(p + 8)
    const method = u16(p + 10)
    const csize = u32(p + 20)
    const usize = u32(p + 24)
    const nameLen = u16(p + 28)
    const name = fromUtf8(bytes.subarray(p + 46, p + 46 + nameLen))
    const local = u32(p + 42)
    p += 46 + nameLen + u16(p + 30) + u16(p + 32)
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error(`${name}: encrypted zip entries are not supported`)
    if (usize > MAX_ENTRY) throw new Error(`${name}: entry too large`)
    if (local + 30 > bytes.length || u32(local) !== LOCAL) throw new Error(`${name}: corrupt local header`)
    const start = local + 30 + u16(local + 26) + u16(local + 28)
    const raw = bytes.subarray(start, start + csize)
    let data
    if (method === 0) data = raw.slice()
    else if (method === 8) data = await inflateRaw(raw, name)
    else throw new Error(`${name}: unsupported compression method ${method}`)
    entries.push({ name, data })
  }
  return entries
}

/** @param {{name: string, data: Uint8Array|string}[]} files @returns {Uint8Array} */
export function writeZip(files, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = utf8(f.name)
    const data = toBytes(f.data)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, LOCAL, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x800, true) // UTF-8 names
    local.setUint16(10, time, true)
    local.setUint16(12, day, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, CENTRAL, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 20, true)
    head.setUint16(8, 0x800, true)
    head.setUint16(12, time, true)
    head.setUint16(14, day, true)
    head.setUint32(16, crc, true)
    head.setUint32(20, data.length, true)
    head.setUint32(24, data.length, true)
    head.setUint16(28, name.length, true)
    head.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    central.push(new Uint8Array(head.buffer), name)
    offset += 30 + name.length + data.length
  }
  const dir = concatBytes(central)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, EOCD, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dir.length, true)
  end.setUint32(16, offset, true)
  return concatBytes([...parts, dir, new Uint8Array(end.buffer)])
}
