# Why AC3 `#468.632af807` was redrafted

The first draft of #468's suite read AC3 through a `view3d` surface it assumed: `overlays: true` adding to each frame
an object keyed by overlay ID, `overlays: {<id>: {shown, leader: {from, to} | null}}`. Since then #506 landed on main
and claimed the same field with another shape: `overlays: true` adds to each frame a list, `overlays: [{id, at: [x, y]
| null}]` (`tests/acceptance/506/README.md`, item 8; `crates/deep-gpu-layer/src/view3d.rs` at `abf74b4ee`). One frame
field can't be both, so the first draft's AC3 can't pass on any program alongside #506's suite.

This redraft reads AC3 through surfaces that exist at the base and extends them only where AC3 needs a value the base
can't report:

- the leader's end and whether the label is shown come from #506's rows as they are, `{id, at}`, with one key added to
  the row of an overlay that has a leader, `leader: {to: [x, y]} | null` (README, item 4); `at` null is hidden, as in
  #506. A row without a leader keeps #506's shape, so #506's tests read it unchanged;
- "the same pixel hash seeked or played" is the base's per-frame `pixel_hash`, with #484's `seeks`;
- "hides" is also read off pixels: at a hidden time the frame equals, by `pixel_hash`, the same document without the
  label;
- the 3D line's points come from the base's `counts: true` `segments` (each line's segments in world metres), which at
  the base lists mesh-edge and logic-array lines and here also lists a line with an `ID#anchor` point (README, item 5).

The first draft wasn't read; this note restates only what the brief gave about it.
