# deep-input

## What it is for

The input module's proof binary (#308): JSON lines in, one answer per line, driving `deep-canvas-input`'s sessions, kit and tour for the acceptance tests.

## Where new code goes

- `src/main.rs`: the binary and its calls. The module itself goes in `crates/deep-canvas-input`.

## What it may import

`deep-canvas-input` by crate name, `serde_json` and `std`. It never reaches the canvas core or another module directly.

## Deviations

- `src/main.rs`: lives outside the `deep-canvas*` crates because its `lookup` probe reads the clock, which the canvas lint keeps out of checked code; nothing a check reads is computed here.
