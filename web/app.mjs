// Page wiring. Bundled after the src modules by web/build.mjs, so names here
// must not clash with theirs.
import { convertFiles, loadFragments } from '../src/convert.mjs'
import { writeZip } from '../src/zip.mjs'

const byId = (id) => document.getElementById(id)

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid)
  return node
}

const state = { scenes: [], fragments: [], outputs: [] }

const kib = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const appName = { sdstudio: 'SDStudio', nais: 'NAIS' }

function saveFile(name, bytes) {
  const type = name.endsWith('.zip') ? 'application/zip' : 'application/json'
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = el('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function entryFor(result) {
  const way = `${appName[result.from]} to ${appName[result.to]}`
  const cut = result.input.indexOf('.zip:') // zip members are labelled "bundle.zip:inner.json"
  const file = cut < 0 ? result.input : result.input.slice(0, cut + 4)
  const inner = cut < 0 ? undefined : result.input.slice(cut + 5)
  return el(
    'article',
    { class: 'entry' },
    el(
      'div',
      { class: 'entry-top' },
      el('h3', { class: 'entry-name' }, inner ?? file),
      inner ? el('div', { class: 'entry-from' }, `from ${file}`) : null,
      el(
        'div',
        { class: 'tally' },
        el('span', { class: 'way' }, way),
        el('span', { class: 'num' }, `${result.scenesIn} `, el('em', {}, '→'), ` ${result.scenesOut}`),
        el('span', { class: 'way' }, 'scenes'),
      ),
    ),
    el(
      'ul',
      { class: 'outputs' },
      result.outputs.map((o) =>
        el('li', {}, el('button', { type: 'button', onclick: () => saveFile(o.name, o.data), 'aria-label': `Download ${o.name}` }, 'Download'), el('code', {}, o.name), el('span', { class: 'size' }, kib(o.data.length))),
      ),
    ),
    result.notes.length
      ? el(
          'ul',
          { class: 'notes', 'aria-label': 'What did not carry over' },
          result.notes.map((n) => el('li', {}, el('span', { class: 'n' }, `${n.count}×`), el('span', {}, n.message, n.examples.length ? el('span', { class: 'ex' }, n.examples.join('  ·  ')) : null))),
        )
      : el('div', { class: 'notes' }, 'Everything carried over.'),
  )
}

function failEntry(name, message) {
  return el('article', { class: 'entry fail' }, el('h3', { class: 'entry-name' }, name), el('div', { class: 'msg' }, message))
}

async function render() {
  const libInput = byId('lib-input')
  const bridgeLib = libInput.value.trim() || 'nais'
  const libOk = /^[^.<>\s]+$/.test(bridgeLib)
  byId('lib-bad').hidden = libOk
  libInput.setAttribute('aria-invalid', String(!libOk))
  if (!libOk) return

  const empty = state.scenes.length === 0
  byId('ledger').hidden = empty
  byId('scene-loaded').hidden = empty
  byId('scene-loaded').textContent = empty ? '' : `${state.scenes.length} file${state.scenes.length === 1 ? '' : 's'}: ${state.scenes.map((f) => f.name).join(', ')}`

  const entries = byId('entries')
  let fragments = new Map()
  try {
    fragments = await loadFragments(state.fragments)
  } catch (e) {
    byId('ledger').hidden = false
    entries.replaceChildren(failEntry('Fragments', `${e.message}. Use .txt files or a zip of them.`))
    return
  }
  const fragLoaded = byId('frag-loaded')
  fragLoaded.hidden = state.fragments.length === 0
  fragLoaded.textContent = `${fragments.size} fragment${fragments.size === 1 ? '' : 's'}: ${[...fragments.keys()].slice(0, 8).join(', ')}${fragments.size > 8 ? ', …' : ''}`

  const nodes = []
  state.outputs = []
  if (empty) {
    entries.replaceChildren()
    byId('all-button').hidden = true
    return
  }
  for (const file of state.scenes) {
    try {
      const { results } = await convertFiles([file], { fragments, bridgeLib, regroup: byId('regroup-input').checked })
      for (const r of results) {
        nodes.push(entryFor(r))
        state.outputs.push(...r.outputs)
      }
    } catch (e) {
      nodes.push(failEntry(file.name, `${e.message}. Expected an SDStudio project or a NAIS2/NAIS3 scene export.`))
    }
  }
  entries.replaceChildren(...(nodes.length ? nodes : [el('div', { class: 'empty-note' }, 'No scene files found.')]))
  const all = byId('all-button')
  all.hidden = state.outputs.length < 2
  all.textContent = `Download all (${state.outputs.length} files, .zip)`
}

function downloadAll() {
  const used = new Set()
  const files = state.outputs.map((o) => {
    let name = o.name
    for (let n = 2; used.has(name); n++) name = o.name.replace(/(\.[a-z]+)?\.(json|zip)$/, ` (${n})$&`)
    used.add(name)
    return { name, data: o.data }
  })
  saveFile('scene-convert.zip', writeZip(files))
}

async function readPicked(fileList) {
  return Promise.all([...fileList].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
}

function wireTray(trayId, inputId, key) {
  const tray = byId(trayId)
  const input = byId(inputId)
  const take = async (list) => {
    if (!list?.length) return
    state[key] = await readPicked(list)
    await render()
  }
  input.addEventListener('change', () => take(input.files).finally(() => (input.value = '')))
  tray.addEventListener('dragover', (e) => {
    e.preventDefault()
    tray.classList.add('over')
  })
  tray.addEventListener('dragleave', () => tray.classList.remove('over'))
  tray.addEventListener('drop', (e) => {
    e.preventDefault()
    tray.classList.remove('over')
    take(e.dataTransfer?.files)
  })
}

wireTray('scene-tray', 'scene-input', 'scenes')
wireTray('frag-tray', 'frag-input', 'fragments')
byId('lib-input').addEventListener('input', render)
byId('regroup-input').addEventListener('change', render)
byId('all-button').addEventListener('click', downloadAll)
// A file dropped outside a tray would otherwise navigate away from the page.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())
render()
