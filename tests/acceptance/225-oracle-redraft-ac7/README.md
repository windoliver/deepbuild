# Acceptance tests for #225, Oracle lane, criterion 7 (blind redraft): a square carried by a vector field's flow

A fresh run of the blind acceptance-test job, porting the one upstream test the Oracle page pins for criterion 7 of
issue #225 ("Vector fields: arrows and stream lines from one formula, integrated at check"):

> AC7 `#225.57b5ccba`: A flow of a unit square along the vector field (−y, x) for time π/2 ends rotated 90° within 0.5
> px, at 24 and 60 fps alike

Written from the issue, the design sections below, the Oracle page with the vendored upstream file it links, and base
commit `0e5572731` (the checkout's head is `dc9b43154`, a later main merge; none of the files read below differ
between the two), by a job that never saw an implementation of #225; none existed. No other worktree, branch, PR,
session or `tests/acceptance/225*` folder was read. #136's rule applies: a linked test counts only when run against our
output, so the port judges what `deep-show` draws. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #225, live (`gh issue view 225 --repo windoliver/deepbuild`); criterion 7 is quoted at the top of the test file.
- Its Oracle page, `doneright/oracles/issues/225.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the vendored
  upstream file it links for criterion 7: the motion tests at commit `cfd33af5aa`, lines 207–229.
- `docs/canvas-primitives.md`: Vector field `vector_field@1`; Frame and group: warp (its `flow`); Logic: data layouts.
  `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Wrong programs, Dogfooding); Channel and
  key.
