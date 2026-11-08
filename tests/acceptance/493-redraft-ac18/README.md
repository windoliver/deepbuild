# Blind redraft of #493's AC18: the match cut

`AC18 #493.e1213b8a`: "A cut with match {from: ball, to: sun}, where the ball's projected centre on the outgoing shot's
last frame is 427 px right of and 164 px above the centre of a 1920×1080 frame with a 61 px radius, puts the sun's
projected centre within 0.5 px of that point and its radius within 1% on the incoming shot's first frame; a planted
framer that fits the sun by its keep at place [0.5, 0.5] misses by more than 450 px and fails, naming the transition".

Written fresh, by a job that never saw an implementation or the first draft's tests, from: issue #493 live (body and its
one comment); `docs/technical-design.md` (Films and figures on the canvas; Dogfooding); `docs/canvas-primitives.md`
(Units and axes, Document envelope, Camera `camera@1` and its framing, Shot, Transition, Marks in 3D); at base
`a4d2c5d4` `crates/deep-canvas/src/camera.rs` (orbit, screen basis, `Projector`: fov across the wider side),
`crates/deep-motion/src/main.rs` and `crates/deep-canvas-motion/src/doc.rs` (`cuts_of`); and the first draft's surface
only: `tests/acceptance/493/README.md` and `helpers.ts`. This worktree, at `a4d2c5d4`, has no `tests/acceptance/493/`, so
those two files and `tsconfig.json` were read from the caller's checkout of #493 and nothing else there; `helpers.ts` and
`tsconfig.json` here are verbatim copies. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## Run

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/493-redraft-ac18
node node_modules/typescript/bin/tsc -p tests/acceptance/493-redraft-ac18/tsconfig.json
```

It builds `deep-motion` once and sends JSON lines to `deep-motion eval`.

## Surface

The first draft's, nothing added: `deep-motion eval` with `project` (`projected.<id>.center` and `.box`, in px), the
plant `match_framer_ignores_match`, `transitions: {cut1: {from: 'out', to: 'in', kind: 'cut', match: {from: 'ball', to:
'sun'}}}`, shots with an explicit pose (`target`, `orbit`) and with `frame.keep`. The ball and the sun are boxes
(`mark.box@1`), and an item's radius is half its projected box's height (the first draft's choice 15).

## The film

1920 × 1080 at 60 fps; one perspective camera, fov 40° across the wider side. Shot `out` [0, 2 s) holds the eye 10 m in
front of the origin on +Z (azimuth 0, elevation 0). The ball sits at depth 10 m on the line through (960 + 427, 540 − 164)
px, so its centre projects there, and its size (0.4353 m) is found by bisection so that half its eight corners'
projected height is 61 px. Shot `in` [2 s, 4 s) keeps the sun, a 20 m box at (30, −8, −250) m, on the same camera at the
same angles; a framing that matches centre and size then draws the sun exactly as the ball was drawn. The outgoing
shot's last frame is 119/60 s, the incoming shot's first 2 s.

## What is held

| Test | Holds | Fails on |
|---|---|---|
| the match | the ball read back at (1387, 376) px within 0.05 px and radius 61 px within 0.1% (the criterion's scene); then the sun's centre on the incoming first frame within 0.5 px of the ball's and its radius within 1% of the ball's | a cut that ignores `match`, a match on centre but not size, no shots |
| the plant | `match_framer_ignores_match` answers with frames; the same check misses by more than 450 px (the safe frame's centre is √(427² + 164²) = 457.4 px from the point) and fails with a failure naming `transition cut1` | a plant that still matches, or isn't there |

## Choices where the issue is open

- A cut carries no `span` (it has no window; the base's cut reads none).
- "That point" is the ball's centre as the binary projects it on the outgoing last frame, which the first test also
  checks against the criterion's (1387, 376).

## At the base

`BASE-FAILURE.txt`: both tests fail at an assertion. The base refuses the cut, whose `from` and `to` are shots rather
than placements, and has no `project`; it doesn't know the plant and answers `bad_input`.
