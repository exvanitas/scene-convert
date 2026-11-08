// Readers and writers for the two scene formats, through one internal model:
//
//   { name, scenes: [{ name, prompts: string[], width, height }], pieces: Map }
//
// `prompts` holds every variant a scene generates. SDStudio enumerates slot
// combinations (each queued `samples` times), so N variants in SDStudio equal
// N NAIS scenes named name_1..name_N, the split NAIS2/NAIS3 already use when
// they import SDStudio files. Prompts use <library.piece> refs (see syntax.mjs).
// `pieces` maps "lib.piece" -> { lib, name, lines, multi, missing }.
import { fragmentLines, fromNais, normalizeName, pieceKey, toNais } from './syntax.mjs'

export const DEFAULT_BRIDGE_LIB = 'nais'

// SDStudio src/renderer/backends/imageGen.ts resolutionMap (names as SDStudio has them).
export const RESOLUTIONS = {
  small_landscape: [768, 512],
  small_portrait: [512, 768],
  small_square: [640, 640],
  landscape: [1216, 832],
  portrait: [832, 1216],
  square: [1024, 1024],
  large_landscape: [1536, 1024],
  large_portrait: [1024, 1536],
  large_square: [1472, 1472],
  wallpaper_portrait: [1920, 1088],
  wallpaper_landscape: [1088, 1920],
}
const NAIS_DEFAULT_SIZE = [832, 1216] // NAIS3 default when a scene has no size

/** Collects conversion notes, grouped by message, with a few examples each. */
export class Notes {
  constructor() {
    this.map = new Map()
  }
  add(message, example) {
    const entry = this.map.get(message) ?? { count: 0, examples: [] }
    entry.count++
    if (example !== undefined && entry.examples.length < 3 && !entry.examples.includes(example)) entry.examples.push(example)
    this.map.set(message, entry)
  }
  list() {
    return [...this.map].map(([message, e]) => ({ message, ...e }))
  }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : undefined)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** @returns {'sdstudio'|'nais'|null} */
export function detect(json) {
  if (isObj(json) && typeof json.name === 'string' && isObj(json.presets) && isObj(json.inpaints) && isObj(json.scenes) && isObj(json.library)) {
    return 'sdstudio'
  }
  if (Array.isArray(json) && json.every((x) => isObj(x) && 'scene_prompt' in x)) return 'nais'
  if (isObj(json) && Array.isArray(json.scenes)) return 'nais'
  return null
}

// ── SDStudio -> model ────────────────────────────────────────────────

/**
 * Every prompt a scene's slots produce: one enabled piece from each slot,
 * joined with ", ", earlier slots varying slowest. Slots with nothing enabled
 * are skipped. The order and joining match what NAIS2/NAIS3 produce when they
 * import an SDStudio file, so converted scenes line up with theirs.
 */
export function slotCombinations(slots, notes) {
  const choices = []
  for (const slot of slots) {
    const pieces = Array.isArray(slot) ? slot.filter(isObj) : []
    for (const p of pieces) {
      if (p.enabled === false) notes?.add('disabled SDStudio variants dropped (NAIS has no disabled scenes)', str(p.prompt)?.slice(0, 60))
    }
    const on = pieces.filter((p) => p.enabled !== false).map((p) => str(p.prompt) ?? '')
    if (on.length) choices.push(on)
  }
  const expand = (i) => {
    if (i === choices.length) return [[]]
    const rest = expand(i + 1)
    return choices[i].flatMap((head) => rest.map((tail) => [head, ...tail]))
  }
  return expand(0).map((parts) => parts.reduce((acc, part) => (acc ? `${acc}, ${part}` : part), ''))
}

function sdstudioSize(scene, notes) {
  if (scene.resolution === 'custom' && num(scene.resolutionWidth) && num(scene.resolutionHeight)) {
    return [scene.resolutionWidth, scene.resolutionHeight]
  }
  const size = RESOLUTIONS[scene.resolution]
  if (size) return size
  notes.add('unknown SDStudio resolutions fell back to portrait 832x1216', String(scene.resolution))
  return NAIS_DEFAULT_SIZE
}

