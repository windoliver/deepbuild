# Blind redraft: AC7's quiet test (`#427.f8669ef0`)

`paths-picks-redraft.test.ts` replaces the second test of `paths-picks.test.ts`. It was written from the same inputs
as the suite (issue #427, the design, base `9d31efdb` with this suite at `1c3b9195`) and the dispute, without any
implementation or its diff. The first test of `paths-picks.test.ts` (motion paths and the pick hierarchy) stands.

## The dispute

The draft ran `quietProblems` on 'Every new mode'. That scene has `transport: {span: '2s'}` and a channel moving
`mover`, so the shown window plays it: #140's frame clock arms a frame whenever the frame's `valid_until` comes, and
`valid_until` is set while a channel changes later (with a wrapping transport, forever). The window's `presented` and
`wakeups` moved during the mode calls whether or not a mode touched it ("the live view drew 108 frames across the
modes; … 104 frame callbacks"). The test measured the animation, not the modes. AC3's quiet test, on a still scene,
passes the same check.

## What changed

The criterion, the seven modes and their requests, and every check of `quietProblems` are kept. The checks are split
over two documents, in a helper inside the test file:

- **The moving scene**, unchanged ('Every new mode' with its keyed channel, so motion paths has a channel to read):
  `deep-show run` of the seven modes, each reply at rev 1, no snapshot pixel within 2 per channel of the clean look's
  pass, fail, invalid or running color; a claim citing each snapshot gets verdict rows not PASS, each carrying
  `display_only` and that snapshot's hash.
- **Its still twin**, the same document without `channels` (nothing changes after any time, so the window idles after
  its first frame, as AC3's scene does): `deep-show run` of the seven modes for its own snapshots (rev 1, no status
  color), then `deep-show live` showing it at revision 1 with the modes between two `presented` reads: the revision
  shown, frames presented, frame callbacks and meter rung equal after and before; each reply at rev 1 with the still
  run's snapshot.

One addition: two `presented` reads 150 ms apart before the modes. If the window draws or takes frame callbacks between
them with no call, it isn't idle and can't measure the modes, so the test is INCONCLUSIVE, never PASS. A mode that wakes
the live view still fails on the reads around the modes.

## Run

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/427 paths-picks-redraft --no-file-parallelism --testTimeout=1800000
```

Typecheck passes. Not run here: no implementation exists at this commit.
