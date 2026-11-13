# #450 evidence: trails on any item, ribbon trails, trails since an occurrence and whole-window trails

The blind suite is `tests/acceptance/450/` (its commit on this branch carries the blind job's message), written from
the issue, the design and base `53c0e72a3` by a job that saw no implementation, and unedited since.

| File | Criterion | What it shows |
|---|---|---|
| `three-traces.png` | 5 | The thrown ball's three traces at 6 s (cues at 0, 2 and 4 s, at 30°, 45° and 60°), 640 × 360. |
| `wheel-trail.png` | 5 | The rolling wheel's whole trail at 3.75 s, baked at 60 Hz from 0 s. |
| `traces-24fps.apng`, `traces-60fps.apng` | 5 | The thrown ball's traces from 0 to 6 s at 24 and at 60 fps, 320 × 180, the canvas's own frames unchanged. |
| `checks.txt` | 1 to 5 | The blind suite on the change rebased onto main (11 of 11 once the taste call was recorded), the touched crates' unit tests, #421's coplanar ties, #379's allocation count here and on the base, and the canvas kit, as run. |

Every picture is the check run's own (`taste.test.ts` writes them to `target/acceptance/450/`; they are copied here
byte for byte). SHA-256:

```
0a03fa7dc2a758ffab9fecd755635c7aa3c612b949188778667e798062b87585  three-traces.png
2646cda792e2c28bec9f4e73d5f726e9fc9b1293c8f85e4c50f205fdcd03ac0a  wheel-trail.png
7cdadd9e5d8bfd89574fba4269435cffb2ed10355e2a1589d4fe4ebf98e72483  traces-24fps.apng
68eb5076f1443dd1cc9917168b26dad86bbc4438e13da72e52a9bebdb6ac99d4  traces-60fps.apng
```

Whether they look right is one taste call (criterion 5), recorded in `tests/acceptance/450/TASTE.json`: looks right,
made on the owner's delegation in session. Besides the stills, the recordings' frames at 0, 1, 2 (the second cue), 3,
4, 5 and 6 s at 24 and 60 fps were checked. The fixture's camera (horizontal fov 50° at 28 m) crops the first throw's
start, the ball at 0 s and 6 s, and the wheel's rim at 3.75 s; that framing is the test's own.

## Seek against play: a fix the criterion needed

Criterion 3 compares sought and played frames by pixel hash. At the base, the thrown ball's document drew one row of
the floor's edge differently when played from 0 s than when sought (`633adab4…` against `d153a8c2…` at frame 20,
with no trail in the document at all): the renderer ranked coplanar ties (#421) only when the frame's set of solids
changed, so a play kept the ranks of t = 0, where the ball touches the floor, and a seek ranked where the solids stood.
Ranks are now taken from every frame's solids, in kept buffers so a frame allocates nothing once warm.

## Review videos (not a criterion's pictures)

`review/` holds videos and contact sheets made for the owner's review on Nov 13, from the canvas's own frames. None is a criterion's picture, and no test reads them:

- `throws-wide.mp4`: the suite's thrown ball with a fourth cue (75° at 6 s), seen from farther back so nothing is cropped, 0 to 8 s at 24 fps.
- `wheel-wide.mp4`: the rolling wheel's whole trail, wider, 0 to 4 s at 30 fps.
- `ribbons.mp4`: the AC1 storm's particle ribbons, 0 to 3 s at 30 fps.
- `flat-trail.mp4`: a 2D `path@1` trailing a dot through a 2D writer layer (the GPU layer's 2D draw), 0 to 2 s at 30 fps.
- `sheet-*.png`: nine frames of each, in a grid.

Reviewing the ribbons found resting sparks drawn as nothing: a still particle's ribbon has no length, so it covered no pixel. A ribbon's newest segment now rounds at the particle, so a still particle draws a dot of the ribbon's width.
