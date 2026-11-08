# Blind redraft of #493's AC12: the kept items' center at its place

`AC12 #493.c0595506`: "A shot's framing puts the kept items' center at its place within 0.5 px".

Written fresh, by a job that never saw an implementation or the first draft's tests, from: issue #493 live (body and its
one comment); `docs/technical-design.md` (Films and figures on the canvas; Dogfooding); `docs/canvas-primitives.md`
(Units and axes, Document envelope, Camera `camera@1` and its framing, Shot, Marks in 3D); at base `a4d2c5d4`
`crates/deep-canvas/src/camera.rs` (the framing solve, `Projector`), `crates/deep-motion/src/main.rs` and
`crates/deep-canvas-motion/src/doc.rs`; and the first draft's surface only: `tests/acceptance/493/README.md` and
`helpers.ts`. This worktree, at `a4d2c5d4`, has no `tests/acceptance/493/`, so those two files and `tsconfig.json` were
read from the caller's checkout of #493 and nothing else there; `helpers.ts` and `tsconfig.json` here are verbatim
copies. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## Run

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/493-redraft-ac12
node node_modules/typescript/bin/tsc -p tests/acceptance/493-redraft-ac12/tsconfig.json
```

It builds `deep-motion` once and sends JSON lines to `deep-motion eval`.

## Surface

The first draft's, nothing added: `deep-motion eval` with `project`, each frame's `projected.<id>.center` (the projection
of the item's bounds' centre, in px of the document's size, through the pose the frame reports). Shots with
`frame: {keep, place, fill}` and `roll`; the envelope's `safe`.

## What is held

The kept items' center is the center of their union bound (Camera `camera@1`: framing; Shot: the fit is "sized to the
union of their evaluated bounds"; a pad widens it evenly, so the center stays). The items stand still, so the union is
their own bounds, worked out here from the document. The place is a fraction of the safe frame (`fit.place`: "as
fractions of the safe frame"; `safe` defaults to 24 u, 1 u = 1 px at the document's size): (safe + place_x × (W − 2·safe),
safe + place_y × (H − 2·safe)) px. Each film carries an unkept marker `mid`, a 1 mm box in 3D or a 1 u rect in 2D centred
on that union center, so the binary's own projection says where the center lands; the test reads `projected.mid.center`
at 0, 0.5, 1, 1.5 s and the last 60 fps frame of a 2 s hold shot, which shows the framed pose throughout, and requires
each within 0.5 px (Euclidean) of the place.

| Test | Framing | Fails on |
|---|---|---|
| one box | perspective, orbit 120°/25°, one 0.8 m box off the origin, default place [0.5, 0.5] | no framing (the camera's own aim is the origin), a centre off its place |
| two boxes | perspective, two boxes, `place: [0.3, 0.6]`, `safe: 60` | place read on the whole frame, the center of one item or of the item centres instead of the union |
| a rolled shot | perspective, shot `roll: 20`, `place: [0.6, 0.4]` | a framing that ignores the roll the frame is drawn with |
| a 2D page | orthographic, two rects, `place: [0.25, 0.65]`, `fill: 0.5` | the same in 2D |

## At the base

`BASE-FAILURE.txt`: all 4 tests fail at an assertion. The base ignores a shot no stage names and has no `project`, so
each stops on `projected.mid … is an object`.
