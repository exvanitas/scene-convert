import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, crc32 as nodeCrc32 } from 'node:zlib'
import { crc32, fromUtf8, isZip, readZip, writeZip } from '../src/zip.mjs'

test('writeZip output reads back, including UTF-8 names', async () => {
  const files = [
    { name: 'eyes.txt', data: 'blue eyes\nred eyes\n' },
    { name: '눈.txt', data: Buffer.from('golden eyes') },
  ]
  const zip = writeZip(files)
  assert.ok(isZip(zip))
  const back = await readZip(zip)
  assert.deepEqual(back.map((e) => e.name), ['eyes.txt', '눈.txt'])
  assert.equal(fromUtf8(back[0].data), 'blue eyes\nred eyes\n')
  assert.equal(fromUtf8(back[1].data), 'golden eyes')
})

test('readZip inflates deflated entries and skips directories', async () => {
  const data = Buffer.from('{"scenes": []}')
  const packed = deflateRawSync(data)
  const name = Buffer.from('dir/a.json')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(nodeCrc32(data), 14)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  const dirName = Buffer.from('dir/')
  const dirLocal = Buffer.alloc(30)
  dirLocal.writeUInt32LE(0x04034b50, 0)
  dirLocal.writeUInt16LE(dirName.length, 26)
  const central = (n, method, c, u, off) => {
    const h = Buffer.alloc(46)
    h.writeUInt32LE(0x02014b50, 0)
    h.writeUInt16LE(method, 10)
    h.writeUInt32LE(c, 20)
    h.writeUInt32LE(u, 24)
    h.writeUInt16LE(n.length, 28)
    h.writeUInt32LE(off, 42)
    return Buffer.concat([h, n])
  }
  const body = Buffer.concat([dirLocal, dirName, local, name, packed])
  const dir = Buffer.concat([central(dirName, 0, 0, 0, 0), central(name, 8, packed.length, data.length, 30 + dirName.length)])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(2, 8)
  end.writeUInt16LE(2, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(body.length, 16)
  const entries = await readZip(Buffer.concat([body, dir, end]))
  assert.deepEqual(entries.map((e) => [e.name, fromUtf8(e.data)]), [['dir/a.json', '{"scenes": []}']])
})

test('readZip rejects non-zips', async () => {
  await assert.rejects(() => readZip(Buffer.from('not a zip at all, just some text padding it out')), /not a zip/)
})

test('crc32 matches node zlib', () => {
  for (const s of ['', 'a', 'blue eyes\nred eyes\n', '눈'.repeat(500)]) assert.equal(crc32(Buffer.from(s)), nodeCrc32(Buffer.from(s)))
})
