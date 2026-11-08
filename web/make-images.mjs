#!/usr/bin/env node
// Renders the link-preview images and icons into web/assets/ (committed, so the
// site build itself needs no browser). Plain and on the page's current look;
// exvanitas styling gets revised later.
//   node web/make-images.mjs   (needs the playwright package; PLAYWRIGHT=<module path> to point elsewhere)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PW = process.env.PLAYWRIGHT ?? 'playwright'
const { chromium } = await import(PW)
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const font = (f) => readFileSync(here(`fonts/${f}`)).toString('base64')
const FACES = `
@font-face { font-family: Fell; font-style: normal; src: url(data:font/woff2;base64,${font('fell-regular.woff2')}) format("woff2"); }
@font-face { font-family: Fell; font-style: italic; src: url(data:font/woff2;base64,${font('fell-italic.woff2')}) format("woff2"); }`
const INK = '#ebe3d4', DIM = '#a99d89', BRASS = '#c69f5e', GROUND = '#15120f', RULE = '#3b332a'

function card({ eyebrow, title, line, url }) {
  return `<!doctype html><meta charset="utf-8"><style>${FACES}
  html, body { margin: 0; width: 1200px; height: 630px; background: ${GROUND}; color: ${INK}; font-family: Fell, serif; }
  .card { box-sizing: border-box; width: 1200px; height: 630px; padding: 72px 84px 64px; display: grid; grid-template-rows: auto 1fr auto; }
  .eyebrow { font-style: italic; font-size: 34px; color: ${DIM}; }
  .mid { align-self: center; display: grid; gap: 26px; }
  h1 { margin: 0; font-weight: 400; font-size: 88px; line-height: 1; letter-spacing: -0.01em; white-space: nowrap; }
  h1 em { color: ${BRASS}; }
  p { margin: 0; font-size: 36px; line-height: 1.3; color: ${DIM}; max-width: 1000px; }
  .foot { border-top: 1px solid ${RULE}; padding-top: 22px; font-size: 32px; color: ${BRASS}; }
  </style><div class="card"><div class="eyebrow">${eyebrow}</div><div class="mid"><h1>${title}</h1><p>${line}</p></div><div class="foot">${url}</div></div>`
}

function icon(size) {
  return `<!doctype html><meta charset="utf-8"><style>${FACES}
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${GROUND}; }
  div { width: ${size}px; height: ${size}px; display: grid; place-items: center; color: ${BRASS};
        font: italic 400 ${Math.round(size * 1.05)}px/1 Fell, serif; padding-bottom: ${Math.round(size * 0.24)}px; box-sizing: border-box; }
  </style><div>e</div>`
}

/** ICO holding PNG images (Vista+ format), largest last. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt16LE(1, e + 4) // planes
    head.writeUInt16LE(32, e + 6) // bits per pixel
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p.data)])
}

const browser = await chromium.launch({ headless: true })
async function shot(html, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } })
  await page.close()
  return png
}

const out = here('assets/')
mkdirSync(out, { recursive: true })
writeFileSync(`${out}og-root.png`, await shot(card({
  eyebrow: 'exvanitas',
  title: 'exvanitas utilities',
  line: 'Small tools that run in your browser. Nothing you open is uploaded.',
  url: 'util.exvanitas.ai',
}), 1200, 630))
writeFileSync(`${out}og-scene-convert.png`, await shot(card({
  eyebrow: 'exvanitas utilities',
  title: 'SDStudio <em>&amp;</em> NAIS scenes',
  line: 'Convert NovelAI scene presets between SDStudio and NAIS, both ways. Runs in your browser; nothing is uploaded.',
  url: 'util.exvanitas.ai/scene-convert',
}), 1200, 630))
const sizes = { 16: null, 32: null, 48: null, 180: null }
for (const s of Object.keys(sizes)) sizes[s] = await shot(icon(Number(s)), Number(s), Number(s))
writeFileSync(`${out}favicon-16x16.png`, sizes[16])
writeFileSync(`${out}favicon-32x32.png`, sizes[32])
writeFileSync(`${out}apple-touch-icon.png`, sizes[180])
writeFileSync(`${out}favicon.ico`, ico([16, 32, 48].map((size) => ({ size, data: sizes[size] }))))
await browser.close()
console.log(`wrote ${out}`)
