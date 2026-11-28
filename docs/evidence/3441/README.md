# #3441: the tick lists, the counts, and the two rules side by side

`counts.json` is what `play.mjs` wrote from a debug `deep-show` built from this change, on a Mac17,10. It plays the
suite's tick lists (`tests/acceptance/3441/README.md`: 600 ticks at each latch of a 60 Hz and a 120 Hz display, exactly
spaced and moved by seeds 1 to 8's offsets of up to 200 µs) through `deep-show run`'s `tick` call, once by the window's
rule and once by the merge base's rule, planted as `window_cap_time_threshold`.

```sh
DEEP_BIN_DIR=<a folder holding deep-show> node docs/evidence/3441/play.mjs
```

## Frames of 600 ticks

| Cap, display | After, exact | After, each of 8 seeds | Merge base's rule, exact | Merge base's rule, 8 seeds |
|---|---|---|---|---|
| thermal, 60 Hz | 600 | 600 | 300 | 368 to 379 |
| thermal, 120 Hz | 300 | 300 | 200 | 227 to 235 |
| inactive, 60 Hz | 300 | 300 | 300 | 232 to 239 |
| inactive, 120 Hz | 150 | 150 | 150 | 132 to 133 |

## Longest gap between two presented frames, jittered

| Cap, display | One cap period plus one refresh | After | Merge base's rule |
|---|---|---|---|
| thermal, 60 Hz | 33.333 ms | 17.067 ms | 33.733 ms |
| thermal, 120 Hz | 25.000 ms | 17.067 ms | 25.350 ms |
| inactive, 60 Hz | 50.000 ms | 33.733 ms | 50.325 ms |
| inactive, 120 Hz | 41.667 ms | 33.733 ms | 41.992 ms |

## The model and the window's rule on the virtual display clock

`sideBySide` holds, for each cap and rate, the ticks whose vsync the model opened (the `presented` reply's frames, with
a patch before every latch) and the ticks the window's rule presented. The two lists are the same in all four: every
tick under the thermal cap at 60 Hz, every second at 120 Hz and under the inactive cap at 60 Hz, every fourth under the
inactive cap at 120 Hz. `plantedModel` holds the planted `model_cap_time_threshold` under the thermal cap: it opens
ticks 0, 2, 4 at 60 Hz and 0, 3, 6 at 120 Hz, where the window presents 0, 1, 2 and 0, 2, 4.

## The patch's row

`vendor/gpui-pre-apple/upstream/README.md`, the row of #3441: `vendor/gpui-pre/src/window.rs` and
`vendor/gpui-pre/src/window/frame_cap.rs`, with their twins under `vendor/gpui-fast`. `node scripts/vendor-rebase.mjs
check` exits 0 and reads the row as 9 marked hunks, none over budget.
