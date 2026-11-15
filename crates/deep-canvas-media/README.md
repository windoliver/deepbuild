# deep-canvas-media

## What it is for

The media module, `media@1` (#499; design: The media module): sound and video on the picture's clock. Strips on tracks are summed into buses per 128-sample block, a bus's processors (`eq`, `reverb`, `compressor`, `limiter`, `delay`, `pitch`) checkpoint their state on a ring so a seek equals a play bit for bit on one build and CPU architecture, buses send to buses with latency compensated across parallel paths, the master ends in a true-peak limiter (#1818), emitters take their gain and pan from the listener, and a video's frame at t is the one whose presentation interval holds the source time. deep-show registers the module and plays it; deep-marks-render reads a video item's times and its frame at t through it.

## Where new code goes

- `src/module.rs`: the module's manifest, what it registers and its kit; `src/fixtures.rs`: its fixtures.
- `src/mix.rs`: strips, buses, sends and the block loop; `src/eq.rs`, `src/reverb.rs`, `src/dynamics.rs` (compressor and limiter) and `src/delay.rs` (delay and pitch): the processors; `src/ring.rs`: the checkpoint ring.
- `src/synth/` (#204): live synthesis, `synth@1`. `preset.rs` reads a preset over the closed node list and orders it; `voice.rs` renders a voice's nodes a block at a time with no allocation, its sine our own polynomial on a u64 phase; `check.rs` derives the tail and runs the pack check's sweep; `play.rs` is a synth strip as the mix plays it, its params read just before each block and ramped across it, with its own checkpoint ring; `mod.rs` declares `synth.preset@1` with its kit and reads a pack's `presets`. deep-show compiles a synth's params (t, channels, logic arrays, an occurrence's fields) into functions of document time; `crates/deep-synth-job` builds this code to wasm32 for `score.render`.
- `src/emitter.rs`: an emitter's gain and pan; `src/clock.rs`: the audio clock; `src/frames.rs`: a video's frame at t; `src/doc.rs`: the fields read from a document.
- `src/analysis/`: the analysis bakes; `src/analysis/model.rs` (#1819): the tempo, speech spans and visemes read from a model's record, which a runner job makes and this crate never runs; `src/analysis/generated.rs` (#935): audio.gen's measures (bars, seam, stems' residual, takes' distances, a short take's level, leading silence), which deep-show's `media_gen` holds to the design's limits.
- The acceptance tests are in `tests/acceptance/499`, `tests/acceptance/1818`, `tests/acceptance/1819`, `tests/acceptance/935` and `tests/acceptance/204`. Decoding is deep-codecs', and drawing a frame is deep-marks-render's, not this crate's.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and the 3D module's bell emitter, a fixture of its kit, through `deep-canvas-scene3d`, by crate name only, plus `serde_json` and `sha2`. Its name puts it under `scripts/canvas-lint.mjs`: every transcendental goes through deep-canvas's `ops` module on pinned libm. No GPU crate, no codec, no app.

## Deviations

- `src/lib.rs`: the planted name for #499's AC10 is held in a static (`PLANTED_NOW`), which the canvas lint reports as state a check could carry between runs.
