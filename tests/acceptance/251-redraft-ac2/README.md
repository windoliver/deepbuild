# Blind redraft of #251's criterion 2: drive and brake

Written first, blind, from issue #251 as of November 15, 2026 (its Scope, Fields, criterion 2 and its one comment), the
design sections it links and base commit `a6e742ed0` ("Merge pull request #2708 …"), by a job that never saw an
implementation, the first draft's test of this criterion, or any worktree, branch or pull request. The one other commit
read is `bf254d0fc`, and of it only `tests/acceptance/251/README.md` and `tests/acceptance/251/helpers.ts`, for the
surface the first blind draft chose, so the suite keeps one surface. The implementing agent doesn't edit these files
(AGENTS.md, Proof); this is the criterion's one redraft (design: Dogfooding).

Criterion 2, `#251.acf8ab9a` (scripts/proof-change.mjs: the first eight hex of the SHA-256 of its text, trimmed, white
space collapsed; checked against the live issue):

> Drive and brake: settled on level ground, with its rear wheels driving, a drive of 2,000 N from rest reaches 4.00 m/s
> at 2 s within 2%, and, from rest and asleep, one of −2,000 N wakes it and reaches 4.00 m/s backwards at 2 s within
> 2%; from 10 m/s a brake of 4,000 N, with that drive of 2,000 N still held, stops it 12.5 m on (m × v² ÷ 2F) within
> 3%, and it never rolls backwards after; and a planted brake that gives each braking wheel the whole force stops it in
> 3.125 m and fails, naming the body

## What was read

- The issue, live (`gh issue view 251 --repo windoliver/deepbuild --comments`), and its comment on the drive from sleep
  (a controller run on a sleeping chassis stores the springs' pushes in its velocity, 1.259 m/s upward, then hops and
  reads 3.617 m/s at 2 s).
