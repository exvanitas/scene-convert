#!/usr/bin/env node
// Builds the static site for util.exvanitas.ai into dist/:
//   dist/site/index.html                   root page linking to the tools
//   dist/site/.htaccess                    headers backing the "never uploaded" promise
//   dist/site/scene-convert/index.html     the converter, one self-contained file
//   dist/site/scene-convert/OFL.txt        license for the embedded display face
//   dist/site/privacy/index.html           what the analytics count (only with SITE_GA_ID)
//   dist/preview/index.html                the same page as a fragment, for a claude.ai preview
// Each HTML page carries a meta CSP: scripts and styles by hash, and no network at all.
// SITE_GA_ID=G-... (set by the deploy, never committed) adds Google Analytics through web/site-analytics.js:
// the CSP then allows Google's analytics hosts and nothing else. Unset, the output is what it was in 0.1.0.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const MODULES = ['src/zip.mjs', 'src/syntax.mjs', 'src/formats.mjs', 'src/convert.mjs', 'web/app.mjs']

/** Concatenate the modules into one module script: local imports dropped, exports unwrapped. */
export function bundle() {
  return MODULES.map((file) => {
    const out = read(file)
      .replace(/^import\s[^\n]*from\s+'\.{1,2}\/[^']+'\s*;?\s*$/gm, '')
      .replace(/^export\s+(?=(async\s+)?function\b|const\b|let\b|class\b)/gm, '')
    if (/^\s*(import|export)\s/m.test(out)) throw new Error(`${file}: import/export the bundler can't handle`)
    return `// ${file}\n${out.trim()}\n`
  }).join('\n')
}

function fontFace(file, style) {
  const b64 = readFileSync(new URL(`web/fonts/${file}`, ROOT)).toString('base64')
  return `@font-face { font-family: "IM Fell English"; font-style: ${style}; font-weight: 400; font-display: swap; src: url(data:font/woff2;base64,${b64}) format("woff2"); }`
}

const SITE = 'https://util.exvanitas.ai'
// Link previews: canonical, Open Graph, Twitter card, theme colours and icons.
export const PAGES = {
  root: {
    path: '/',
    title: 'exvanitas utilities',
    description: 'Small tools from exvanitas. Everything runs in your browser; nothing you open is uploaded.',
    image: '/og.png',
    alt: 'exvanitas utilities, on a dark ground, with util.exvanitas.ai',
  },
  tool: {
    path: '/scene-convert/',
    title: 'Scene Convert',
    description: 'Convert NovelAI scene presets between SDStudio and NAIS2/NAIS3, both ways, in your browser. Nothing is uploaded.',
    image: '/scene-convert/og.png',
    alt: 'SDStudio & NAIS scenes, on a dark ground, with util.exvanitas.ai/scene-convert',
  },
  privacy: {
    path: '/privacy/',
    title: 'Privacy · exvanitas utilities',
    description: 'Your files never leave your browser. What the visit counter records, and how to turn it off.',
    image: '/og.png',
    alt: 'exvanitas utilities, on a dark ground, with util.exvanitas.ai',
  },
}
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function headMeta(page) {
  const url = SITE + page.path
  const image = SITE + page.image
  const m = (k, v, key = 'name') => `<meta ${key}="${k}" content="${attr(v)}">`
  return [
    m('description', page.description),
    m('robots', 'index, follow'),
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eeebe4">',
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#15120f">',
    `<link rel="canonical" href="${attr(url)}">`,
    m('og:title', page.title, 'property'),
    m('og:description', page.description, 'property'),
    m('og:url', url, 'property'),
    m('og:site_name', 'exvanitas utilities', 'property'),
    m('og:locale', 'en_US', 'property'),
    m('og:image', image, 'property'),
    m('og:image:width', '1200', 'property'),
    m('og:image:height', '630', 'property'),
    m('og:image:alt', page.alt, 'property'),
    m('og:type', 'website', 'property'),
    m('twitter:card', 'summary_large_image'),
    m('twitter:title', page.title),
    m('twitter:description', page.description),
    m('twitter:image', image),
    m('twitter:image:alt', page.alt),
    '<link rel="icon" href="/favicon.ico">',
    '<link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png">',
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  ].join('\n')
}

const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
const inner = (html, tag) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(html)
  if (!m) throw new Error(`no <${tag}>`)
  return m[1]
}

// Google's list for "Google Analytics without Ads features" (developers.google.com/tag-platform/security/guides/csp).
export const GA_HOSTS = {
  script: ['https://www.googletagmanager.com'],
  img: ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
  connect: ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com'],
}
const scripts = (html) => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])

