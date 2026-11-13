# deep-synth-job

## What it is for

A score's synth instrument rendered offline (#204; canvas primitives: Synth `synth@1`, As built): one note of a pack's synth preset rendered by the media module's own preset and voice code, so a `score.render` stem sounds as the live synth does. It is built to WebAssembly by `node scripts/synth-wasm.mjs` and called once a note by `packages/jobs/score/tool/synth.mjs`, outside the canvas core.

## Where new code goes

- `src/lib.rs`: the note's request, its render, and the WebAssembly calls.

## What it may import

`deep-canvas-media` by crate name, for its `synth` module, and `serde_json`. Nothing else of DeepBuild's: it runs as a job tool.

## Deviations

- `src/lib.rs`: the WebAssembly calls hand memory across the C ABI with `unsafe`, as deep-typeset's do; the node code they call stays in the media module under the canvas lint.
