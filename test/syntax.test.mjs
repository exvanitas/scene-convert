import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Notes } from '../src/formats.mjs'
import { fragmentLines, fromNais, joinLines, pieceKey, sdstudioRefs, toNais } from '../src/syntax.mjs'

function ctx(known = {}) {
  const notes = new Notes()
  const resolved = []
  const inlines = []
  return {
    notes,
    resolved,
    inlines,
    bridgeLib: 'nais',
    resolve(lib, piece, raw) {
      resolved.push([lib, piece, raw])
      return known[raw] ?? [lib, piece]
    },
    inline(options) {
      inlines.push(options)
      return ['nais', `inline-${inlines.length}`]
    },
  }
}

test('pieceKey: bare names go to the bridge library, lib.piece keeps its library', () => {
  assert.deepEqual(pieceKey('eyes', 'nais'), ['nais', 'eyes'])
  assert.deepEqual(pieceKey('char.hair', 'nais'), ['char', 'hair'])
  assert.deepEqual(pieceKey('folder / eyes', 'nais'), ['nais', 'eyes'])
  const notes = new Notes()
  assert.deepEqual(pieceKey('v1.5.2', 'nais', notes), ['nais', 'v1_5_2'])
  assert.equal(notes.list().length, 1)
})

test('fromNais rewrites fragment refs into SDStudio piece refs', () => {
  const c = ctx()
  assert.equal(fromNais('<eyes>, looking at viewer, <char.hair>', c), '<nais.eyes>, looking at viewer, <char.hair>')
  assert.deepEqual(c.resolved.map((r) => r[2]), ['eyes', 'char.hair'])
})

test('fromNais: sequential refs become random, inline options become multi pieces', () => {
  const c = ctx()
  assert.equal(fromNais('<*pose>, <smile | grin|frown >', c), '<nais.pose>, <nais.inline-1>')
  assert.deepEqual(c.inlines, [['smile', 'grin', 'frown']])
  const messages = c.notes.list().map((n) => n.message)
  assert.ok(messages.some((m) => m.includes('sequential')))
  assert.ok(messages.some((m) => m.includes('inline')))
})

test('fromNais joins lines and drops # comment lines', () => {
  const c = ctx()
  assert.equal(fromNais('1girl, solo,\n# old idea\n  smile\n\nblue sky', c), '1girl, solo, smile, blue sky')
  assert.equal(c.notes.list()[0].count, 1)
  assert.equal(joinLines('one line # not a comment'), 'one line # not a comment')
})

test('fromNais flags slash wildcards SDStudio would send literally', () => {
  const c = ctx()
  fromNais('1girl, red/blue, (sitting/standing), red/blue hair', c) // spaced slash tags are not wildcards in NAIS3
  assert.equal(c.notes.list().length, 2)
})

test('toNais turns bridge refs back into bare refs and leaves other libraries alone', () => {
  const notes = new Notes()
  assert.equal(toNais('<nais.eyes>, <char.hair>, <nais.a.b>', { bridgeLib: 'nais', notes }), '<eyes>, <char.hair>, <nais.a.b>')
  assert.equal(notes.list().length, 0)
})

test('toNais warns about text NAIS would read as syntax', () => {
  const notes = new Notes()
  toNais('# heading\nfate/stay_night, (a/b)', { bridgeLib: 'nais', notes })
  assert.equal(notes.list().length, 3)
})

test('fragmentLines matches NAIS3 contentToLines', () => {
  assert.deepEqual(fragmentLines('﻿blue eyes\r\n# note\n\n  red eyes  \n'), ['blue eyes', 'red eyes'])
})

test('sdstudioRefs finds whole-word piece refs', () => {
  assert.deepEqual(sdstudioRefs('<a.b>, smile, <c.d> , x<y>'), ['a.b', 'c.d'])
})
