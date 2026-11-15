# Acceptance tests for #225: vector fields, arrows and stream lines from one formula, integrated at check

Written first, blind, from issue #225 (its Scope, its Fields, its eight acceptance criteria, its Proof line and its
Oracle note), read live with `gh issue view 225 --repo windoliver/deepbuild --comments`; the design sections it names
and those they lean on; its Oracle page with the upstream files that page pins; and base commit `0e5572731` ("Merge
pull request #2529 from windoliver/fix/2362-kit-seal"), by a job that never saw an implementation; none existed, and no
other worktree, branch, PR or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, plus the planted
programs the criteria name. The Oracle page's upstream tests are ported in `tests/acceptance/225-oracle/`.

## What was read

- Issue #225, live, and its one comment (look@1's `strokes.orient: {flow}` should read the field once it lands; no
  criterion asks it). Its criteria are quoted, exactly as their `- [ ]` lines, at the top of each test file.
- `docs/canvas-primitives.md`: Vector field `vector_field@1` (fields, semantics, cost, "It can never"); Constraint
  (`follow_stream`, the `constraint@1` registry, "a build without the data module refuses a document that uses
  `follow_stream` with `module_missing`"); Particles `particles@1`: space and paths; Frame and group: warp (its `flow`,
  read by layout, never by the kind); Logic: data layouts; Scale and encode `scale@1` (a ramp of roles interpolates in
  OKLab); Transport (`frame_rate`).
- `docs/technical-design.md`: How we know version 0 works: Criteria to tests, Closed issues stay proven, Criteria in a
  checked shape, Wrong programs (plants live in test code or behind a build feature), the edit guard, Dogfooding, the
  canvas bullet's goldens and budgets.
- The Oracle page `doneright/oracles/issues/225.md` and `cases/225.json` (DeepBuildAI/deepbuild, ref `doneright`), and
  the vendored upstream files it pins: `tests/unit/animation/test_motion.py` 207–229 and
  `tests/unit/mobjects/test_vector_field.py` 15–59 of an upstream engine's fork at `cfd33af5aa`; the formula lines of
  an upstream engine at `a6d5cc02b4`.
- At the base, for surfaces only: `crates/deep-show` (`src/main.rs`: `run`'s calls, `start_args`, `planted_named`,
  the scenario's `planted`, the build sets and `test-leave-out-data`; `src/query.rs`: `eval`'s `paths` reading
  `items/<id>/at/pos`; `Cargo.toml`'s `test-*` features); `crates/deep-canvas/src/streams.rs` (the core's `streams@1`
  table: fn x and y, vars, step, 2D points); `crates/deep-canvas-test-modules/src/swirl.rs`;
  `crates/deep-canvas-motion/src/doc.rs` (`follow_stream` refused as `module_missing`) and `src/module.rs` (#490's
  planted motion layouts); `crates/deep-canvas-marks/src/modules.rs` (`data`); `scripts/proof-change.mjs`
  (`criterionId`), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), `scripts/lanes.mjs`, `scripts/lane-x86.mjs`;
  the sibling suites `223/`, `223-oracle/`, `226/`, `221/`, `489/`, `142/`, `222/`, `408/` (READMEs, helpers, budget,
  two-machine and taste tests). Code was read only to learn the surface; every expected value comes from the issue and
  the design.

## Run

```sh
npm ci                      # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once, for criterion 5's second machine
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/225 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/225/tsconfig.json   # type-check
rm -rf tests/acceptance/225/node_modules/.vite
```

