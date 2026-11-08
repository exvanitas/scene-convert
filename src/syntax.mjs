// Prompt syntax translation.
//
// The converter's internal form uses SDStudio piece refs, <library.piece>,
// because SDStudio is the strict side: it rejects any <...> word that is not
// exactly one library and one piece. NAIS fragment refs (<name>, <folder/name>,
// <*name>, <a|b|c>) are rewritten into that form on the way in and back out.
//
// NAIS rules mirrored here come from NAIS3 src/main/fragments/processor.ts and
// src/shared/nai-presets.ts (removeComments): lines starting with # are
// comments, fragment lookup is case-insensitive, and a fragment picks one
// random non-comment line.

const REF = /<([^<>]+)>/g

/** NAIS3 normalizeFragmentPath: trim, lowercase, tidy spaces around "/". */
export function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s*\/\s*/g, '/')
}

/** NAIS3 contentToLines: the random options a fragment can pick from. */
export function fragmentLines(text) {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/**
 * Split a NAIS ref name into [library, piece]. Bare names go to the bridge
 * library; "lib.piece" names (written by this tool, or SDStudio-shaped NAIS
 * fragments) keep their library so they survive a round trip.
 */
export function pieceKey(name, bridgeLib, notes) {
  let n = name.trim()
  if (n.includes('/')) n = n.split('/').pop().trim() // NAIS3 fragment names are globally unique
  const parts = n.split('.')
  if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]]
  if (parts.length > 2) {
    notes?.add('fragment names with several dots had dots replaced by _', n)
    return [bridgeLib, n.replaceAll('.', '_')]
  }
  return [bridgeLib, n]
}

/** Join a multi-line NAIS prompt into one SDStudio line, dropping # comment lines. */
export function joinLines(prompt, notes) {
  const lines = prompt.replace(/\r\n/g, '\n').split('\n')
  if (lines.length === 1) return prompt
  let out = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      notes?.add('# comment lines dropped (SDStudio has no comments)', line)
      continue
    }
    out = !out ? line : out.endsWith(',') ? `${out} ${line}` : `${out}, ${line}`
  }
  return out
}

/** Warn about NAIS-only wildcard syntax that SDStudio would send literally. */
function noteSlashWildcards(prompt, notes) {
  for (const m of prompt.matchAll(/\(([^()]+\/[^()]+)\)/g)) {
    notes?.add('NAIS (a/b) wildcards left as plain text', m[0])
  }
  for (const tag of prompt.split(/[,\n]/)) {
    const t = tag.trim()
    if (t.includes('/') && !t.includes(' ') && !t.includes('://') && !t.startsWith('(') && !/[<>]/.test(t)) {
      notes?.add('NAIS a/b wildcards left as plain text', t)
    }
  }
}

/**
 * NAIS prompt -> internal (<lib.piece>) prompt.
 * ctx.resolve(lib, piece, rawName) registers the piece; ctx.inline(options)
 * registers a generated multi piece and returns its [lib, piece].
 */
export function fromNais(prompt, ctx) {
  const { bridgeLib, notes } = ctx
  let out = joinLines(prompt, notes)
  noteSlashWildcards(out, notes)
  out = out.replace(REF, (whole, body) => {
    const content = body.trim()
    if (content.includes('|')) {
      const options = content.split('|').map((o) => o.trim()).filter(Boolean)
      if (options.length === 0) return whole
      const [lib, piece] = ctx.inline(options)
      notes?.add('inline <a|b> wildcards became generated multi pieces', `${whole} -> <${lib}.${piece}>`)
      return `<${lib}.${piece}>`
    }
    let name = content
    if (name.startsWith('*')) {
      notes?.add('<*sequential> refs became random picks (SDStudio has no sequential mode)', whole)
      name = name.slice(1)
    }
    if (!name.trim()) return whole
    const [lib, piece] = ctx.resolve(...pieceKey(name, bridgeLib, notes), name)
    return `<${lib}.${piece}>`
  })
  return out
}

/** Internal prompt -> NAIS prompt. Bridge-library refs go back to bare <name>. */
export function toNais(prompt, { bridgeLib, notes }) {
  for (const line of prompt.split('\n')) {
    if (line.trimStart().startsWith('#')) notes?.add('lines starting with # will be read as comments by NAIS', line.trim())
  }
  for (const m of prompt.matchAll(/\(([^()]+\/[^()]+)\)/g)) {
    notes?.add('(a/b) text will be read as a random pick by NAIS', m[0])
  }
  for (const tag of prompt.split(/[,\n]/)) {
    const t = tag.trim()
    if (t.includes('/') && !t.includes(' ') && !t.includes('://') && !t.startsWith('(') && !/[<>]/.test(t)) {
      notes?.add('a/b tags will be read as a random pick by NAIS', t)
    }
  }
  return prompt.replace(REF, (whole, body) => {
    const content = body.trim()
    const dot = content.indexOf('.')
    if (dot > 0 && content.slice(0, dot) === bridgeLib && !content.slice(dot + 1).includes('.')) {
      return `<${content.slice(dot + 1)}>`
    }
    return whole
  })
}

/** Every <...> word in an SDStudio prompt, the way SDStudio parses pieces. */
export function sdstudioRefs(prompt) {
  const refs = []
  for (const word of prompt.replace('\n', ',').split(',')) {
    const w = word.trim()
    if (w.startsWith('<') && w.endsWith('>')) refs.push(w.slice(1, -1))
  }
  return refs
}
