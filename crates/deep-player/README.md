# deep-player

## What it is for

The web player (issue #172; canvas primitives: Export: web player): the canvas core built for wasm32 on one thread. It seals the canvas modules it carries, loads a bundle's document and the files it names by hash, plays it on its recorded input track as the app does (physics in process on the pinned backend, logic on the browser's own WebAssembly engine running the programs the app rewrote, the GPU layer on WebGPU, 2D writer layers by Vello CPU), and answers `probe()`.

`node scripts/player-wasm.mjs` builds it and writes `web/dist/` (the module, its page glue and `player.json`). That folder is committed and the export embeds its bytes, so nothing compiles per export and every machine writes the same bundle.

It ships as a few fixed module sets (#1490), each a Cargo feature of its name and built into `web/dist/<set>/`: `figure` (text, look, marks2d, data, motion and input), `game2d` (adds physics, and logic on sandbox) and `full` (every module it carries, with the GPU layer and the 3D renderer). `web/dist/sets.json` records each set's compressed size, smallest first; the export takes the smallest set that holds every module a document uses.

## Where new code goes

- `src/seal.rs`: the module set the player carries, by its set's feature.
- `src/page.rs`: the player's surface to its index page (members, events, `probe()`).
- `src/cxx.rs`: C++'s allocation operators for the 3D module's mesh simplifier on wasm32.

## What it may import

The canvas crates and their shipped modules, `deep-logic`, `deep-physics-rapier`, `deep-text`, and the page bindings (`wasm-bindgen`, `js-sys`). Never `deep-show`, the hub, the record or anything that reaches the machine.

## Deviations

- Outside the canvas lint's scope: its page glue needs `extern` exports and `cfg(target_arch)`. Every value a check reads is computed by the canvas crates it links.
