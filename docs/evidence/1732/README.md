# #1732 evidence: arranged rooms as deep-show draws them

Frames from `deep-show screen` (GPUI's offscreen Metal renderer) on the room fixture of `tests/acceptance/1732`, each
with a `deep_query` of every item's evaluated pose. `top` is an orthographic camera looking down (north, −z, is up);
`angle` is a perspective view from the south-east.

| File | Scene |
|---|---|
| `room-before-*.png` | The room as written, with no arrangement: chairs out in the room, the lamp on the floor, the shelf off the wall. |
| `room-solved-*.png` | The same room with its `arrange@1`: four chairs flush to the table's faces, the lamp on the table, the shelf against the north wall, the rug left where it stood. |
| `room-stacked-*.png` | Four chairs stacked at the room's centre, then arranged: they solve apart to the four faces. |

`pixel-check.txt` samples each arranged item's role colour (`ink` or `accent`) in the top frame at the position the
query reports; every item matches, so the pixels and the evaluated poses agree.

`crates/deep-show/tests/arranged_screen.rs` holds the same claim as a test: an arranged lamp draws pixel for pixel as
the scene with the lamp written where the solve put it. With `Arranged::apply` removed from the draw path, it fails
with 800 differing pixels.