export function readSdstudio(json, { notes = new Notes() } = {}) {
  const scenes = []
  for (const [key, scene] of Object.entries(json.scenes)) {
    if (!isObj(scene) || !Array.isArray(scene.slots)) continue
    if (isObj(scene.characterMiddlePrompt) && Object.keys(scene.characterMiddlePrompt).length) {
      notes.add('per-scene character middle prompts dropped (NAIS scenes have none)', key)
    }
    const [width, height] = sdstudioSize(scene, notes)
    scenes.push({ name: str(scene.name) ?? key, prompts: slotCombinations(scene.slots, notes), width, height })
  }
  const inpaints = Object.keys(json.inpaints ?? {})
  if (inpaints.length) notes.add('inpaint scenes skipped (they need their source images)', inpaints.slice(0, 3).join(', '))

  const presets = []
  for (const [type, list] of Object.entries(json.presets ?? {})) {
    for (const p of Array.isArray(list) ? list : []) {
      const chars = Array.isArray(p.characterPrompts) ? p.characterPrompts.filter((c) => c?.prompt).length : 0
      if (!chars && ![p.frontPrompt, p.backPrompt, p.uc].some((x) => typeof x === 'string' && x.trim())) continue
      presets.push(`${p.name} (${type}${chars ? `, ${chars} character prompt${chars > 1 ? 's' : ''}` : ''})`)
    }
  }
  if (presets.length) {
    notes.add('style presets not carried (NAIS3 can only load presets by replacing its own)', presets.join('; '))
  }

  const pieces = new Map()
  for (const [libKey, lib] of Object.entries(json.library ?? {})) {
    const libName = str(lib?.name) ?? libKey
    for (const p of Array.isArray(lib?.pieces) ? lib.pieces : []) {
      if (!str(p?.name)) continue
      const multi = !!p.multi
      const prompt = str(p.prompt) ?? ''
      const lines = multi ? prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ')]
      pieces.set(`${libName}.${p.name}`, { lib: libName, name: p.name, lines, multi })
    }
  }
  return { name: json.name, scenes, pieces, notes }
}

// ── NAIS -> model ────────────────────────────────────────────────────

function naisScenes(json) {
  if (Array.isArray(json)) {
    return json.map((s) => ({ name: str(s.scene_name), prompt: str(s.scene_prompt) ?? '' }))
  }
  return json.scenes.filter(isObj).map((s) => ({
    name: str(s.name),
    prompt: str(s.prompt) ?? str(s.scenePrompt) ?? '', // NAIS3 export uses prompt, NAIS2 scenePrompt
    negativePrompt: str(s.negativePrompt),
    width: num(s.width),
    height: num(s.height),
  }))
}

/**
 * Fold consecutive scenes named base_1..base_N (same size) back into one
 * scene with N variants: the inverse of the split above. Same images either way.
 */
export function regroup(scenes) {
  const names = new Set(scenes.map((s) => s.name))
  const out = []
  for (let i = 0; i < scenes.length; ) {
    const m = /^(.*)_1$/.exec(scenes[i].name)
    let j = i + 1
    if (m && !names.has(m[1])) {
      while (
        j < scenes.length &&
        scenes[j].name === `${m[1]}_${j - i + 1}` &&
        scenes[j].width === scenes[i].width &&
        scenes[j].height === scenes[i].height
      ) j++
    }
    if (m && j - i >= 2 && !names.has(m[1])) {
      out.push({ ...scenes[i], name: m[1], prompts: scenes.slice(i, j).flatMap((s) => s.prompts) })
      i = j
    } else {
      out.push(scenes[i])
      i++
    }
  }
  return out
}

/**
 * @param fragments Map<fileName, text> of NAIS fragment files (name.txt contents)
 */
export function readNais(json, { name, fragments = new Map(), bridgeLib = DEFAULT_BRIDGE_LIB, regroup: doRegroup = true, notes = new Notes() } = {}) {
  const pieces = new Map()
  const byNormal = new Map() // normalized fragment name -> real name
  for (const fragName of fragments.keys()) byNormal.set(normalizeName(fragName), fragName)
  const inlines = new Map()

  const ctx = {
    bridgeLib,
    notes,
    resolve(lib, piece, rawName) {
      // Prefer the fragment's real spelling: NAIS matches case-insensitively, SDStudio exactly.
      const real = byNormal.get(normalizeName(rawName)) ?? byNormal.get(normalizeName(rawName.split('/').pop()))
      if (real) [lib, piece] = pieceKey(real, bridgeLib, notes)
      const key = `${lib}.${piece}`
      if (!pieces.has(key)) {
        if (real) addFragment(real, lib, piece)
        else {
          pieces.set(key, { lib, name: piece, lines: [], multi: false, missing: true })
          notes.add('wildcards with no NAIS fragment supplied became empty SDStudio pieces (add the fragments to fill them)', `<${rawName}>`)
        }
      }
      return [lib, piece]
    },
    inline(options) {
      const sig = options.join('\u0000')
      let piece = inlines.get(sig)
      if (!piece) {
        piece = `inline-${inlines.size + 1}`
        inlines.set(sig, piece)
        pieces.set(`${bridgeLib}.${piece}`, { lib: bridgeLib, name: piece, lines: options, multi: true })
      }
      return [bridgeLib, piece]
    },
  }

  function addFragment(fragName, lib, piece) {
    const key = `${lib}.${piece}`
    pieces.set(key, { lib, name: piece, lines: [], multi: false }) // placeholder first: stops self-reference loops
    const lines = fragmentLines(fragments.get(fragName)).map((l) => fromNais(l, ctx))
    pieces.set(key, { lib, name: piece, lines, multi: lines.length > 1 })
  }

  for (const fragName of fragments.keys()) {
    const [lib, piece] = pieceKey(fragName, bridgeLib, notes)
    if (!pieces.has(`${lib}.${piece}`)) addFragment(fragName, lib, piece)
  }

  let scenes = naisScenes(json).map((s, i) => {
    if (s.negativePrompt?.trim()) notes.add('per-scene negative prompts dropped (SDStudio keeps UC on the style preset)', s.name)
    const hasSize = s.width && s.height
    return {
      name: s.name ?? `scene ${i + 1}`,
      prompts: [fromNais(s.prompt, ctx)],
      width: hasSize ? s.width : NAIS_DEFAULT_SIZE[0],
      height: hasSize ? s.height : NAIS_DEFAULT_SIZE[1],
    }
  })
  if (doRegroup) {
    scenes = regroup(scenes)
    for (const s of scenes) {
      if (s.prompts.length > 1) notes.add('name_1..name_N scenes folded into one SDStudio scene with N variants (turn regrouping off to keep them apart)', `${s.name} (${s.prompts.length})`)
    }
  }
  const presetName = (!Array.isArray(json) && str(json.name)) || name || 'Imported scenes'
  return { name: presetName, scenes, pieces, notes }
}

