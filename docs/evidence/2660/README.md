# #2660: nothing a person sees changes, and three budgets' instructions hold

The issue promises that every draw list, hash, hit and cell is the one produced before. These files show it on
pictures, and hold the instruction comparison its seventh criterion asks for. The base is `b6b99ad8c`.

## Pictures

`deep-canvas-render raster`, a debug build, drew the same documents in the shipped look `clean` on the base and on
main `89df55943` with this change:

- the first criterion's document: a 10,000-point mark set laid out in a row frame, 1200 × 800;
- the second criterion's board: 2,000 labels and 40 rects, 1600 × 1000, before and after one rect moves. Its labels
  are letters, since the document check refuses a label that shows a number with no source;
- a clock that counts down on hold keys and rolls the digits that change (#496's), 139 frames from 3.3 s to 5.6 s at
  60 frames a second, 480 × 160.

All 142 pairs are the same PNG byte for byte. The clock's 139 frames hold 53 distinct pictures, so the comparison is of
a picture that moves. As a control, the two boards one rect apart differ in 96 pixels.

- `sheet.png`: each still on the base, on the change, and their difference times 8 (black where no pixel differs),
  then seven of the clock's frames. Each label is in a strip outside the drawn frame.
- `counter.mp4`: the clock on the base, on the change and their difference, side by side, at half speed.
- `pictures.json`: each pair's pixel count, pixels drawn on, pixels that differ and both PNGs' SHA-256.

The hover and the terminal's grid aren't drawn here: `raster` has no route to them. The suite reads them instead
(`tests/acceptance/2660/hover.rs`, `terminal.rs`): each of 1,000 hovers names the item the base names, and the grid's
digest is the base's.

## Instructions

`instructions.json` holds, for `canvas-patch-settled`, `canvas-patch-dirty` and `terminal-60hz`, the 20 alternated
pairs of instructions retired and the perf lane's verdict on them (`scripts/benchmark.mjs`, `judgeInstructions`), read
under a timed grant on a Mac17,10. Main already holds the change, so the sides were named: the base, and `6a007be07`
(the change on that base) with this pull request's three source edits. Each reads PASS, which is the lane's rule: a
rise of 2% or more is rejected at p under 0.01. The medians are −0.046%, +0.033% and +0.051%.

`canvas-patch-dirty` and `terminal-60hz` were read through the lane's `measureOnce` with a limit of 30 minutes a run,
in the rounds `measure` makes: its own 300 s limit stopped a run while the machine's load was 130.
