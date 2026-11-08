# Blind redraft of AC1's live test (`#427.eec6bc2e`)

`live-redraft.test.ts` replaces `live.test.ts` for AC1. Written by a fresh run of the acceptance job from issue #427,
this folder's README and helpers, and commit `1c3b9195` (the base plus the blind suite); no implementation was read.

## The dispute

`live.test.ts` sends the agent's revision 13 as a whole document that leaves `cube.b` out and adds `cube.d`, without
naming `cube.b` in `removes`. The design (docs/canvas-primitives.md, Revision: "an ID it leaves out must be in its
`removes`, or it's refused with `unintended_removal`") and the base's deep_show parse (`removes` on the Show call,
crates/deep-show/src/main.rs) refuse that revision, so revision 12 stays current and the criterion's "the next
render-back names rev 13 and lists the new cube's ID" can never be observed.

## The change

Only the agent's revision 13: it now names the ID it replaces, `{...show(still(13, true)), removes: ['cube.b']}`, a
valid whole revision that replaces `cube.b` with `cube.d` at (0, 0, 0) with the same size, keeping 8 items. The failure
message for a reply that isn't rev 13 now quotes the reply, so a refusal shows its issue. Criterion, test names,
expected values (rev 12 for the 20 modes, no frames, frame callbacks or rung moved, rev 13 with `cube.d` and not
`cube.b` in `visible`) and the planted programs (`mode_draws_live_surface` failing on the frame callbacks,
`mode_ids_by_count` failing naming `cube.d`) are unchanged.

Typecheck passes. Not run: it needs the implementation and a Mac with a display.