export function csp(head, body, ga = false) {
  const inline = [...scripts(head), ...scripts(body)].map(hash)
  const script = inline.length ? `script-src ${[...inline, ...(ga ? GA_HOSTS.script : [])].join(' ')}` : "script-src 'none'"
  return [
    "default-src 'none'",
    script,
    `style-src ${hash(inner(head, 'style'))}`,
    'font-src data:',
    ["img-src 'self' data:", ...(ga ? GA_HOSTS.img : [])].join(' '), // favicons: Firefox applies img-src to them
    ga ? `connect-src ${GA_HOSTS.connect.join(' ')}` : "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/** The GA4 measurement ID from SITE_GA_ID, or '' for none. Anything else set there is a mistake: refuse to build. */
export function gaId(value = process.env.SITE_GA_ID) {
  if (value === undefined || value === '') return ''
  if (!/^G-[A-Z0-9]{6,12}$/.test(value)) throw new Error(`SITE_GA_ID is not a GA4 measurement ID: ${JSON.stringify(value)}`)
  return value
}

/** web/site-analytics.js with the ID in place, as the text of one inline script. */
export function analyticsScript(id) {
  const text = read('web/site-analytics.js')
  if (!text.includes("'__GA_ID__'")) throw new Error('site-analytics.js lost its __GA_ID__ placeholder')
  // The header comment is for readers of the repo; the page gets the code.
  const out = text.replace(/^\/\*[\s\S]*?\*\/\n/, '').replace("'__GA_ID__'", () => `'${id}'`)
  if (out.includes('__GA_ID__')) throw new Error('site-analytics.js has a second __GA_ID__')
  if (out.includes('</script')) throw new Error('site-analytics.js contains </script')
  return out
}

function document({ head, body, meta, ga = '', lang = 'en' }) {
  if (ga) head = `<script>${analyticsScript(ga)}</script>\n${head}`
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp(head, body, Boolean(ga))}">
<meta name="referrer" content="no-referrer">
${meta}
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`
}

// With analytics on, the pages' promise narrows from "nothing" to "your files", and they link the privacy note.
const ANALYTICS_LINE = 'We count visits with Google Analytics. <a href="/privacy/">Privacy</a>.'
const once = (text, from, to, where) => {
  if (text.split(from).length !== 2) throw new Error(`${where}: expected one ${JSON.stringify(from)}`)
  return text.replace(from, () => to)
}
const split = (text, where) => {
  const [head, body] = text.split('<!--BODY-->')
  if (!body) throw new Error(`${where} needs a <!--BODY--> marker`)
  return [head, body]
}

export function buildPages(ga = gaId()) {
  const code = bundle()
  if (code.includes('</script')) throw new Error('bundle contains </script')
  const fonts = [fontFace('fell-regular.woff2', 'normal'), fontFace('fell-italic.woff2', 'italic')].join('\n')
  const filled = read('web/page.html').replace('/*FONTS*/', () => fonts).replace('//APP', () => code)
  const [head, body] = split(filled, 'page.html')
  const toolBody = ga ? once(body, 'Nothing leaves your browser.', `Your files never leave your browser. ${ANALYTICS_LINE}`, 'page.html') : body

  const regular = fontFace('fell-regular.woff2', 'normal')
  const rootTemplate = read('web/root.html').replace('/*FONTS*/', () => regular)
  const [rootHead, rootBody] = split(rootTemplate, 'root.html')
  const rootText = ga
    ? once(rootBody, '<p>Everything here runs in your browser. Nothing you open is uploaded.</p>',
      `<p>Everything here runs in your browser. Nothing you open is uploaded. ${ANALYTICS_LINE}</p>`, 'root.html')
    : rootBody
  const pages = {
    code,
    tool: document({ head, body: toolBody, meta: headMeta(PAGES.tool), ga }),
    root: document({ head: rootHead, body: rootText, meta: headMeta(PAGES.root), ga }),
    preview: `${head.trim()}\n${body.trim()}\n`, // a claude.ai preview never counts visits
  }
  if (ga) {
    const [privacyHead, privacyBody] = split(read('web/privacy.html').replace('/*FONTS*/', () => regular), 'privacy.html')
    pages.privacy = document({ head: privacyHead, body: privacyBody, meta: headMeta(PAGES.privacy), ga })
  }
  return pages
}

// The site forces https itself.
// The host is fixed (no %{HTTP_HOST}), and /.well-known/ stays on http for certificate renewals.
const htaccess = (ga) => `# util.exvanitas.ai: static pages that never make network requests${ga ? ' except to Google Analytics' : ''}.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} !=on
  RewriteCond %{REQUEST_URI} !^/\\.well-known/
  RewriteRule ^ https://util.exvanitas.ai%{REQUEST_URI} [R=301,L]
</IfModule>
<IfModule mod_headers.c>
  Header always set Content-Security-Policy "frame-ancestors 'none'; ${ga ? `connect-src ${GA_HOSTS.connect.join(' ')}` : "connect-src 'none'"}; form-action 'none'; base-uri 'none'; object-src 'none'"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "no-referrer"
</IfModule>
`

export function build(outDir = fileURLToPath(new URL('dist/', ROOT)), ga = gaId()) {
  const pages = buildPages(ga)
  rmSync(outDir, { recursive: true, force: true })
  const site = `${outDir}/site`
  mkdirSync(`${site}/scene-convert`, { recursive: true })
  mkdirSync(`${outDir}/preview`, { recursive: true })
  writeFileSync(`${site}/index.html`, pages.root)
  writeFileSync(`${site}/.htaccess`, htaccess(ga))
  if (ga) {
    mkdirSync(`${site}/privacy`, { recursive: true })
    writeFileSync(`${site}/privacy/index.html`, pages.privacy)
  }
  writeFileSync(`${site}/scene-convert/index.html`, pages.tool)
  copyFileSync(new URL('web/fonts/OFL.txt', ROOT), `${site}/scene-convert/OFL.txt`)
  const asset = (name, to) => copyFileSync(new URL(`web/assets/${name}`, ROOT), `${site}/${to}`)
  asset('og-root.png', 'og.png')
  asset('og-scene-convert.png', 'scene-convert/og.png')
  for (const icon of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) asset(icon, icon)
  writeFileSync(`${outDir}/preview/index.html`, pages.preview)
  copyFileSync(new URL('web/fonts/OFL.txt', ROOT), `${outDir}/preview/OFL.txt`)
  writeFileSync(`${outDir}/bundle.mjs`, pages.code)
  return { outDir, pages }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir } = build(process.argv[2])
  console.log(`built ${outDir}`)
}
