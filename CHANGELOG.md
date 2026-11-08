# Changelog

Newest first. Every change that goes live on util.exvanitas.ai gets a version, an entry here and a GitHub release.

## 0.1.0 (2026-11-08)

First release.

- Converts NovelAI scene presets between SDStudio projects and NAIS2/NAIS3 scene files, both ways.
- Command line: `node bin/scene-convert.mjs <file.json|bundle.zip>...`. The direction comes from each file, and zips are opened.
- Browser page at https://util.exvanitas.ai/scene-convert/. Files are read locally and never uploaded; the page's content policy blocks every network request. It opens empty, with no example files.
- SDStudio scenes with several variants become numbered NAIS scenes (`name_1` to `name_N`), the same split NAIS makes on its own import, and fold back on the way home.
- Sizes map to SDStudio's named resolutions, or to a custom size rounded up to 64.
- Wildcards: NAIS `<name>` becomes SDStudio `<nais.name>` and back. NAIS fragment files fill SDStudio pieces, and SDStudio pieces come out as a NAIS fragment zip.
- Each conversion lists what did not carry over: style presets, disabled variants, inpaint scenes, per-scene negatives, comment lines.
- Link previews and icons for both pages.
- Links from the page to this repository, and from the repository to the page.
- MIT license. The embedded display face, IM Fell English, keeps its SIL Open Font License.
