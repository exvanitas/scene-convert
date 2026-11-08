import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertFiles, loadFragments } from '../src/convert.mjs'
import { detect, readNais, readSdstudio, regroup, slotCombinations, writeNais, writeSdstudio } from '../src/formats.mjs'
import { sdstudioRefs } from '../src/syntax.mjs'
import { fromUtf8, readZip, writeZip } from '../src/zip.mjs'

const json = (bytes) => JSON.parse(fromUtf8(bytes))

let n = 0
const fixed = { now: 1700000000000, uuid: () => `id-${++n}` }
const file = (name, json) => ({ name, data: Buffer.from(JSON.stringify(json)) })
const piece = (prompt, enabled) => ({ prompt, id: `p${++n}`, ...(enabled === undefined ? {} : { enabled }) })
const sdScene = (name, slots, extra = {}) => ({ name, resolution: 'portrait', imageMap: [], mains: [], type: 'scene', slots, meta: {}, characterMiddlePrompt: {}, ...extra })

function sdProject(scenes, library = {}) {
  return {
    name: 'proj',
    version: 1,
    presets: { SDImageGenEasy: [{ type: 'SDImageGenEasy', name: 'style', frontPrompt: 'a', backPrompt: 'b', uc: 'c' }] },
    inpaints: {},
    scenes: Object.fromEntries(scenes.map((s) => [s.name, s])),
    library,
    presetShareds: {},
  }
}

const naisPreset = (scenes) => ({
  id: '1',
  name: 'Emotions',
  scenes: scenes.map(([name, scenePrompt, size], i) => ({ id: String(i), name, scenePrompt, queueCount: 0, images: [], createdAt: 1, ...(size ? { width: size[0], height: size[1] } : {}) })),
  createdAt: 1,
})

/** Every <...> word must resolve the way SDStudio's tryExpandPiece does. */
function assertRefsResolve(project) {
  const lines = []
  for (const s of Object.values(project.scenes)) for (const slot of s.slots) for (const p of slot) lines.push(p.prompt)
  for (const lib of Object.values(project.library)) for (const p of lib.pieces) lines.push(...p.prompt.split('\n'))
  for (const line of lines) {
    for (const ref of sdstudioRefs(line)) {
      const [lib, name, extra] = ref.split('.')
      assert.equal(extra, undefined, `bad piece syntax <${ref}>`)
      assert.ok(project.library[lib]?.pieces.some((p) => p.name === name), `unresolved <${ref}>`)
    }
  }
}

test('detect tells the formats apart', () => {
  assert.equal(detect(sdProject([])), 'sdstudio')
  assert.equal(detect(naisPreset([])), 'nais')
  assert.equal(detect({ version: 1, scenes: [{ name: 'a', prompt: 'b' }] }), 'nais')
  assert.equal(detect([{ scene_name: 'a', scene_prompt: 'b' }]), 'nais')
  assert.equal(detect({ hello: 1 }), null)
})

test('slotCombinations: first slot varies slowest, disabled and empty slots skipped', () => {
  const slots = [[piece('a'), piece('b')], [piece('x', false)], [piece('1', true), piece('2')]]
  assert.deepEqual(slotCombinations(slots), ['a, 1', 'a, 2', 'b, 1', 'b, 2'])
  assert.deepEqual(slotCombinations([]), [''])
})

test('SDStudio -> NAIS: variants split into name_N scenes with explicit sizes', () => {
  const project = sdProject([
    sdScene('one', [[piece('solo')]]),
    sdScene('many', [[piece('a'), piece('b', false), piece('c')]], { resolution: 'landscape' }),
    sdScene('odd', [[piece('x')]], { resolution: 'custom', resolutionWidth: 640, resolutionHeight: 1536 }),
  ])
  const model = readSdstudio(project)
  const { preset } = writeNais(model, fixed)
  assert.deepEqual(preset.scenes.map((s) => [s.name, s.scenePrompt, s.width, s.height]), [
    ['one', 'solo', 832, 1216],
    ['many_1', 'a', 1216, 832],
    ['many_2', 'c', 1216, 832],
    ['odd', 'x', 640, 1536],
  ])
  const messages = model.notes.list().map((n) => n.message)
  assert.ok(messages.some((m) => m.startsWith('disabled')))
  assert.ok(messages.some((m) => m.startsWith('style presets')))
})