- At the base, for surfaces only: AGENTS.md; `crates/deep-show` (`main.rs`: the `path` call with `t`; `time.rs`: the
  `export` plan with no `out`; `warps.rs`); `crates/deep-canvas-marks/src/warp.rs` (how `flow` reads its table);
  `crates/deep-canvas/src/streams.rs` (`streams@1`); `frame_rate_of` (the transport's `frame_rate`); sibling suites
  `tests/acceptance/223`, `223-oracle`, `226-oracle-redraft` and `466-redraft-ac7` for conventions; and
  `scripts/proof-change.mjs` (`criterionId`).

## Source

| Criterion | Upstream, pinned | Use | Here |
|---|---|---|---|
| 7 | the upstream tests at `cfd33af5aa`: the motion tests, lines 207–229 (a point carried along a field's flow) | port | `flow-square.test.ts` (3 tests) |

**The test, re-expressed.** No upstream code is copied or run. Upstream carries a point along the field (−y, x) for a
field time of 2π played over its one-second run time, records the scene at 10 fps and again at 60 fps, and asserts the
point lands on the field's exact flow, the turn by that time, within 1e-4 at both rates. Ours keeps that shape with the
criterion's numbers: the unit square, a field time of π/2 played over 1 s, 24 and 60 fps, and 0.5 px. The page notes the
square's quarter turn within 0.5 px at 24 and 60 fps is our fixture's. Nothing is copied, so no notice is carried.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/225-oracle-redraft-ac7 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/225-oracle-redraft-ac7/tsconfig.json   # type-check
rm -rf tests/acceptance/225-oracle-redraft-ac7/node_modules/.vite
```

The file builds `cargo build --locked --bin deep-show --no-default-features --features full` once in `beforeAll`
(honoring `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set) and copies the binary
out of the target folder; every `it` passes a 60-minute timeout. **`scripts/lanes.mjs` needs
`'tests/acceptance/225-oracle-redraft-ac7/'` in its `alone` list**; the implementer makes that edit. Node built-ins and
vitest only. `BASE-FAILURE.txt` says where each test fails at the base.

## The surface under test

No new call, binary or build feature: #393's `deep-show run` with its `deep show`, #488's `export` plan, and #223's
`path` with `t`. **Every name the issue or the design doesn't give is marked *(chosen)***; the implementer builds
exactly these, or a dispute goes to a blind redraft.

| Surface | Request | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs`, `calls` | `ok`, `replies` | existing |
| `deep show` | `peer` (your shell), `doc`, `document` (shell form: no `id`, no `layers`, no item `layer`), `include: ["issues"]` | `outcome: "presented"`; `issues` and `notices` (no error, no `unknown_kind`) | existing |
| `export` (no `out`) | `doc` (no `frame_rate`: the document's own) | `outcome: "planned"`, `frame_rate: [fps, 1]`, `frame` (flicks) | existing |
| `path` | `doc`, `item: "square"`, `t` (whole flicks) | `subpaths`: the item as drawn at t after every warp of its ancestor groups, each sub-path a list of `[x, y]` in document u | existing (#223) |

### The film

`helpers.ts` builds it; nothing is on disk. 640 × 480 u, `transport: {span: "2s", frame_rate: [fps, 1]}` for fps 24 or
60, `requires: {modules: {data: "^1"}}` (`vector_field@1` is the data module's), and three items:

- **`swirl`**, a `vector_field@1`: `fn: {x: "-y", y: "x"}` (the criterion's field) and `streams: {starts: {points: [[1,
  0, 0]]}, step: 0.05, time: 2π}`. `starts` writes the design's `grid {…} | points [vec3]` as a key holding the form
  *(chosen spelling, as #223's suite wrote `linear {matrix}`)*, with z 0 for a 2D field. The field has no `scales`,
  `arrows` or `flow`; its streams are not judged here. At check it builds its stream table in data layout `streams@1`
  (its `fn` with its vars' values, its `step` and each stream's points), the table a group's flow reads.
- **`g`**, a `group@1` with #223's `params.warp: {linear: {matrix: [[1, 0], [0, 1]]}, mix: 1, plane: {origin: [320,
  240], unit: 100, y: "up"}, flow: {streams: "swirl", time: 0}}`: the identity map, then the flow along `swirl`'s
  table. The flow carries each point by RK4 over the table's field at its step (0.05) for `time`.
- **`square`**, a `path@1` under `g`: the unit square through the plane's (1, 0), (2, 0), (2, 1), (1, 1), written back to
  its start (`M 420 240 L 520 240 L 520 140 L 420 140 L 420 240`), stroked 2 u in `ink`.

One channel, `flow_time`, keys `items/g/params/warp/flow/time` *(chosen path, the param's own)*, type f32, from 0 at
0 s to π/2 at 1 s, linear: the flow's time played over the run time, as upstream plays its field time. After 1 s it
holds π/2. The authored `time: 0` means a flow that ignores the channel never turns the square.

### Playing

One `deep-show run` per film: `deep show`, the `export` plan, then `path` of `square` at every frame time k × frame
for k = 0 … fps (0 to 1 s, both included: 25 calls at 24 fps, 61 at 60 fps), in order, as playing draws them. The
plan must answer the film's own rate with a frame of 705,600,000 ÷ fps flicks (29,400,000 or 11,760,000). Every frame
must draw the square; the judge reads the frame at 1 s, where the flow ends.

## Numbers

The flow of F = (−y, x) for time θ is the turn by θ counterclockwise about the origin, so at 1 s the square is exactly
the square rotated 90°: (0, 1), (0, 2), (−1, 2), (−1, 1), on screen u (320, 140), (320, 40), (220, 40), (220, 140). The
judge (`judgeEnd`) samples both outlines every 0.25 u and fails when any point of either lies more than 0.5 u from the
other, a failure naming the rate (`24 fps` or `60 fps`) and `rotated 90°`. One u is one px: the film draws 640 × 480 u
at 1 px a unit *(reading)*.

- The design's RK4 at step 0.05 for π/2 (31 steps of 0.05 and one of 0.0208) lands within 2e-5 u of the exact turn on
  every corner; with π/2 rounded to f32, within 1e-5 u. Far inside 0.5 u.
- One Euler step a frame, h = (π/2) ÷ fps, scales each radius by √(1 + h²) a step and turns it by atan h. At 24 fps,
  h = 0.06545 and 24 steps scale by (1 + 0.0042837)^12 = 1.0526, so the corner (2, 1), √5 from the origin, ends 11.78 u
  off; at 60 fps, h = 0.02618, (1 + 0.000685)^30 = 1.0208, 4.64 u off. Both fail, and differently: such a flow is not
  alike at 24 and 60 fps.
- The field written clockwise ends the square at (0, −1), (0, −2), (1, −2), (1, −1), at least 200 u away.

## Wrong programs

| Wrong program | Where | What catches it |
|---|---|---|
| the base: no `vector_field@1`, so no stream table for the flow | the merge base | the film isn't presented (`unknown_kind` for `vector_field@1`, the flow's `streams` unresolved) |
| a flow that integrates between frames, one Euler step a frame | test code, `eulerPerFrame` (planted twin) | test 1: the judge fails at each rate, 11.78 u and 4.64 u off, checked by hand above |
| a flow that never runs, or ignores the keyed time | test code (the square where it started) | test 1: the judge fails at each rate |
| a field read the other way round (clockwise) | a fixture written the wrong way, `fn: {x: "y", y: "-x"}`, run through the binary | test 3: presented and drawn, but the judge fails at both rates, about 200 u off |

The plants live in test code, as the design's Wrong programs allows; none is chosen by an environment variable, and
none needs a `planted` name or a build feature from the implementer.

## Criteria to tests

The three test names start with `AC7 #225.57b5ccba` (`scripts/proof-change.mjs`).

| Test | What it asserts |
|---|---|
| the judge passes the field's exact flow and the design's RK4 at step 0.05, and fails the planted twins | in test code: the exact turn and RK4 at step 0.05 pass at 24 and 60 fps; the unturned square fails; one Euler step a frame strays 11.78 ± 0.05 u at 24 fps and 4.64 ± 0.05 u at 60 fps, and the judge fails naming the rate |
| played at 24 fps and at 60 fps, the square ends within 0.5 px of the square rotated 90° | each film is presented with no error and no `unknown_kind`, its plan is its own rate, every frame draws the square, and at 1 s the square is within 0.5 u of the square rotated 90°, both ways, at both rates |
| the field written clockwise turns the square the other way, and the judge fails at both rates | the twin is presented and drawn at every frame, ends more than 100 u off, and the judge fails naming the rate and `rotated 90°` |

## Choices where the issue is open

1. **The flow plays over the film.** "A flow … for time π/2 ends rotated 90° … at 24 and 60 fps alike" is read as the
   flow's time running from 0 to π/2 over the film, as upstream plays its field time over its run time: a channel keys
   `params.warp.flow.time` (Channel and key: a typed property path) from 0 at 0 s to π/2 at 1 s *(chosen: 1 s, linear)*.
   A static `time: π/2` would draw the same square at every frame, and the frame rate would play no part.
2. **The two rates are two films**, the same but for `transport.frame_rate`, each played at its own frames in one
   process, so a flow that keeps state between frames shows at the end.
3. **"Ends rotated 90°"** is the square at 1 s, the flow's end, judged as the whole outline within 0.5 u of the square
   rotated 90° counterclockwise about the plane's origin, both ways, not only its corners.
4. **`streams.starts`** is `{points: [[1, 0, 0]]}` *(chosen spelling)*; step 0.05 (the design's default, written out) and
   time 2π. The flow integrates at the table's step, so the step is the field's.
5. **The flow's group carries the identity `linear` map** as #223's own flow test does, since the design's warp names a
   map and `flow` beside it.

## What the base already does and these tests don't credit

The base has #223's warp with `flow` (it reads a `streams@1` table by layout from the named item's `params.streams`),
the `path` call with `t`, the export plan and the transport's frame rate. It has no `vector_field@1`, so no item builds
a stream table from a `fn`. These tests were not run on the base (`BASE-FAILURE.txt`).

## Not tested

The other criteria of #225; the Oracle page's other ports (criteria 1 to 3) and the criteria with no upstream test. The
field's own streams and arrows, `pad`, `vars`, and seeking against playing (criterion 3's) are not judged here.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
