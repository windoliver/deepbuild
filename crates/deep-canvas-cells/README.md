# deep-canvas-cells

## What it is for

The cells canvas module (issue #402, `cells@1`): a terminal emulator that turns a program's output into a grid of typed cells, frames and row patches against a revision, the palette rule that keeps a cell off the status colors, and the module the registry and seal take. deep-app paints its screen row by row, and deep-show registers the module in its build sets.

## Where new code goes

- Escape handling, scrollback, modes and the clipboard rule go in `src/emulator.rs`.
- The status-color rule for cell colors goes in `src/palette.rs`.
- The manifest, the grid's check and the operator that lays rows out for the shaper go in `src/module.rs`.
- Tests sit in a `#[cfg(test)]` module at the end of each file; the acceptance tests are in `tests/acceptance/402`.
- Feeding bytes from a real program (a panel host, a pty) does not belong here: the crate is pure, with no I/O and no clock.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`. Its name puts it in `scripts/canvas-lint.mjs`'s scope and `canvas_text = true` in `scripts/text-lint.mjs`'s, so no clock, platform libm, hash-map iteration or GPUI text system. It never imports the app, a GPU crate or another module's crate.

## Deviations

None.
