# deep-contracts

## What it is for

The contract types in Rust, generated from the JSON Schemas in `packages/contracts/schemas`, and the small runtime they stand on: a JSON value, its parser, RFC 8785 (JCS) text and the helpers each generated `Contract` impl calls. deep-hook reads its contracts through it; the `deep-contracts` binary (`roundtrip`, `check`, `jcs`) is the surface tests compare against the TypeScript side.

## Where new code goes

- Runtime helpers the generated code calls (the JSON value, parser, JCS printer, `Seq`) go in `src/lib.rs`.
- New CLI subcommands go in `src/main.rs`.
- Tests go in `tests/` (`tests/jcs.rs`); the check that the generated file matches its generator is `tests/acceptance/603`.
- `src/generated.rs` is written by `npm run generate -w @deepbuild/contracts` (`generateRust` in `packages/contracts`). Change the schema or the generator, never this file.
- A new contract shape starts as a schema in `packages/contracts/schemas`, not as hand-written Rust here.

## What it may import

Core layer. It has no dependencies at all: std only. It never imports another workspace crate, an extension, the hub, the CLI or the app; other crates reach it only by its crate name.

## Deviations

- `src/generated.rs`: a 46,000-line generated file checked in, under `#[allow(clippy::all, non_snake_case)]` and `#[rustfmt::skip]` in `src/lib.rs`. Its fields spell the schemas' keys as written (`readBy`, `SessionStart`) so a key and its field never differ, and the acceptance tests hold it equal to the generator's output, so formatting or renaming it breaks that check.
