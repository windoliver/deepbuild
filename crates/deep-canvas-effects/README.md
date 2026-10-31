# deep-canvas-effects

## What it is for

The effects canvas module (issue #380): GPU operators as data, a typed graph of steps from the core's closed op table, checked before anything reaches the GPU, written as WGSL by the core, and run on the CPU in f64 as every pass's reference. It also holds the shipped library (glow, shadows, selection outlines, the ground grid, particles). deep-effects-render validates and runs the WGSL; deep-show and deep-gpu-layer register the module.

## Where new code goes

- Reading an operator from JSON goes in `src/graph.rs`; the check's steps in `src/check.rs`; the closed op table in `src/table.rs`.
- WGSL text is written only in `src/emit.rs`, from a checked graph; the matching CPU meaning of each step goes in `src/interp.rs`.
- A new shipped effect is a graph built from public steps in `src/shipped.rs`, never shader text and never ported code.
- The manifest and the passes the module adds to the frame go in `src/module.rs`.
- Unit tests sit in a `#[cfg(test)]` module in the file (`src/table.rs`); the acceptance tests are in `tests/acceptance/380`.
- Anything that touches the GPU (naga, wgpu) goes in deep-effects-render, not here.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`, under `scripts/canvas-lint.mjs`. No GPU crate, no render crate, no app.

## Deviations

- `src/check.rs`: `#![allow(clippy::result_large_err)]`, since a refusal is the check's whole answer, made once per refused operator, so its size never matters.
