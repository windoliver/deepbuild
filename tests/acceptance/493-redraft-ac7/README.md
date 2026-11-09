# Blind redraft of #493's AC7: default moves, the glide and pose channels

`AC7 #493.5bfe22ba`: "With a shot framed by keep at 4.000 m from its target, push at its default amount puts the camera
4.600 m from the target on the shot's first frame and 4.000 m on its last, orbit at its default sweeps the azimuth from
15° before to 15° after the framed azimuth, a shot that glides in over 0.5 s starts at the previous shot's last pose
within 1e-6 m and 1e-6 rad, and a channel on a pose path of a camera in a shot that isn't keyed is refused naming both".

Written fresh, by a job that never saw an implementation or the first draft's tests, from: issue #493 live (body and its
one comment); `docs/technical-design.md` (Films and figures on the canvas; Dogfooding); `docs/canvas-primitives.md`
(Units and axes, Document envelope, Camera `camera@1` and its framing, Shot, Transition); at base `a4d2c5d4`
`crates/deep-canvas/src/camera.rs` (orbit and projection conventions, the framing solve), `crates/deep-motion/src/main.rs`
and `crates/deep-canvas-motion/src/doc.rs` (`shot_of`, `cameras_of`, `cuts_of`); and the first draft's surface only:
`tests/acceptance/493/README.md` and `helpers.ts`. This worktree, at `a4d2c5d4`, has no `tests/acceptance/493/`, so those
two files and `tsconfig.json` were read from the caller's checkout of #493 and nothing else there; `helpers.ts` and
`tsconfig.json` here are verbatim copies. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## Run

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/493-redraft-ac7
node node_modules/typescript/bin/tsc -p tests/acceptance/493-redraft-ac7/tsconfig.json
```

It builds `deep-motion` once (`cargo build --locked --bin deep-motion`) and sends JSON lines to `deep-motion eval`.

## Surface

The first draft's, nothing added: `shots.<id>.framed` (a Pose), each frame's `cameras.cam` (a Pose), refusals as `{ok:
false, …}` searched for the IDs they must name. Documents as its README writes them: `shots` with `move`, `frame.keep`,
`target` and `orbit` (an explicit pose), `join: {glide: {span}}`, `keyed`; `channels` as at the base.

## How each clause is read

| Clause | Test | Fails on |
|---|---|---|
| framed by keep at 4.000 m | each test scales the kept box by 4 ÷ D1, D1 the unit box's framed distance, and checks the framed distance is 4.000 m within 5e-4 m | a framing that doesn't scale with the kept bounds (ignores keep) |
| push, default amount | first frame (0 s) 1.15 × the framed distance within 1e-9 relative and 4.600 m within 5e-4; last 60 fps frame (119/60 s) 4.000 m within 5e-4; distances from the framed target | a push from another amount, a push that never lands, no shots |
| orbit, default | the eye's azimuth about the framed target, 15° before the framed azimuth on the first frame and 15° after on the last, within 1e-3° | another sweep, the wrong direction, no orbit |
| glide over 0.5 s | at 2 s the pose is the previous shot's at the flick before 2 s: position and target within 1e-6 m, aim (atan2 of cross and dot) and roll within 1e-6 rad; by 2.5 s the incoming shot's explicit pose within 1e-6 m; at 2.25 s neither | a cut, a glide that never arrives |
| channel on a pose path | channels on `items/cam/params/target/0` and `items/cam/params/orbit/azimuth` in the unkept shot `held-shot` are refused, the refusal naming `nudge-x` and `held-shot`; the same channel in a keyed shot is accepted and writes the target's x (1 at 1 s) | accepting the channel, a refusal naming one or neither, refusing every camera channel |

## Choices where the issue is open

- **"Framed by keep at 4.000 m".** The keep fit's formula isn't pinned. A fit at fixed angles, fill, pad (a fraction)
  and place is similar under scaling, so the box is scaled to make the shot's framed distance 4 m.
- **First and last frame.** The shot's 60 fps frames inside [start, end): the last is 1/60 s before its end, where an
  in_out_cubic push is 1.4e-6 m short of landing, inside 4.000's precision. Nothing here reads a shot's end flick.
- **The previous shot's last pose** is the pose at its end; read at the flick before the next shot starts, where the
  eased move has landed to far under 1e-6.
- **"Naming both"** is the channel and the shot (Shot: "a channel on one of them is refused at check, naming both").
- The film is 60 fps (`frame_rate: '60/1'`), the camera perspective with orbit 45°, 30°, 10 m and fov 40°.

## At the base

`BASE-FAILURE.txt`: all 4 tests fail at an assertion. The base reports no `shots` block (the framed pose), so the first
three stop on `shots.probe is an object`; it accepts a channel on the camera's target in a shot no stage names, so the
fourth fails `is refused`.