test('SDStudio -> NAIS: libraries become fragment files, bridge library unprefixed', () => {
  const project = sdProject([sdScene('s', [[piece('<nais.eyes>, <char.hair>, smile')]])], {
    nais: { name: 'nais', version: 1, pieces: [{ name: 'eyes', prompt: 'blue eyes\nred eyes', multi: true }] },
    char: { name: 'char', version: 1, pieces: [{ name: 'hair', prompt: 'long hair\nponytail' }, { name: 'empty', prompt: '' }] },
  })
  const { preset, fragments } = writeNais(readSdstudio(project), fixed)
  assert.equal(preset.scenes[0].scenePrompt, '<eyes>, <char.hair>, smile')
  assert.deepEqual(fragments, [
    { name: 'eyes.txt', text: 'blue eyes\nred eyes\n' },
    { name: 'char.hair.txt', text: 'long hair, ponytail\n' }, // not multi: one line, so NAIS can't pick half
  ])
})

test('NAIS -> SDStudio: sizes map to SDStudio resolutions, unknown sizes go custom', () => {
  const model = readNais(naisPreset([['a', 'x'], ['b', 'y', [1024, 1024]], ['c', 'z', [700, 1300]]]))
  const project = writeSdstudio(model, fixed)
  const s = project.scenes
  assert.equal(s.a.resolution, 'portrait')
  assert.equal(s.b.resolution, 'square')
  assert.deepEqual([s.c.resolution, s.c.resolutionWidth, s.c.resolutionHeight], ['custom', 704, 1344])
})

test('NAIS -> SDStudio: name_1..N folds back into one scene; --no-regroup keeps them', () => {
  const scenes = [['run_1', 'a'], ['run_2', 'b'], ['run_3', 'c'], ['solo_1', 'd'], ['x', 'e'], ['x', 'f']]
  const grouped = writeSdstudio(readNais(naisPreset(scenes)), fixed)
  assert.deepEqual(Object.keys(grouped.scenes), ['run', 'solo_1', 'x', 'x (2)'])
  assert.deepEqual(grouped.scenes.run.slots[0].map((p) => p.prompt), ['a', 'b', 'c'])
  const apart = writeSdstudio(readNais(naisPreset(scenes), { regroup: false }), fixed)
  assert.equal(Object.keys(apart.scenes).length, 6)
})

test('regroup leaves a run alone when its base name is already a scene or sizes differ', () => {
  const s = (name, w = 832) => ({ name, prompts: [name], width: w, height: 1216 })
  assert.equal(regroup([s('a'), s('a_1'), s('a_2')]).length, 3)
  assert.equal(regroup([s('b_1'), s('b_2', 1024)]).length, 2)
})

test('NAIS -> SDStudio: fragments fill pieces; missing ones become empty pieces', () => {
  const fragments = new Map([
    ['Eyes', 'blue eyes\n# comment\nred eyes\n'],
    ['mood', 'happy, <eyes>'],
  ])
  const model = readNais(naisPreset([['s', '<eyes>, <MOOD>, <folder/eyes>, <hat>']]), { fragments })
  const project = writeSdstudio(model, fixed)
  assert.equal(project.scenes.s.slots[0][0].prompt, '<nais.Eyes>, <nais.mood>, <nais.Eyes>, <nais.hat>')
  assert.deepEqual(project.library.nais.pieces, [
    { name: 'Eyes', prompt: 'blue eyes\nred eyes', multi: true },
    { name: 'mood', prompt: 'happy, <nais.Eyes>' },
    { name: 'hat', prompt: '' },
  ])
  assertRefsResolve(project)
  assert.ok(model.notes.list().some((n) => n.message.startsWith('wildcards with no NAIS fragment') && n.examples[0] === '<hat>'))
})

