# deep-sandbox-wasmtime

## What it is for

sandbox@1's engine in the app (issue #238): wasmtime pinned to 49.0.5 runs the bytes the sandbox module rewrote, with wasmtime's own fuel and NaN canonicalization off, and maps each trap to its kind, function and offset. `src/service.rs` is the check-time runner deep-show calls for providers, validators and program entries, and the kit part `sandbox`; `deep-sandbox` serves the same calls as JSON lines. `web/runner.mjs` is the web player's implementation: the browser's own engine on the same rewritten bytes.

## Where new code goes

- The engine (counters, the watchdog, trap mapping) goes in `src/lib.rs`.
- The JSON calls and sandbox@1's kit runner go in `src/service.rs`; the command line in `src/main.rs`.
- The first-party layouts' validators, assembled and judged on this engine, go in `src/layouts.rs` (#415).
- The browser's runner goes in `web/runner.mjs`.

## What it may import

`deep-canvas-sandbox` for the check, the rewrite and the kit, `wasmtime` at `=49.0.5`, and `wat` for the kit's programs. It is outside the canvas lint's scope: what a check reads is what the rewritten program computes, never this crate's own arithmetic.

## Deviations

- sandbox@1's kit compares a trap's offset in the rewritten program, as the issue's kit names it; `run` reports the offset in the program as written.
