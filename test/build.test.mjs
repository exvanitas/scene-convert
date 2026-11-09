import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, gaId, GA_HOSTS } from '../web/build.mjs'

test('site build: bundle parses, CSP hashes match, nothing points off-site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-convert-build-'))
  try {
    build(dir, '')
    execFileSync(process.execPath, ['--check', join(dir, 'bundle.mjs')])
    for (const page of ['site/index.html', 'site/scene-convert/index.html']) {
      const html = readFileSync(join(dir, page), 'utf8')
      const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1]
      assert.match(policy, /connect-src 'none'/)
      assert.match(policy, /default-src 'none'/)
      for (const tag of ['style', 'script']) {
        const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(html)
        if (!m) continue
        const digest = createHash('sha256').update(m[1], 'utf8').digest('base64')
        assert.ok(policy.includes(`'sha256-${digest}'`), `${page}: ${tag} hash missing from CSP`)
      }
      const outside = (html.match(/(?:src|href|content)="(?:https?:)?\/\/[^"]+"/g) ?? []).filter((m) => !m.includes('//util.exvanitas.ai/') && m !== 'href="https://github.com/exvanitas/scene-convert"')
      assert.deepEqual(outside, [], `${page} references another host`)
      for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:image']) {
        assert.match(html, new RegExp(`property="${tag}"|name="${tag}"`), `${page} lacks ${tag}`)
      }
      const og = /property="og:image" content="https:\/\/util\.exvanitas\.ai(\/[^"]+)"/.exec(html)[1]
      const png = readFileSync(join(dir, 'site', og))
      assert.equal(png.readUInt32BE(16), 1200, `${og} width`)
      assert.equal(png.readUInt32BE(20), 630, `${og} height`)
    }
    const preview = readFileSync(join(dir, 'preview/index.html'), 'utf8')
    assert.ok(!preview.includes('<!doctype'), 'preview is a fragment')
    for (const f of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) readFileSync(join(dir, 'site', f))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const ID = 'G-TEST123456'
const policyOf = (html) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1]
const directive = (policy, name) => policy.split('; ').find((d) => d.startsWith(`${name} `))
const htmlPages = (dir) => ['site/index.html', 'site/scene-convert/index.html', 'site/privacy/index.html'].filter((p) => existsSync(join(dir, p)))

test('site build without SITE_GA_ID: no analytics, the 0.1.0 promise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-convert-noga-'))
  try {
    build(dir, '')
    assert.ok(!existsSync(join(dir, 'site/privacy')), 'no privacy page without analytics')
    for (const page of htmlPages(dir)) assert.ok(!readFileSync(join(dir, page), 'utf8').includes('googletagmanager'), `${page} loads Google`)
    assert.match(readFileSync(join(dir, 'site/scene-convert/index.html'), 'utf8'), /Nothing leaves your browser\./)
    assert.match(readFileSync(join(dir, 'site/.htaccess'), 'utf8'), /connect-src 'none'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('site build with SITE_GA_ID: every page tagged, CSP opens to Google analytics only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-convert-ga-'))
  try {
    build(dir, ID)
    const pages = htmlPages(dir)
    assert.equal(pages.length, 3, 'root, tool and privacy pages')
    for (const page of pages) {
      const html = readFileSync(join(dir, page), 'utf8')
      const policy = policyOf(html)
      assert.ok(html.includes(`var ID = '${ID}'`), `${page} lacks the ID`)
      assert.ok(!html.includes('__GA_ID__'), `${page} kept the placeholder`)
      for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        const digest = createHash('sha256').update(m[1], 'utf8').digest('base64')
        assert.ok(policy.includes(`'sha256-${digest}'`), `${page}: a script hash is missing from the CSP`)
      }
      assert.ok(!/'unsafe-/.test(policy), `${page}: unsafe-* in the CSP`)
      assert.equal(directive(policy, 'connect-src'), `connect-src ${GA_HOSTS.connect.join(' ')}`)
      assert.ok(directive(policy, 'script-src').endsWith(` ${GA_HOSTS.script.join(' ')}`), `${page}: script-src`)
      assert.equal(directive(policy, 'img-src'), `img-src 'self' data: ${GA_HOSTS.img.join(' ')}`)
      assert.match(policy, /default-src 'none'/)
      assert.match(html, /href="\/privacy\/"|data-analytics="yes"/, `${page} has no way to the privacy note or the choice`)
      const outside = (html.match(/(?:src|href|content)="(?:https?:)?\/\/[^"]+"/g) ?? []).filter((m) => !m.includes('//util.exvanitas.ai/') &&
        !['href="https://github.com/exvanitas/scene-convert"', 'href="https://policies.google.com/technologies/partner-sites"'].includes(m))
      assert.deepEqual(outside, [], `${page} references another host`)
    }
    const tool = readFileSync(join(dir, 'site/scene-convert/index.html'), 'utf8')
    assert.ok(tool.includes('Your files never leave your browser. We count visits with Google Analytics. <a href="/privacy/">Privacy</a>.'))
    assert.ok(!tool.includes('Nothing leaves your browser.'))
    const privacy = readFileSync(join(dir, 'site/privacy/index.html'), 'utf8')
    for (const tag of ['og:title', 'og:url', 'og:image', 'twitter:card']) assert.match(privacy, new RegExp(`property="${tag}"|name="${tag}"`))
    for (const v of ['yes', 'no']) assert.match(privacy, new RegExp(`data-analytics="${v}"`))
    const header = readFileSync(join(dir, 'site/.htaccess'), 'utf8')
    assert.ok(header.includes(`connect-src ${GA_HOSTS.connect.join(' ')};`), '.htaccess connect-src')
    assert.ok(!header.includes("connect-src 'none'"))
    assert.ok(!readFileSync(join(dir, 'preview/index.html'), 'utf8').includes(ID), 'the claude.ai preview never counts')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SITE_GA_ID: only a GA4 measurement ID, or nothing', () => {
  assert.equal(gaId(undefined), '')
  assert.equal(gaId(''), '')
  assert.equal(gaId(ID), ID)
  for (const bad of ['UA-1234-1', 'G-abc12345', "G-1234567'", 'G-12', ' G-TEST123456']) assert.throws(() => gaId(bad), /not a GA4 measurement ID/)
})