test('a self-referencing fragment does not loop', () => {
  const model = readNais(naisPreset([['s', '<loop>']]), { fragments: new Map([['loop', 'a, <loop>']]) })
  assert.equal(model.pieces.get('nais.loop').lines[0], 'a, <nais.loop>')
})

test('round trip NAIS -> SDStudio -> NAIS keeps every name and prompt', async () => {
  const original = naisPreset([
    ['angry', '<eyes>, {{angry}}, clenched teeth'],
    ['pose_1', 'standing'],
    ['pose_2', 'sitting, <char.hair>'],
    ['wide', 'scenery', [1216, 832]],
  ])
  const fragments = new Map([['eyes', 'blue eyes\nred eyes'], ['char.hair', 'long hair']])
  const sd = (await convertFiles([file('in.json', original)], { fragments, ...fixed })).results[0]
  const project = json(sd.outputs[0].data)
  assertRefsResolve(project)
  const back = (await convertFiles([{ name: 'p.json', data: sd.outputs[0].data }], fixed)).results[0]
  const preset = json(back.outputs[0].data)
  assert.deepEqual(preset.scenes.map((s) => [s.name, s.scenePrompt]), original.scenes.map((s) => [s.name, s.scenePrompt]))
  const frag = await loadFragments([{ name: 'f.zip', data: back.outputs[1].data }])
  assert.deepEqual([...frag], [['eyes', 'blue eyes\nred eyes\n'], ['char.hair', 'long hair\n']])
})

test('round trip SDStudio -> NAIS -> SDStudio keeps scenes, sizes and variants', async () => {
  const original = sdProject([
    sdScene('a', [[piece('x'), piece('y', true)]], { resolution: 'square' }),
    sdScene('b', [[piece('z')]], { resolution: 'custom', resolutionWidth: 640, resolutionHeight: 1536 }),
  ])
  const nais = (await convertFiles([file('p.json', original)], fixed)).results[0]
  const back = json((await convertFiles([{ name: 'n.json', data: nais.outputs[0].data }], fixed)).results[0].outputs[0].data)
  const view = (p) => Object.values(p.scenes).map((s) => [s.name, s.resolution, s.resolutionWidth, s.slots.flat().map((x) => x.prompt)])
  assert.deepEqual(view(back), view(original))
})

test('convertFiles opens zips and honours --to', async () => {
  const zip = writeZip([
    { name: 'a.json', data: JSON.stringify(naisPreset([['s', 'x']])) },
    { name: 'b.json', data: JSON.stringify(sdProject([sdScene('t', [[piece('y')]])])) },
    { name: 'readme.txt', data: 'ignored' },
  ])
  const all = (await convertFiles([{ name: 'bundle.zip', data: zip }], fixed)).results
  assert.deepEqual(all.map((r) => r.to), ['sdstudio', 'nais'])
  const only = (await convertFiles([{ name: 'bundle.zip', data: zip }], { to: 'nais', ...fixed })).results
  assert.deepEqual(only.map((r) => r.skipped ?? r.to), ['already nais', 'nais'])
})

test('NAIS3 export (no preset name) takes its name from the file', async () => {
  const r = (await convertFiles([file('nais3-scenes.json', { version: 1, scenes: [{ name: 'a', prompt: 'b', negativePrompt: 'bad', width: 832, height: 1216 }] })], fixed)).results[0]
  assert.equal(r.outputs[0].name, 'nais3-scenes.sdstudio.json')
  assert.ok(r.notes.some((x) => x.message.startsWith('per-scene negative')))
})

test('fragment zip from writeNais is a valid zip of txt files', async () => {
  const project = sdProject([], { nais: { name: 'nais', version: 1, pieces: [{ name: '눈', prompt: 'a\nb', multi: true }] } })
  const r = (await convertFiles([file('p.json', project)], fixed)).results[0]
  assert.equal(r.outputs[1].name, 'proj.fragments.zip')
  assert.deepEqual((await readZip(r.outputs[1].data)).map((e) => [e.name, fromUtf8(e.data)]), [['눈.txt', 'a\nb\n']])
})
