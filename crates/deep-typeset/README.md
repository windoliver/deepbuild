# deep-typeset

## What it is for

The typeset job's first tool, `typst-mitex` (#220; canvas primitives: Asset job: typeset): a formula's LaTeX or Typst source in, an SVG with one `<g id>` per part and its probe out. LaTeX goes through mitex 0.2.7 to Typst; Typst 0.15.1 sets every part as one formula, each part tagged by its fill, so parting a formula moves none of its glyphs. It is built to WebAssembly by `node scripts/typeset-wasm.mjs` and run by `packages/jobs/typeset/tool/typeset.mjs`, outside the canvas core.

## Where new code goes

- `src/parts.rs`: part ids, fragments, parts that split a term, and conversion to Typst.
- `src/world.rs`: the Typst world (one main file, mitex's scope files, the fonts handed in).
- `src/svg.rs`: the outline-only SVG.
- `src/lib.rs`: the job's params, the main file, the probe and the WebAssembly calls.

## What it may import

Typst, mitex, `ttf-parser` and `serde_json`; nothing of DeepBuild's, since it runs as a job tool.

## Deviations

- `mitex/` holds mitex's Typst scope files unchanged, with their Apache-2.0 licence.
