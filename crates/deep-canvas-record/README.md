# deep-canvas-record

## What it is for

The record canvas module (issues #394 and #383, `salience@1`): which items a level shows, ranked by record facts with no model, the rest folded into one counted line, and zoom into a part of the Map. It draws nothing; deep-show and deep-gpu-layer register the module, and the `deep-salience` binary (`level`, `zoom`) is its proof surface.

## Where new code goes

- Ranking, the hold and the fold go in `src/lib.rs`.
- Zooming into a Map part and the level rule go in `src/zoom.rs`.
- The manifest and the per-item operator go in `src/module.rs`; CLI subcommands in `src/main.rs`.
- Tests go in `tests/` (`tests/hold.rs`); the acceptance tests are in `tests/acceptance/394` and `tests/acceptance/383`.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`, under `scripts/canvas-lint.mjs`. It reads record facts as data handed to it; it never imports the record package, the hub, a GPU crate or the app.

## Deviations

- `src/main.rs`: built as the `deep-salience` binary, not `deep-canvas-record`, because that name is the surface the #394 and #383 acceptance READMEs name.