Each file builds what it uses once, in `beforeAll`, with `cargo build --locked` (`CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies each binary out of the target folder right
after its build, and fails every test whose build failed. Every `it` passes its own long timeout (60 min or more), so
`--testTimeout` only covers hooks.

| Binary | Build | Files |
|---|---|---|
| `show` | `--bin deep-show --no-default-features --features full` | all |
| `show-release` | the same `--release`, only on a machine the perf lane can judge | ac6 |
| `show-no-data` | `… --features full,test-leave-out-data` | ac4 |
| `show-plant` | `… --features full,test-leave-out-data,test-follow-stream-in-motion` | ac4 |
| linux/amd64 | `show`'s build in `docker run --platform linux/amd64 rust:<rust-toolchain.toml's channel>-slim-bookworm`, the checkout read-only, caches under `target/acceptance-225-linux/`, nothing pulled | ac5 |

The files build cargo binaries and one times an integration, so they run one at a time. The implementer adds to
`scripts/lanes.mjs` (this job writes only its two folders):

```js
alone.push('tests/acceptance/225/', 'tests/acceptance/225-oracle/');
timed.push('tests/acceptance/225/ac6-budgets.test.ts');
```

Temporary folders are deleted; `ac8-taste.test.ts` writes its pictures to `docs/evidence/225/`. Node built-ins and
vitest only. A timing that can't be judged here, and a taste call not recorded, fail with a message starting
`INCONCLUSIVE:`; a second machine that can't be reached fails `BLOCKED:` with one ask. None of them is ever a pass.

## The surface under test

The issue names fields and no code API, so these tests extend the base's `deep-show run` (#393): `deep show`, `eval`
(`paths`, `data_hash`, `clean`, `pixels`), `path` with `t` (#223), `schedule` (#185), `registries` (#200) and the
scenario's `planted`. **Every name below that the issue or the design doesn't give is this job's choice, marked
*(chosen)***; the implementer builds exactly these, or a dispute goes to a blind redraft. Everything earlier READMEs
define for these calls stays as it is.

### Documents: the design's fields as the tests spell them

Films as your shell sends them to `deep show` (no `id`, no `layers`), items `{id, kind, name, order, params, at?,
parent?}`, `transport: {span, frame_rate?: "<n>/1"}`, and the top-level `constraints: {ID → {owner, kind, …}}` of #489.

- **`vector_field@1`** params, as the design names them: `fn: {x, y}` or `{x, y, z}` (expression text, the closed
  list's grammar); `scales: {x: ID, y: ID}` (taste pictures only); `arrows: {grid: {x: [a, b, step], y: [a, b, step],
  z?}, color: {by: "magnitude", ramp: [role], domain: [f64, f64]}}` (length left at its default); `streams: {starts:
  {points: [[x, y, z]]}, step, time, pad?, max_points?}` (the design's `grid {…} | points [vec3]` written as keys,
  *(chosen spelling)*, as #223's `linear {matrix}`); `flow: {speed, flash, phase: "hashed" | "zero", warm_up}`.
- **`follow_stream`**: `constraints.<id> = {owner, kind: "follow_stream", vector_field: ID, from: [x, y, z], speed,
  time_offset}`.
- A group's flow: #223's `params.warp = {linear: {matrix: [[1, 0], [0, 1]]}, mix: 1, plane: {origin, unit, y: "up"},
  flow: {streams: ID, time}}`, `streams` naming a vector field.
- Roles: the ramp is `term_blue`, `term_cyan`, `term_yellow`, `term_red` (role 1 to role 4), the dot's fill `ink`.

### `{"call": "vector_field", "doc", "item", "t"}` *(chosen)*

`t` in flicks (default 0). The item, a `vector_field@1` of the presented document, evaluated at `t` in this session:

```
{"outcome": "answered", "dims": 2 | 3,
 "streams": [{"id": "<item>#s<i>", "points": [[x, y] | [x, y, z], …], "bytes": "<base64>"}],
 "arrows": [{"at": [x, y(, z)], "vector": [vx, vy(, vz)], "length": u, "color": {"roles": [role, role], "mix": 0..1}}],
 "trims": [[from, to], …],
 "integrate_ms": ms}
```

- `streams`: one per start, in start order, each its integrated points in the field's own coordinates from the start
  (included) to where it stopped; `bytes` the same points' coordinates as little-endian f64, point after point. `[]`
  without `streams`.
- `arrows`: one per grid point at `t`: `at` the grid point, `vector` the drawn arrow in field coordinates (its
  direction, its length), `length` its length, `color` the ramp's two neighbouring roles and how far from the first to
  the second the arrow's magnitude sits (0 at the first, 1 at the second; the mix itself is in OKLab, the scale rule).
  `[]` without `arrows`.
- `trims`: with `flow`, stream i's trim window at `t`, `[p_i, p_i + flash]` unclamped, p_i = fract(t × speed ÷ time +
  phase_i) (the design's closed form; `time` is the streams'). `[]` without `flow`.
- `integrate_ms`: the wall time the check spent integrating this item's streams, measured by the binary.
- Any other item, or a refused document: `{"outcome": "refused", "code", …}`.

### Elsewhere in `deep-show run`

- `eval`'s `paths` reads `items/<dot>/at/pos` after its follow_stream constraint (the base's `core.transform` read).
- `deep show` of a follow_stream document on a build without the data module: `outcome` not `presented`, an error
  issue `{code: "module_missing", …}` whose JSON names `data` and the constraint (its ID or `follow_stream`).
- `registries`' `constraint@1` row lists `follow_stream` with `module: "data"` in the full build.
- `path` of an item under a flowing group (#223) reads the vector field's stream table by its layout.

### The planted programs *(chosen names)*

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `streams_euler` | the scenario's `planted` (#393's convention, beside #223's `flow_by_vector_field_kind`) | 1 (and the Oracle lane's 1/3) | every stream the data module integrates at check, follow_stream's tables included, stepped by forward Euler at the same step; all else as shipped |
| `test-follow-stream-in-motion` | deep-show cargo feature, never in a shipped build | 4 | the motion module registers `follow_stream` in `constraint@1` itself (as #490's `test-ease-in-motion` declares `ease@1`); built with `test-leave-out-data` |

Criteria 2, 5 and 7 name no twin; their tests show the judge failing on a twin made in test code (an arrow at another
point, one flipped bit in one point's bytes, the group written without its flow), and mutants do the rest.

## Fixtures

All generated in `helpers.ts` and the test files; no file on disk. Films are 640 × 480 u.

| Fixture | What it is | Used by |
|---|---|---|
| the closed orbit | `swirl` (−y, x), one start (1, 0, 0), step 0.05, time 2π | ac1 |
| the arrows | `half` (−y, x)/2, arrows on x, y [−2, 2, 1], ramp of four roles over [0, 2] | ac2, ac8 (step 0.5, on scales) |
| the dot | `swirl` (−y, x), starts (1, 0, 0) and (2, 0, 0), step 0.05, time 8, flow `{speed: 1, flash: 0.3, warm_up: false}`; `dot` with `ride: follow_stream` from (2, 0, 0); 8 s | ac3, ac4 (time 3, one start), ac8 (on scales, 2 s) |
| the Lorenz system | σ 10, ρ 28, β 8/3, start (1, 1, 1), step 0.005, time 40, pad 60, max_points 16,384, arrows on [−30, 30]² × [0, 60] step 10 | ac5, ac8 (on scales, no arrows) |
| a thousand streams | (−y, x), 1,000 starts on a 40 × 25 grid over [−1, 1] × [−0.6, 0.6], step 0.05, time 3 | ac6 |
| the square | `swirl` (−y, x); group `g` on the plane of origin (320, 240), unit 100, y up, identity linear warp flowing along `swirl` for π/2; `square` from the plane's (1, 0) to (2, 1); frame rate 24/1 or 60/1, 1 s | ac7 |

## Criteria to tests

IDs are `#225.` and the first 8 hex digits of SHA-256 of each criterion's text (`scripts/proof-change.mjs`). Each
test's name starts with `AC<n> <ID>`; each file's header states its fixtures, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts | The wrong program each fails on |
|---|---|---|---|
| AC1 `#225.e195f5ff` | `ac1-closed-orbit.test.ts` (2) | one stream `swirl#s0`, from (1, 0), ending within 1e-4 of it, reaching 1.9 away, every point within 1e-6 of the unit circle; under `streams_euler` it ends more than 0.1 away and the judge fails naming `swirl#s0` | the base; the Euler plant; a stream a step short; a y-down or f32 stream |
| AC2 `#225.69823b27` | `ac2-arrow.test.ts` (1) | 25 arrows; at (1, 0): 90° within 0.1°, length and \|vector\| 0.45 × sigmoid(0.5) within 1e-6, colored between role 1 and role 2 at 0.75 within 1e-6; the judge fails on the arrow at (2, 0) | the base; F unhalved; a ramp over [0, 1]; a linear or constant length; y down |
| AC3 `#225.174320e5` | `ac3-follow-stream.test.ts` (2) | the dot at (2, 0) at 0 and within 1e-6 of (0, 2) at π/2 s; at 7.3 s the played and the seeked {trims, dot} have one SHA-256 and one data_hash, the windows [p, p + 0.3] advanced 0.9125 from 0, two distinct phases, the dot on the stream | the base (module_missing); a dot stepped per frame; a phase accumulated per frame; a nearest-point read; unhashed phases |
| AC4 `#225.8a53ced7` | `ac4-without-data.test.ts` (2) | the full build presents the follow_stream document and lists follow_stream as data's; without data it is refused `module_missing` naming data and the constraint, motion@1's digest equals the full build's, motion fills no follow_stream; the plant's digest differs and the judge fails naming `follow_stream` | the base (refused in the full build too; no plant feature); the plant; a no-data build that skips the constraint |
| AC5 `#225.eb041fdb` | `ac5-lorenz-two-machines.test.ts` (1) | one 3D stream `lorenz#s0` of 8,000–8,002 points (≤ 16,384), its bytes its points, the first 1,000 within 1e-6 of RK4 here, both lobes; the linux/amd64 build's bytes equal this Mac's; the comparison fails on a one-bit twin naming point 4000; no Docker: BLOCKED | the base; an integrator whose bits depend on the machine; a stream capped at 512; another method or step |
| AC6 `#225.18b68534` | `ac6-budgets.test.ts` (1) | 1,000 streams of 61–62 points, `integrate_ms` > 0; the file is in `timed`; on a machine judgeLimit can judge, five fresh release runs after a warm-up against 30 ms; **INCONCLUSIVE elsewhere** | the base; no time measured; dearer than 30 ms |
| AC7 `#225.57b5ccba` | `ac7-flow-square.test.ts` (1) | at 24 and at 60 fps, played every frame, the square at 0.5 s and 1 s within 0.5 u both ways of the unit square turned 90° about the plane's origin; the judge fails on the group without flow, naming the square | the base (no field to flow along); a per-frame flow; a field read y down; an Euler flow |
| AC8 `#225.b55d3896` | `ac8-taste.test.ts` (1) | writes the three screenshots and the recording to `docs/evidence/225/` from `eval`'s own snapshots, prints their SHA-256, then reads `TASTE.json`: none or another's is INCONCLUSIVE, `looks_wrong` fails | the base (the films aren't presented); any run without your call |

## The taste call

`ac8-taste.test.ts` writes, from `eval`'s `pixels` snapshots byte for byte (640 × 480): `docs/evidence/225/arrow-field.png`
(F = (−y, x)/2, arrows on a grid of step 0.5 over [−2, 2]², colored through the four-role ramp), `stream-from-1-0.png`
(the stream of (−y, x) from (1, 0) for 2π), `lorenz.png` (the trajectory, x and y on scales over [−25, 25] and
[−30, 30]) and `follow-stream-dot.apng` (the field with its arrows, the stream from (2, 0) and a follow_stream dot
riding it, 0 to 2 s at 30 fps, frames put into one animated PNG unchanged). The pictures' fields sit on linear scales
(80 u a unit) so they are big enough to see. You record the one call in `tests/acceptance/225/TASTE.json`, #226's form:
`{"issue": 225, "criterion": "#225.b55d3896", "verdict": "looks_right" | "looks_wrong", "who", "when": ISO 8601,
"screenshots": {name → sha256, all four}, "note"?}`. This job records none; attaching the files to the PR and showing
them in the session is the implementer's, outside any test. No other test reads a picture to judge it.

## Readings and choices where the issue leaves one

1. **One binary.** Every criterion reads `deep-show run` on the full build set: the vector field and follow_stream are
   the data module's, motion's constraint runs there, and #223's flow and #489's digests are already read there.
2. **Field coordinates.** With no `scales` or `axes`, a vector field's coordinates are its parent's space in u (y as the
   document's), and a follow_stream item under the same parent sits at the field point; so (0, 2) is read off
   `items/dot/at/pos`. A field on `scales` (the taste pictures only) draws through them; a 3D fn on 2D `scales` draws
   its x and y.
3. **"For time 2π at step 0.05"**: fixed steps of 0.05 and, where `time` isn't a whole number of steps, one last
   shorter step landing on `time`, since the criterion's 1e-4 can't hold a step short (0.03 off). Stream point counts
   allow it: 61–62 for 60 steps, 8,000–8,002 for the Lorenz run.
4. **The stream box.** A stream with point starts and no arrows is held to its starts' box widened by `pad`; the
   fixtures set `pad` (and arrows, for Lorenz) so the stream stays inside whichever box the implementation reads.
5. **The arrow's length**: `max` at its default, 0.45 × the grid's step = 0.45 on the unit grid, times sigmoid(|v|),
   the upstream formula the Oracle page names. "+y within 0.1°" is read on `vector` in field coordinates.
6. **"75% of the way from role 1 to role 2"**: the ramp's roles sit evenly over `domain` (role 1 at 0, role 2 at 2/3);
   the answer names the two roles and the fraction. The color space of the mix is the scale rule's (OKLab) and isn't
   read.
7. **follow_stream's table** is integrated from `from` at the field's `streams.step` for its `streams.time`; field time
   is (t − time_offset) × speed. π/2 is taken at its whole flick (1,108,353,888), whose exact turn is within 2e-9 of
   (0, 2).
8. **Seek and play, "by hash"**: playing is one session evaluating every 60 fps frame from 0 to 7.3 s; seeking a fresh
   process asking only 7.3 s, its eval `clean`; the hash is SHA-256 of the JSON of {trims, dot} plus #222's
   `data_hash`. The windows must move by the closed form and the dot along the stream, so equal hashes can't come from
   nothing moving.
9. **A build without the data module** is #489's `test-leave-out-data`. "Naming data": the issue's JSON holds `data`;
   it must also name the constraint, so the field's own missing kind can't stand in. "Fails, naming the entry": the
   same judge that passes the honest build fails on the plant with a failure naming `follow_stream`.
10. **Two machines** are this Mac and linux/amd64 in Docker, #408's way (`scripts/lane-x86.mjs` is deep-logic's own
    lane and isn't reused). Without Docker or the image the test is BLOCKED with one ask, never a pass and never a
    recorded digest.
11. **"In the local preflight"**: the file is in `scripts/lanes.mjs`'s `timed` list (asserted) and judged by the perf
    lane's `judgeLimit`. No `benchmarks/budgets.json` task: the criterion is an absolute limit, not a comparison with
    the merge base.
12. **"At 24 and 60 fps alike"**: the film's `transport.frame_rate`, played on its own frames; the square is read at
    0.5 s and 1 s, times both rates share. The flow's `time` is a JSON number (π/2; its f32 rounding moves the square
    by about 1e-5 u).

## What the base already does, and these tests don't credit

The core's `streams@1` codec (2D points) and its sandbox validator; a group's warp `flow` reading a stream table by
layout (#223, its test module `test.swirl`); deep-show's `eval` with `paths`, `data_hash`, `clean` and `pixels`,
`path` with `t`, `schedule` and `registries`; motion's `constraint@1` entries, with `follow_stream` refused as
`module_missing` (naming no module) in every build; `test-leave-out-data`. Nothing at the base registers
`vector_field@1` (a film holding one is presented with the item skipped as an unknown kind), deep-show has no
`vector_field` call (a scenario holding one answers `bad_input`), no scenario plant `streams_euler` and no cargo
feature `test-follow-stream-in-motion`. Where each test then fails: `BASE-FAILURE.txt`.

## Not tested, because no criterion asks

3D fields on `axes3d@1`; `vars` bound to a path, control or channel and re-integration when one changes, off the frame
thread, showing the last lines meanwhile; `jitter` and `seed`; grid starts; `length.by: linear | constant`; `color.by:
expression`; a stream stopping on a non-finite vector; the 4,096 limits and their refusals; `<id>#streams` read by
particles; the stream's stroke colored by the ramp; `flow.warm_up` beyond seek equals play; look@1's
`strokes.orient: {flow}` (the issue's comment). These are the implementer's own tests.