// ── model -> NAIS ────────────────────────────────────────────────────

/** @returns {{ preset: object, fragments: {name: string, text: string}[] }} */
export function writeNais(model, { bridgeLib = DEFAULT_BRIDGE_LIB, now = Date.now(), uuid = () => crypto.randomUUID(), notes = model.notes } = {}) {
  const scenes = []
  for (const s of model.scenes) {
    const variants = s.prompts.length ? s.prompts : ['']
    variants.forEach((prompt, i) => {
      scenes.push({
        id: uuid(),
        name: variants.length > 1 ? `${s.name}_${i + 1}` : s.name,
        scenePrompt: toNais(prompt, { bridgeLib, notes }),
        queueCount: 0,
        images: [],
        width: s.width,
        height: s.height,
        createdAt: now,
      })
    })
  }
  const fragments = []
  for (const p of model.pieces.values()) {
    const name = p.lib === bridgeLib ? p.name : `${p.lib}.${p.name}`
    if (!p.lines.some((l) => l.trim())) {
      notes.add('empty pieces not written as fragments (NAIS keeps the <ref> text when a fragment is missing)', name)
      continue
    }
    const lines = p.lines.map((l) => toNais(l, { bridgeLib, notes }))
    fragments.push({ name: `${name}.txt`, text: lines.join('\n') + '\n' })
  }
  return { preset: { id: String(now), name: model.name, scenes, createdAt: now }, fragments }
}

// ── model -> SDStudio ────────────────────────────────────────────────

function resolutionFor(width, height, notes) {
  for (const [key, [w, h]] of Object.entries(RESOLUTIONS)) {
    if (w === width && h === height) return { resolution: key }
  }
  // SDStudio rounds custom sizes up to a multiple of 64.
  const w = (width + 63) & ~63
  const h = (height + 63) & ~63
  if (w !== width || h !== height) notes.add('custom sizes rounded up to a multiple of 64 (SDStudio requires it)', `${width}x${height} -> ${w}x${h}`)
  return { resolution: 'custom', resolutionWidth: w, resolutionHeight: h }
}

// Shapes follow a project exported by a current SDStudio build (V4 fields included).
function defaultPreset() {
  return {
    type: 'SDImageGen',
    cfgRescale: 0,
    steps: 28,
    promptGuidance: 5,
    smea: false,
    dyn: false,
    sampling: 'k_euler_ancestral',
    frontPrompt: '',
    backPrompt: '',
    uc: '',
    noiseSchedule: 'karras',
    characterPrompts: [],
    useCoords: false,
    legacyPromptConditioning: false,
    name: 'default',
    profile: '',
    backend: { type: 'NAI' },
  }
}

export function writeSdstudio(model, { uuid = () => crypto.randomUUID(), notes = model.notes } = {}) {
  const scenes = {}
  for (const s of model.scenes) {
    let name = s.name
    for (let n = 2; Object.hasOwn(scenes, name); n++) name = `${s.name} (${n})`
    if (name !== s.name) notes.add('duplicate scene names got a (2), (3) suffix', name)
    scenes[name] = {
      name,
      ...resolutionFor(s.width, s.height, notes),
      imageMap: [],
      mains: [],
      type: 'scene',
      slots: [s.prompts.map((prompt) => ({ prompt, id: uuid(), enabled: true }))],
      meta: { SDImageGen: { type: 'SDImageGen' } },
      characterMiddlePrompt: {},
    }
  }
  const library = {}
  for (const p of model.pieces.values()) {
    library[p.lib] ??= { name: p.lib, version: 1, pieces: [] }
    const piece = { name: p.name, prompt: p.lines.join('\n') }
    if (p.multi) piece.multi = true
    library[p.lib].pieces.push(piece)
  }
  return {
    name: model.name,
    version: 1,
    selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'default' },
    presets: { SDImageGen: [defaultPreset()] },
    inpaints: {},
    scenes,
    library,
    presetShareds: { SDImageGen: { type: 'SDImageGen', vibes: [], seed: null } },
  }
}
