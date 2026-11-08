#!/usr/bin/env node
// scene-convert: SDStudio projects <-> NAIS2/NAIS3 scene presets.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { convertFiles, loadFragments } from '../src/convert.mjs'

const HELP = `usage: scene-convert <file...> [options]

Converts each input to the other format. Direction is detected from content:
  SDStudio project .json  ->  <name>.nais.json (+ <name>.fragments.zip if it has pieces)
  NAIS2/NAIS3 scene .json ->  <name>.sdstudio.json
Zips are opened and every .json inside is converted.

options:
  -o, --out DIR         output folder (default: next to each input)
  -f, --fragments PATH  NAIS fragment .txt files or a zip of them, to fill <wildcards>
                        when going to SDStudio (repeatable)
      --to FORMAT       only convert inputs that would become FORMAT (nais|sdstudio)
      --lib NAME        SDStudio library that bare NAIS <name> refs map to (default: nais)
      --no-regroup      keep name_1..name_N NAIS scenes as separate SDStudio scenes
      --force           overwrite existing output files
  -h, --help`

async function main(argv) {
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        fragments: { type: 'string', short: 'f', multiple: true },
        to: { type: 'string' },
        lib: { type: 'string', default: 'nais' },
        'no-regroup': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (e) {
    console.error(`${e.message}\n\n${HELP}`)
    return 2
  }
  const { values: opt, positionals } = args
  if (opt.help || positionals.length === 0) {
    console.log(HELP)
    return opt.help ? 0 : 2
  }
  if (opt.to && !['nais', 'sdstudio'].includes(opt.to)) {
    console.error('--to must be nais or sdstudio')
    return 2
  }
  if (!/^[^.<>\s]+$/.test(opt.lib)) {
    console.error('--lib must be a plain name (no dots, spaces or <>)')
    return 2
  }

  const read = (p) => ({ name: p, data: readFileSync(p) })
  const fragments = await loadFragments((opt.fragments ?? []).map(read))
  if (opt.fragments?.length) console.log(`loaded ${fragments.size} fragment${fragments.size === 1 ? '' : 's'}`)

  let failed = false
  for (const path of positionals) {
    let results
    try {
      ;({ results } = await convertFiles([read(path)], { to: opt.to, fragments, bridgeLib: opt.lib, regroup: !opt['no-regroup'] }))
    } catch (e) {
      console.error(`error: ${e.message}`)
      failed = true
      continue
    }
    const outDir = resolve(opt.out ?? dirname(path))
    for (const r of results) {
      if (r.skipped) {
        console.log(`${r.input}: skipped (${r.skipped})`)
        continue
      }
      console.log(`${r.input}: ${r.from} -> ${r.to}, ${r.scenesIn} scenes in, ${r.scenesOut} out`)
      for (const o of r.outputs) {
        const dest = join(outDir, o.name)
        if (existsSync(dest) && !opt.force) {
          console.error(`  not written, exists: ${dest} (use --force)`)
          failed = true
          continue
        }
        mkdirSync(outDir, { recursive: true })
        writeFileSync(dest, o.data)
        console.log(`  wrote ${dest}`)
      }
      for (const n of r.notes) {
        const ex = n.examples.length ? `: ${n.examples.join(' | ')}` : ''
        console.log(`  note: ${n.message} [${n.count}]${ex}`)
      }
    }
  }
  return failed ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
