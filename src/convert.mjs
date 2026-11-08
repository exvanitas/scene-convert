// File-level conversion: input bytes in, output files out. No disk or DOM
// access, so the CLI and the web page share it unchanged.
import { DEFAULT_BRIDGE_LIB, Notes, detect, readNais, readSdstudio, writeNais, writeSdstudio } from './formats.mjs'
import { fromUtf8, isZip, readZip, utf8, writeZip } from './zip.mjs'

const baseName = (p) => p.split(/[\\/]/).pop()
const stem = (p) => baseName(p).replace(/\.[^.]*$/, '')
export const safeName = (name) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim() || 'scenes'

function parseJson(name, bytes) {
  try {
    return JSON.parse(fromUtf8(bytes).replace(/^﻿/, ''))
  } catch (e) {
    throw new Error(`${name}: not valid JSON (${e.message})`)
  }
}

/** Expand zips: every .json inside becomes its own input. */
export async function expandInputs(files) {
  const out = []
  for (const f of files) {
    if (isZip(f.data)) {
      const inner = (await readZip(f.data)).filter((e) => e.name.toLowerCase().endsWith('.json') && !baseName(e.name).startsWith('._'))
      if (!inner.length) throw new Error(`${f.name}: zip has no .json files`)
      for (const e of inner) out.push({ name: `${f.name}:${e.name}`, base: baseName(e.name), data: e.data })
    } else {
      out.push({ name: f.name, base: baseName(f.name), data: f.data })
    }
  }
  return out
}

/** NAIS fragment sources: .txt files, or zips of them (NAIS3 "export all fragments"). */
export async function loadFragments(files) {
  const map = new Map()
  const add = (name, data) => {
    if (name.toLowerCase().endsWith('.txt')) map.set(stem(name), fromUtf8(data))
  }
  for (const f of files) {
    if (isZip(f.data)) for (const e of await readZip(f.data)) add(e.name, e.data)
    else add(f.name, f.data)
  }
  return map
}

/**
 * @param files {{name: string, data: Uint8Array}[]}
 * @returns {Promise<{ results: {input, from, to, scenesIn, scenesOut, outputs: {name, data}[], notes, skipped?}[] }>}
 */
export async function convertFiles(files, { to, fragments = new Map(), bridgeLib = DEFAULT_BRIDGE_LIB, regroup = true, now, uuid } = {}) {
  const results = []
  for (const input of await expandInputs(files)) {
    const json = parseJson(input.name, input.data)
    const from = detect(json)
    if (!from) throw new Error(`${input.name}: not an SDStudio project or NAIS scene file`)
    const target = from === 'sdstudio' ? 'nais' : 'sdstudio'
    if (to && to !== target) {
      results.push({ input: input.name, from, to: null, skipped: `already ${from}`, outputs: [], notes: [] })
      continue
    }
    const notes = new Notes()
    const outputs = []
    let scenesIn, scenesOut
    if (from === 'sdstudio') {
      const model = readSdstudio(json, { notes })
      const { preset, fragments: frags } = writeNais(model, { bridgeLib, now, uuid, notes })
      const base = safeName(model.name)
      outputs.push({ name: `${base}.nais.json`, data: utf8(JSON.stringify(preset, null, 2) + '\n') })
      if (frags.length) outputs.push({ name: `${base}.fragments.zip`, data: writeZip(frags.map((f) => ({ name: f.name, data: f.text }))) })
      scenesIn = Object.keys(json.scenes).length
      scenesOut = preset.scenes.length
    } else {
      const model = readNais(json, { name: stem(input.base), fragments, bridgeLib, regroup, notes })
      const project = writeSdstudio(model, { uuid, notes })
      outputs.push({ name: `${safeName(model.name)}.sdstudio.json`, data: utf8(JSON.stringify(project) + '\n') })
      scenesIn = Array.isArray(json) ? json.length : json.scenes.length
      scenesOut = Object.keys(project.scenes).length
    }
    results.push({ input: input.name, from, to: target, scenesIn, scenesOut, outputs, notes: notes.list() })
  }
  return { results }
}