- AGENTS.md. `docs/technical-design.md`: The physics module (World; Shape, body; Character body; Vehicle body; Input,
  occurrence, output; Bake and golden), Dogfooding, Tests written first. `docs/canvas-primitives.md`: Body `body@1`:
  vehicle, Input track entries, Occurrence list, Physics output, Physics: behavior kit (its vehicle fixtures: "the brake
  … 12.5 m, within 3%", "the drive … 4 m/s in 2 s, within 2%"), and `physics.world@1`'s `solver.sleep` defaults.
- `bf254d0fc`: the first draft's README (its surface, fixtures and planted names) and `helpers.ts`.
- At the base, for surfaces only: `tests/acceptance/523/` (README, `tsconfig.json`, `twins.json`, a test,
  `BASE-FAILURE.txt`); the helpers of `2009`, `1918` and `522` that `../251/helpers.ts` builds on, and the step
  conventions in the READMEs of `522` and `1918`; `crates/deep-physics-rapier/src/runner.rs` (`bake`),
  `src/occurrences.rs` (`rest` and `wake` rows); `crates/deep-canvas-physics/src/doc.rs` (body fields, `solver.sleep`,
  the refusal of `kind: vehicle`); `scripts/proof-change.mjs`, `scripts/proof-runs.mjs` (`twins.json`),
  `scripts/lanes.mjs` (this folder needs no `alone` entry: it builds and runs only `deep-physics`, as #523's does).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/251-redraft-ac2 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/251-redraft-ac2/tsconfig.json          # type-check
```

`helpers.ts` imports `../251/helpers.ts` read only, as commit `bf254d0fc` holds it (and through it `../522`, `../1918`,
`../2010`, `../2009`, `../191`, `../2012`, `../138`): this folder's tests run wherever the first draft's suite is
checked in. On a checkout without it, put it back unchanged first: `git show bf254d0fc:tests/acceptance/251/helpers.ts >
tests/acceptance/251/helpers.ts`. The file builds `deep-physics` once, in `beforeAll` (#2009's helper: `cargo build
--locked --bin deep-physics`, honoring `CARGO_TARGET_DIR`, Homebrew's rustup put on `PATH`); without cargo a test throws
`BLOCKED:`, a failure. Each test is one `bake` in its own `deep-physics` process, waited for; no process is stopped by
name or port; no network. Node built-ins and vitest only. Nothing depends on load or the machine: nothing here is gated
or INCONCLUSIVE.

`BASE-FAILURE.txt` is the run at the base, trimmed to each test's failing assertion.

## The surface under test

The first draft's (its README: The surface under test), of which this suite uses only:

- **The world document**: `physics.world@1` as #2009's `world()` writes it (3D, 120 Hz, 4 substeps, gravity (0, −9.81,
  0)), with `solver: {"sleep": {"on": true, "speed": 0.05, "time": 0.5}}` written out (the design's defaults); a static
  floor whose top is y = 0; the vehicle body `kart` as the issue's Fields write it, `{"kind": "vehicle", "shapes",
  "pose", "mass": 1000, "vehicle": {"wheels": {fl, fr, rl, rr}, "steer_max": 35}}`, plus body@1's `sleep` and
  `velocity: {"linear"}`; its inputs declared `inputs: {"drive": {"kind": "drive", "targets": ["kart"]}, …}`; no
  outputs.
- **The track**: `track: [{"step", "kind": "drive" | "brake", "target": "kart", "data": {"force": N}}]`. An entry
  stamped k applies in the step from the state after k steps to the state after k + 1 (#522's step convention).
- **The reply** of `{"call": "bake", "world", "track", "steps", "frame_rate": "120/1", "read": ["kart"]}`:
  `bodies.kart[k]`, #2009's state after k steps (`pos`, `rot` as `[x, y, z, w]`, `linear`, `angular`), and
  `occurrences`, #1918's rows, a row's `step` the step after which it was read; sleep and wake are the base's `rest`
  and `wake` rows, `a` the body.
- **The planted brake**: `deep-physics --planted brake_whole_force_each_wheel` (the first draft's name): each braking
  wheel given the whole brake force, not its share. It changes nothing else; its process must exit 0 and answer.

## The fixtures

The first draft's car (`../251/helpers.ts`): `kart`, 1,000 kg, a box chassis of half extents 0.8 × 0.15 × 1.5 m
centred on its centre of mass; wheels `fl`, `fr` (front, steering) and `rl`, `rr` (rear, driving) at (±0.8, −0.15,
±1.25), a 2.5 m wheelbase and a 1.6 m track; radius 0.3 m; suspension rest 0.3 m, travel 0.2 m, 2 Hz, damping ratio
0.3; all four braking (the default); heading +Z. Its centre is 0.75 m up with every spring at rest length, and g ÷
(2π × 2)² = 0.0621 m lower settled.

| Run | Set down | Sleep | Track | Steps | Read |
|---|---|---|---|---|---|
| drive | at rest, springs at rest length | off | drive 2,000 N at step 360 (3 s) | 600 | step 360 and step 600 |
| from sleep | at rest, springs at rest length | on | drive −2,000 N at step 360 (3 s) | 600 | its rest and wake rows; step 360 and step 600 |
| brake | settled (springs 0.0621 m short), at 10 m/s along +Z | off | drive 2,000 N and brake 4,000 N, both at step 0 | 720 (6 s) | every step |
| twin | the brake's, under `--planted brake_whole_force_each_wheel` | | | | |

## The tests

`ac2-drive-and-brake.test.ts`, each title starting `#251.acf8ab9a`:

| Test | What fails it |
|---|---|
| (drive) | the bake refused; its speed at step 360 over 0.05 m/s; its velocity along its heading at step 600 not 4.00 m/s within 2% |
| (from sleep) | the bake refused; its last `rest` or `wake` row by step 360 not `rest`; no `wake` naming it at step 361 or 362; its speed at step 360 over 0.05 m/s; its velocity along its heading at step 600 not −4.00 m/s within 2% |
| (brake) | the bake refused; its velocity along its heading at step 0 not 10 m/s within 1%; its farthest travel along its starting heading not 12.5 m within 3%; that farthest point within 1 s of the run's end; its centre more than 2 cm behind it at any later step; its speed at step 720 over 0.05 m/s |
| (twin: brake_whole_force_each_wheel) | the twin not exiting 0 or not baking; the brake's judge passing on it; no failure of that judge starting `kart stops `; its farthest travel not 3.125 m within 10% |

`twins.json` maps `#251.acf8ab9a` to `brake_whole_force_each_wheel` (scripts/proof-runs.mjs).

## Readings where the issue leaves a choice

- **"Settled on level ground"** for the drives: set down at rest with each spring at rest length (each ray just
  reaching the floor) and left 3 s on its springs, the sag criterion's own settling time, so the controller settles it
  (at 2 Hz and damping ratio 0.3 the bounce falls by e^(−0.3 × 4π × 3) ≈ 1e-5); the drive is stamped at step 360. For
  the brake, which starts at 10 m/s, it is set down already settled, each spring 0.0621 m short, with body@1's
  `velocity` of 10 m/s along its heading, since no input this criterion names brings a car settled at rest to exactly
  10 m/s; a controller that settles a little off 0.0621 m (the issue's comment: 0.0607 m on one variant) leaves it a
  bounce of a millimetre or two.
- **"From rest"**: its speed at the drive's stamp no more than the world's sleep speed, 0.05 m/s. This also fails the
  comment's wrong program, whose sleeping chassis reads 1.259 m/s upward at the stamp.
- **"Asleep"** and **"wakes it"**: sleep on (the body's default and the world's `solver.sleep`), and its last `rest` or
  `wake` row by step 360 is `rest`; the drive wakes it if a `wake` row names it within a step of the drive's first
  step, at step 361 or 362 (criterion 4's "within one step"). The drive "from rest" and the brake run with the body's
  `sleep: false`, so no reading lands on a sleeping chassis.
- **"Reaches 4.00 m/s at 2 s"**: the chassis's velocity along its heading (its local +Z turned by its rotation) in the
  state after step 360 + 240; "backwards" is −4.00 m/s. The issue's 2% is used as given.
- **"With that drive of 2,000 N still held"**: the drive and the brake stamped on the same step, step 0, the first at
  10 m/s, so the drive is held through the whole brake and after the stop (each is held until its next entry, and the
  track has none). A brake that let the held drive push would stop it 25 m on or creep it forward after.
- **"Stops it 12.5 m on"**: the farthest its centre travels along its starting heading, measured from its start, where
  the brake first applies, within the issue's 3%. That farthest point must come at least 1 s before the 6 s run ends
  (else it hasn't stopped), and its speed at the end must be under the sleep speed.
- **"Never rolls backwards after"**: after its farthest point its centre never comes more than 2 cm back. A braked car
  dives on its springs (about 1,100 N moves to the front at 4 m/s², pitching it about 0.011 rad) and springs back when
  it stops, so its centre, 0.69 m above the contacts its brakes hold, comes back up to about a centimetre with no wheel
  rolling; a brake that pushed backwards at its force would move it back more than 10 cm in a quarter of a second.
- **The twin's "stops it in 3.125 m"** (m × v² ÷ (2 × 4F)): the issue gives no tolerance, and this suite takes 10%. At
  16 m/s² the dive unloads the rear springs by about 90%, and their spring-back can lift the rear rays off the floor for a
  few steps, so the twin can stop a few percent long; 10% still tells a brake four times too strong (3.125 m) from two
  times (6.25 m) or eight (1.56 m). **"Fails, naming the body"**: the judge that passes the real program fails on the
  twin's stop, in a failure that starts with the body's ID, `kart stops …`.

## Not tested, because criterion 2 doesn't reach it

The held drive, steer and brake in the vehicle's own state (`vehicles`, criterion 5); wheel outputs; the hop the
comment measures (0.079 m), since the criterion reads only the speed; sideways drift; the behavior kit's drive and
brake fixtures (criterion 7).
