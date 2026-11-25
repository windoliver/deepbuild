# Evidence for #1719: a 3D render-back draws in the document's look

Readings from one run of `tests/acceptance/1719` on the change merged with main `0a875355b`; `BASE-FAILURE.txt` in that
folder holds the base's own run at `c8d9684f0`. Both on an Apple M5 Max, macOS 27.2.

## The base's snapshots beside the change's

Presenting and `render_back` read the same in every row.

| Criterion | Base | Change | `view3d`'s frame |
|---|---|---|---|
| AC1 the red box under a 3,000 lx sun in castle-dusk: most common color | 100.00% #ffffff | 33.39% #c7c6c6 | 33.39% |
| AC1 the box's mean red less its mean green | 0.000 | 0.501 | 0.498 |
| AC2 the castle at 1280 × 800 against `view3d`, FLIP mean, worst window | 0.5321, 0.9695 | 0.0000, 0.0000 | its own |
| AC2 the planted `render_back_drops_look` | not a name | 0.5362, 0.9680: FAIL, naming castle-dusk | |
| AC4 a look the store doesn't hold | a snapshot in another look | `asset_missing` at `look/asset`, no snapshot | |
| AC5 the small box, most common color | 99.26%, no notice | 99.26%, `snapshot_blank` with that share | 99.26% |
| AC5 the castle | no notice | no notice | |
| AC7 the slab's luma, shadow side and sunlit side | 0.7575, 0.7575 | 0.5001, 0.7575 | 0.5001, 0.7575 |
| AC8 the box's mean red without and with the pass (`declared`, `tint`) | 0.0790, 0.0790 | 0.0790, 0.7961 and 0.8051 | 0.7961 and 0.8051 |

## The two-look hashes (AC3) and the emitter's (AC6)

| | Base | Change | `view3d` |
|---|---|---|---|
| `tone-filmic@1` | `991330f3…` | `17182b41…` | `17182b41…` |
| `tone-neutral@1` | `991330f3…` | `4f0e00ac…` | `4f0e00ac…` |
| with `sparks` | `2de0ecd2…` | `e5737bfa…` | `e5737bfa…` |
| without | `2de0ecd2…` | `2de0ecd2…` | `2de0ecd2…` |

## The moved post stage draws what it drew

`deep-gpu`'s `view3d`, the base's binary against the change's, three frames each: the four film effects' fixtures, a
shadow over painted solids on a ground grid, particles on the shipped graph, with closed-form fields and as puffs, a
document's own pass with and without a selection, and four pack looks whose finish is an operator. All 14 documents
hash the same, frame by frame.

Render-back against `view3d` (one sample, the live class) of the same documents at 0.5 s, and of the four shipped
looks, and of an operator that reads the velocity target: 0 of every frame's channel values differ.

## What it doesn't draw

- A look's `samples` and motion blur: render-back draws one sample, as it did (Look `look@1`: samples lands with
  exports and render-back stills). Against `view3d`'s 16-sample class the castle reads FLIP mean 0.0014, worst window
  0.0544.
- A document's status marks in 3D, as before.
