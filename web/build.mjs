#!/usr/bin/env node
// Builds the static site for util.exvanitas.ai into dist/:
//   dist/site/index.html                   root page linking to the tools
//   dist/site/.htaccess                    headers backing the "never uploaded" promise
//   dist/site/scene-convert/index.html     the converter, one self-contained file
//   dist/site/scene-convert/OFL.txt        license for the embedded display face
//   dist/preview/index.html                the same page as a fragment, for a claude.ai preview
// Each HTML page carries a meta CSP: no network at all, scripts and styles by hash.
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

export function csp(head, body) {
  const script = /<script/.test(body) ? `script-src ${hash(inner(body, 'script'))}` : "script-src 'none'"
  return [
    "default-src 'none'",
    script,
    `style-src ${hash(inner(head, 'style'))}`,
    'font-src data:',
    "img-src 'self' data:", // favicons: Firefox applies img-src to them
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function document({ head, body, meta, lang = 'en' }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp(head, body)}">
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

export function buildPages() {
  const code = bundle()
  if (code.includes('</script')) throw new Error('bundle contains </script')
  const fonts = [fontFace('fell-regular.woff2', 'normal'), fontFace('fell-italic.woff2', 'italic')].join('\n')
  const filled = read('web/page.html').replace('/*FONTS*/', () => fonts).replace('//APP', () => code)
  const [head, body] = filled.split('<!--BODY-->')
  if (!body) throw new Error('page.html needs a <!--BODY--> marker')

  const rootTemplate = read('web/root.html').replace('/*FONTS*/', () => fontFace('fell-regular.woff2', 'normal'))
  const [rootHead, rootBody] = rootTemplate.split('<!--BODY-->')
  return {
    code,
    tool: document({ head, body, meta: headMeta(PAGES.tool) }),
    root: document({ head: rootHead, body: rootBody, meta: headMeta(PAGES.root) }),
    preview: `${head.trim()}\n${body.trim()}\n`,
  }
}

// The site forces https itself.
// The host is fixed (no %{HTTP_HOST}), and /.well-known/ stays on http for certificate renewals.
const HTACCESS = `# util.exvanitas.ai: static pages that never make network requests.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} !=on
  RewriteCond %{REQUEST_URI} !^/\\.well-known/
  RewriteRule ^ https://util.exvanitas.ai%{REQUEST_URI} [R=301,L]
</IfModule>
<IfModule mod_headers.c>
  Header always set Content-Security-Policy "frame-ancestors 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "no-referrer"
</IfModule>
`

export function build(outDir = fileURLToPath(new URL('dist/', ROOT))) {
  const pages = buildPages()
  rmSync(outDir, { recursive: true, force: true })
  const site = `${outDir}/site`
  mkdirSync(`${site}/scene-convert`, { recursive: true })
  mkdirSync(`${outDir}/preview`, { recursive: true })
  writeFileSync(`${site}/index.html`, pages.root)
  writeFileSync(`${site}/.htaccess`, HTACCESS)
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
