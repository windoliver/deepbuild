# deep-show

## What it is for

The canvas side behind deep_show (#393). `deep-show run` plays a scenario of deep_show and `deep show` calls against the hub's canvas side (writer layers, revisions, checks and Vello CPU render-back snapshots), `screen` and `live` draw the window on macOS, and the hub runs `deep-show canvas` long-lived as its canvas core (packages/hub/src/canvas.ts). It also holds the canvas conformance kit (#138), the scheduler's worker threads (#857), terminals (`serve`, `host`, #402) and the other calls the canvas acceptance READMEs name.

## Where new code goes

- `src/main.rs`: subcommands, scenario parsing and the build set's module list (`modules`); each call family in its own module (`hub.rs`, `shared.rs`, `frames.rs`, `snapshot.rs`, `scene3d.rs`, `input.rs`, `ring.rs`, `terminal.rs`, `packs.rs`, `verdict.rs`, `capture.rs` and the rest).
- `src/kit/`: the conformance kit's parts; its test canvas modules go in `src/kit/modules.rs`, each under its own `test-kit-*` feature.
- Test canvas modules and planted twins that need statics or threads live here behind a `test-*` feature (`src/planted.rs`, `src/test_threads.rs`, `src/twins.rs`); others go in crates/deep-canvas-test-modules.
- Tests: `#[cfg(test)]` modules beside the code, `tests/*.rs` driving `deep-show run`, and the acceptance suites in tests/acceptance/<issue>.
- Generated, never hand-edited: `kit-ledger.json` (by `node scripts/canvas-kit.mjs`) and `schedule/modules/*.json` (by the kit's `schedule` part under `DEEP_KIT_WRITE_SCHEDULE`, when missing). `schedule/<set>.json` are committed snapshots of the sealed plan; a test in `src/main.rs` fails and prints the plan when they drift.
- Canvas logic (operators, checks, the scheduler's plan) belongs in the deep-canvas* crates; this crate hosts, threads and draws it.

## What it may import

The canvas's host binary at the top of the Rust stack: every canvas crate, deep-gpu and the render crates, deep-marks-vello and deep-text, and on macOS deep-replica, deep-text-gpui and GPUI, each by crate name; libc for terminals' PTYs and processes. It draws canvas text (`canvas_text = true`), so scripts/text-lint.mjs holds it to the canvas's shaper, never GPUI's text system.

## Deviations

- `build.rs`: embeds the kit's ledger (`DEEP_KIT_LEDGER`, else `kit-ledger.json`) so a release build's seal refuses every canvas module the kit didn't pass, and records the Cargo profile and toolchain the `costs` call reports.
- `src/workers.rs`: the scheduler's worker threads live here because the canvas core starts no thread and reads no machine.
- `src/kit/modules.rs`: the kit's test canvas modules live here, not in deep-canvas-test-modules, because some keep values in statics, which the canvas lint keeps out of every deep-canvas* crate.
- `src/planted.rs`: #387's planted operator reads the look's accent from a static, which the canvas lint keeps out of the deep-canvas* crates, so it lives here under `test-accent`.
- `src/main.rs`: the counting global allocator (an `unsafe impl` over the system allocator) counts allocations only while a count is on, for #387's "the scheduler allocates nothing per frame after warm-up".
