import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../web/build.mjs'

test('site build: bundle parses, CSP hashes match, nothing points off-site', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-convert-build-'))
  try {
    build(dir)
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
      const outside = (html.match(/(?:src|href|content)="(?:https?:)?\/\/[^"]+"/g) ?? []).filter((m) => !m.includes('//util.exvanitas.ai/'))
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
