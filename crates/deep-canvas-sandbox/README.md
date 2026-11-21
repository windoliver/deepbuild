# deep-canvas-sandbox

## What it is for

The sandbox canvas module (issue #238, `sandbox@1`, bit and canonical, on core alone): the logic subset's check, the rewrite with its fuel, stack and NaN rules, the trap kinds and sandbox@1's conformance kit, which logic items, linked libraries, `gen@1` providers, data layouts' validators and registry program entries share. The rewritten bytes, by hash, run the same in wasmtime 49.0.5 in the app and in the browser's own engine in the web player.

## Where new code goes

- The subset check and the program roles' exports go in `src/check.rs`.
- The rewrite (fuel, stack, NaN, grow, start, the offset map) goes in `src/rewrite.rs`; the trap kinds in `src/trap.rs`.
- sandbox@1's kit fixtures go in `kit/` (programs as text, `kit.json` with the reference's expected values), listed in `src/kit.rs`.
- The first-party data layouts (#415: `nav.graph@1`, `nav.graph@2`, `table.layout@1`, `fn.table@1`, `pages@1`; #223: `streams@1`, whose doc and decoder are the core's `deep_canvas::streams`), each with its doc, validator text, twins, fixtures and offset-to-field reading, go in `src/layouts.rs`; the reference's answers on them in `layouts/judged.json` (bless with `DEEP_LAYOUTS_WRITE=1 cargo test -p deep-sandbox-wasmtime layouts`). The module fills them into the core's `data.layout@1`.
- The pinned linker (#190: Logic: linked libraries), which merges a logic item's program and its libraries, relocatable objects under the tool conventions' Linking.md, into one module with no imports before the subset check, goes in `src/link.rs`. An import `lib:<name>@<major>.<export>` resolves to the linked library that implements that interface (#416).
- `lib.interface@1` (#416: Logic: library interfaces), which the module declares and packs fill, with its kit read from the logic module's verdicts on each interface's planted libraries and its digest rule, goes in `src/interfaces.rs`. The interfaces' fixtures run in `crates/deep-logic` (`src/interfaces.rs`); the first-party ones ship in `packs/interfaces-1.0.0`, `packs/modslib-1.0.0` (#953: mods.lib@1) and `packs/sense-1.0.0` (#959: sense.lib@1), written by `scripts/interfaces-pack.mjs`, `scripts/modslib-pack.mjs` and `scripts/sense-pack.mjs`.
- The manifest goes in `src/module.rs`. The engine that runs the rewritten bytes is `crates/deep-sandbox-wasmtime`.
- The acceptance tests are in `tests/acceptance/238`, `tests/acceptance/415`, `tests/acceptance/190` and `tests/acceptance/416`.

## What it may import

A canvas module crate under `scripts/canvas-lint.mjs`. It reaches the core through `deep-canvas` by crate name, and parses and writes WebAssembly with `wasmparser` and `wasm-encoder` at the versions wasmtime 49.0.5 uses, each listed in `lint/canvas/crates.json`. It runs nothing: no engine, clock or file.

## Deviations

- The linker takes only the relocations a called library needs (function, type and global indices, and its own data's addresses); a library that takes a function's address, declares a table or a start function, or reads another object's data is refused, naming it.
