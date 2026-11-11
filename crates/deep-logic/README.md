# deep-logic

## What it is for

The logic module, `logic@1` (#531, #532; design: The logic module): a logic item's program, by hash, checked and rewritten by sandbox@1 in the role `logic` and stepped at its own rate, with its read and write regions, its step seed, traps that freeze only its item, checkpoints, restores, bakes, goldens, `logic.determinism` and `logic.budget`, and (#544) the occurrences it emits: its `emits` kinds, copied from the emit region at `emits_at` after each step into its occurrence list. The `deep-logic` binary serves it as JSON lines, one reply per line, and is the proof surface the #531 and #532 acceptance READMEs name. deep-show steps its world on the transport's clock in a live play, and bakes a document's logic items into the occurrence lists Spawn and motion read. `web/logic.mjs` is the web player's runtime for the same rewritten bytes.

## Where new code goes

- `src/piece.rs`: a piece's logic items and their check; `src/world.rs`: the steps, regions, seeds and traps.
- `src/checks.rs`: `logic.determinism`; `src/budget.rs`: `logic.budget` and its calibration programs; `src/judder.rs`: `logic.judder`, an issue at check (#545); `src/live.rs`: a live view with no bake, its open span and what a frame draws.
- `src/lines.rs`: source lines through a program's debug sidecar.
- `src/lib.rs`: the JSON calls, bakes and bake keys; `src/main.rs`: the command line and `--planted`.
- The browser's runtime goes in `web/logic.mjs`; it has no turn clock yet, so `web_plan` refuses `clock: on_input` by name. The acceptance tests are in `tests/acceptance/531`, `532`, `544` and `545`.

## What it may import

`deep-canvas` for a step rate's step length, `deep-canvas-sandbox` for the check and the rewrite, `deep-sandbox-wasmtime` for the pinned engine's version and the web runner, `wasmtime` at `=49.0.2` and `wasmparser` at the versions those two pin, `addr2line` and `gimli` for source lines, `wat` for the calibration programs, `libc` for thread CPU time, and `base64`, `serde_json` and `sha2`. Like deep-sandbox-wasmtime it is outside the canvas lint's scope: every value a check reads is what the rewritten program computes, never this crate's own arithmetic.

## Deviations

None.
