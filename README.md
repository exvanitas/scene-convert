# scene-convert

Converts NovelAI scene presets between SDStudio and NAIS2/NAIS3, both ways. Node 22, no dependencies.

**Use it in your browser: https://util.exvanitas.ai/scene-convert/** (files are read locally and never uploaded).

```
node bin/scene-convert.mjs <file.json|bundle.zip>... [-o DIR] [-f fragments.zip]
```

Direction comes from the file's content:

| in | out | load it with |
|---|---|---|
| SDStudio project `.json` | `<name>.nais.json` | NAIS2: scene mode, import (new preset). NAIS3: scene panel, import JSON (adds to the open preset) |
| | `<name>.fragments.zip` (only if the project has pieces) | NAIS3: fragments, import txt/zip |
| NAIS2 preset, NAIS3 scene export, or legacy `scene_preset_export.json` | `<name>.sdstudio.json` | SDStudio: drop the file in, new project or "scenes only" into the current one |

Zips are opened and every `.json` inside is converted. Existing outputs are kept unless `--force`.

## How things map

- **Variants.** An SDStudio scene with N variants in its slots becomes N NAIS scenes `name_1..name_N`, the same split NAIS2/NAIS3 make when they import SDStudio files. SDStudio queues every variant, so the images are the same. Going back, consecutive `name_1..name_N` scenes fold into one SDStudio scene again (`--no-regroup` to stop that).
- **Sizes.** SDStudio resolution names map to their exact sizes; anything else becomes SDStudio `custom` (rounded up to 64, as SDStudio does). NAIS output always carries width/height, because NAIS2 would otherwise use its main resolution.
- **Wildcards.** SDStudio only accepts `<library.piece>`. NAIS `<eyes>` becomes `<nais.eyes>` (library name via `--lib`) and goes back to `<eyes>`. Other `<lib.piece>` refs stay as they are; their NAIS fragment is named `lib.piece`, which NAIS3 resolves as written. Pass NAIS fragments with `-f` (a NAIS3 "export all fragments" zip or `.txt` files) to fill the pieces; without them the pieces are created empty and listed in the notes.
- **Fragment lines.** A NAIS fragment picks one random line, which is SDStudio's `multi` piece. Non-multi pieces are written as one line so NAIS can't pick half of one.

## What does not carry over

Printed as notes on each run:

- SDStudio style presets and character prompts. NAIS3 can only load presets through its NAIS2 backup import, which replaces all existing presets.
- Disabled SDStudio variants, inpaint scenes, per-scene character middle prompts, images.
- NAIS per-scene negative prompts, `# comment` lines (dropped), `<*sequential>` refs (become random), `<a|b>` inline picks (become generated multi pieces), `a/b` and `(a/b)` slash picks (left as text).
- The other way, text NAIS would read as syntax: lines starting with `#`, `a/b` tags.

## Web page

The same code runs in the browser at util.exvanitas.ai/scene-convert/. `npm run build` writes `dist/site/` (the static site, one self-contained HTML file per page) and `dist/preview/` (a fragment for a claude.ai preview). Pages carry a CSP with `default-src 'none'` and `connect-src 'none'`, so a file opened there can't be sent anywhere; scripts and styles are pinned by hash. The display face, IM Fell English, is embedded (`web/fonts/`, SIL OFL).


## Tests

`npm test`: unit tests, round trips, and a build check (bundle parses, CSP hashes match, no off-site references). Fixtures are synthetic.

Link-preview images and icons are rendered by `web/make-images.mjs` (needs Playwright; output committed in `web/assets/`).

Formats were read from SDStudio (github.com/sunho/SDStudio, public source stops at Aug 2024; the V4 fields follow a current SDStudio export), NAIS2 `src/stores/scene-store.ts`, and NAIS3 `src/main/scenes/import-formats.ts`, `src/main/fragments/`.
