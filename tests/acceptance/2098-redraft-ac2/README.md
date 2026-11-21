# Acceptance tests for #2098, criterion 2: the wind's closed-form time, and its gusts held to the formula

The second run of the blind job that wrote `tests/acceptance/2098/`. That draft left two conditions of criterion 2,
`#2098.7c1127fe`, for the early question, because neither the issue nor the design stated the wind's law or a gust's
formula:

> A body under `wind {velocity: (2, 0, 0)}` with `coupling: {kind: aero_triangles, coefficient: 1}` reaches the wind's
> speed within 1% at its closed-form time; the same seed gives the same gusts by hash on every run.

The owner answered both on November 19, 2026, and the design's Force section was amended to state them. This folder
holds the two conditions from that section: **"within 1% at its closed-form time"**, and that **the gusts are the ones
the formula gives the seed**, with the planted twin failing that check. Everything else of criterion 2 stays the first
draft's: the world is taken at check, the gusts repeat run after run by step hash, another seed gives others. Nothing
here redrafts a test of that folder; both folders stand.

Written at base commit `85203f458` ("Merge pull request #2852 …"), which has no implementation of #2098, by a job that
never saw one, a diff of one, or any other worktree, branch, stash or pull request. The implementing agent doesn't edit
these files (AGENTS.md, Proof). The ID was worked from the issue's body as `scripts/proof-change.mjs`'s `criterionId`
works it and found equal to the one above.

| File | Tests |
|---|---|
| `ac2-wind.test.ts` | 3: the closed-form time; the gusts by the formula; the planted twin |
| `helpers.ts` | the two judges and the closed function list's `noise`, over `../2098/helpers.ts` (imported read only) |
| `twins.json` | the criterion's ID to its planted program, as the first draft's |
| `BASE-FAILURE.txt` | the file run once at the base, and what was probed there by hand |

## What was read

- The issue as saved for the job and its body; the owner's answer to the early question; the Force section as amended,
  whole, read in place of the base's.
- The first draft: `tests/acceptance/2098/README.md`, `helpers.ts`, `ac2-wind.test.ts`, `twins.json`,
  `BASE-FAILURE.txt`.
- `docs/canvas-primitives.md` at the base: The closed function list (its Seeded row), World and backend, Shape, Body
  `body@1` (`locks`), Force, Driver, Physics output. `docs/technical-design.md`: The physics module, Wrong programs,
  Definitions fixed at the start, Dogfooding. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces and facts only: `crates/deep-canvas/src/expr/noise.rs` (the closed function list's `hash`
  and `noise`, step by step), `expr.rs` (how `noise(p, seed)` takes its seed), `expr/tests.rs` and `ops.rs` (the
  pinned sine and cosine); `crates/deep-physics-rapier` (`Cargo.toml`, `main.rs`, `planted.rs`, `lib.rs`'s forces,
  body locks and state, `runner.rs`'s `bake` reply and calls); `crates/deep-canvas-physics/src` (`doc.rs`'s `locks`
  and its refusal of `wind`, `backend.rs`'s body state, and `doc/data.rs`, `doc/inputs.rs` and `track.rs`, looking
  for a surface that evaluates the closed function list); `tests/acceptance/191/` (helpers), `1918/` (a scene's world
  baked through `deep-physics`, its fixture scene), `540/` (the head of `ac6-throw.test.ts`), `251-redraft-ac6/` (a
  redraft folder's shape); `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`, `scripts/lanes.mjs`.
- The pinned backend's source was not needed.

## Run it

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2098-redraft-ac2 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2098-redraft-ac2/tsconfig.json   # type-check
rm -rf tests/acceptance/2098-redraft-ac2/node_modules                                     # vitest's cache
```

As the first draft: one release build of `deep-physics`, made once per file through #191's `prebuild` and copied out;
every test passes #191's 60-minute timeout; Node built-ins and vitest only; no process but `cargo` and `deep-physics`,
each waited for, none stopped by name or port; a process that can't be run fails with `BLOCKED:`, one that doesn't
finish with `INCONCLUSIVE:`. No test times anything.

## The surface under test

The first draft's, unchanged: `deep-physics` asked `{"call": "bake", "world", "steps", "read"}`, the wind written
`{"wind": {"velocity": [2, 0, 0], "coupling": {"kind": "aero_triangles", "coefficient": 1}, "gust": {amplitude, scale,
speed}, "seed"}}`, a body's states in `bodies.<ID>[k]`, and `--planted wind_noise_from_platform_sin`. **This folder
adds no call, no field, no reply field and no planted name.** What an implementer must provide beyond what the first
draft's tests need:

| What | Whose |
|---|---|
| The wind's push on a box: `aero_triangles`, each triangle F = coefficient × area × ((wind − v) · n) × n, at the centroids the Force section gives | the amended design's |
| The gust: the wind at t and p is velocity × (1 + amplitude × noise((p − d × speed × t) ÷ scale, seed)), `noise` the closed function list's | the amended design's (the owner's answer) |
| A wind on a body that writes `locks: {"angular": [true, true, true]}` is taken and pushes it | the field is the base's (Body `body@1`: `locks`); writing it under a wind is **ours** |
| `bodies.vane[k].pos`, `.linear` and `.angular` for every step of a bake of 360 and of 240 steps | the base's reply fields; the first draft read `linear` and `pos`, and `angular` under criterion 3 |
| `deep-physics --planted wind_noise_from_platform_sin` bakes the two locked worlds below; with no gust it blows the steady law; with the gust it still gusts, and not as the formula does | the name is the first draft's; held here to the formula, **ours** |

## The worlds

All are the first draft's `windWorld` (`../2098/helpers.ts`): #191's `world` defaults (3D, 120 Hz, 4 substeps,
`rapier3d` `=0.36.1`) with `gravity: [0, 0, 0]`, one dynamic body `vane`, a `box` of half 0.5 m, `mass: 1`,
`sleep: false`, built at rest at the origin, under the force `wind` with `velocity: [2, 0, 0]` and
`coupling: {kind: aero_triangles, coefficient: 1}`.

| World | What it is | Baked |
|---|---|---|
| the steady wind | the first draft's `steadyWind()`: no `gust`, no `seed`, nothing added | 360 steps, 3 s |
| the locked gusty wind | the first draft's `gustyWind(7)` (`gust: {amplitude: 1, scale: 0.5, speed: 2}`, `seed: 7`) with `locks: {angular: [true, true, true]}` on `vane` | 240 steps, 2 s |
| the locked wind with no gust | the first draft's `calmWind(7)` (`seed: 7`, no `gust`) with the same `locks`; under the planted name only | 240 steps |

## Conditions to tests, and the wrong program each fails on

Sentences in quotes are the amended Force section's.

1. **"Reaches the wind's speed within 1% at its closed-form time."** The steady wind, baked 3 s. From "a body of mass
   m whose two faces across a steady wind w each have area A moves at w × (1 − e^(−2 × coefficient × A × t ÷ m)) from
   rest, and is first within 1% of w at t = m × ln 100 ÷ (2 × coefficient × A): 2.303 s for a 1 kg cube of 1 m at
   coefficient 1, which a world stepped at 120 Hz reaches within 1% of that time" (and the owner's answer, the same
   number):
   - the cube is built at rest;
   - the first step after which its velocity is within 1% of the wind's speed (0.02 m/s) of (2, 0, 0) comes at a time
     within 1% of 1 × ln 100 ÷ (2 × 1 × 1) = 2.3026 s: step 274 to step 279 at 120 Hz;
   - from that step to the run's end it stays within that 1%, as the closed form does.

   The closed form worked in `helpers.ts` is checked to print as the section's 2.303 s. Fails on the base, which
   refuses the force. After the work it fails on a law that pushes the windward side only or by the square of the
   relative wind (never within 1% in 3 s), one that pushes twice as hard (there after 1.13 s), or a body that passes
   the wind's speed and leaves it.
2. **"The same gusts by hash": the gusts are the formula's.** The locked gusty wind, baked 2 s. For each step k + 1
   of the 240, from the cube's own state at t(k) = k ÷ 120 s:
   - the push is "computed once per step from the state at t(k) … and held over the substeps", each triangle's "F =
     coefficient × area × ((wind − v) · n) × n, applied at the triangle's centroid c, with n its normal, the wind read
     at c and t(k), v the body's velocity at c";
   - across x the cube's four triangles have "area 2 × h_j × h_k each", 0.5 m², "and centroids at the face's centre −
     (h_j ÷ 3) along j + (h_k ÷ 3) along k and at the face's centre + (h_j ÷ 3) along j − (h_k ÷ 3) along k": on
     each of the faces at x = −0.5 and x = 0.5, at (x, −1/6, 1/6) and (x, 1/6, −1/6) from the cube's centre. The
     other eight triangles' normals are across the wind and the cube's velocity, so they push nothing;
   - so the cube's velocity v along +x changes over the step to v′ = v + dt × coefficient × area × Σ (wind at each of
     the four centroids − v) ÷ m, and the mean wind it felt is v + m × (v′ − v) ÷ (dt × coefficient × 4 × area) =
     v + 60 × (v′ − v);
   - that is held, within 0.001 m/s, to the mean over the four centroids of "velocity(t, p) × (1 + amplitude ×
     noise((p − d × speed × t) ÷ scale, seed)), with d the direction of velocity(t, p), `noise` the closed function
     list's over the point's three components": 2 × (1 + noise(((x − 2 × t) ÷ 0.5, y ÷ 0.5, z ÷ 0.5), 7)) m/s.

   Not vacuous: held to "a wind with no `gust` blows at its velocity", and to seed 8's gusts, the same run must fail.
   Fails on the base, which refuses the force. After the work it fails on a noise that isn't the closed function
   list's, a gust added in metres a second, a pattern that isn't carried along the wind at `speed`, a wind read at the
   face's centre, across the other diagonal or at t(k + 1), and a seed that isn't read.
3. **The planted twin, `wind_noise_from_platform_sin`.** Both locked winds, baked under the planted name. With no gust
   the cube feels the steady wind at every step (the planted program changes the noise alone); with the gust it fails
   the no-gust judge (it still gusts) and fails the second test's judge, a failure naming the first step whose wind
   isn't the formula's. The wrong program is the planted one; the base doesn't know the name.

**The expected gust is worked in the test from the function's published steps**, never asked of the program and never
recorded from a run of the wind: `helpers.ts`'s `noise` follows `crates/deep-canvas/src/expr/noise.rs` at the base
line for line (the fixed 32-bit integer hash; its fold over the seed and a lattice point; that point's unit gradient;
the quintic fade; the blend of a cell's eight corners). Its sine, cosine and square root are the test machine's where
the base's are the pinned ones, a difference in an f64's last places. `BASE-FAILURE.txt` has the hand probe that held
it against the base's own evaluator at 720 points.

## Readings, where a choice is left

1. **Which quantity each 1% bounds.** The amended section settles it: the speed, within 1% of the wind's; and the
   time of the first such step, within 1% of the closed form's. "Within 1% of w" is read on the velocity, so a body
   moving at 2 m/s another way isn't there.
2. **"Reaches".** The body gets within 1% and stays: the closed form never leaves that band after its time. The
   section gives the stepped world no bound before that time, so the curve itself isn't held step by step.
3. **The gust is held to 0.001 m/s, not by hash.** A step hash is the backend's whole state hashed, and none can be
   worked outside the program, so "by hash" stays the first draft's (the same strings run after run). The tolerance is
   ours: states are f32 (A timeline as data over a pinned backend), which leaves the wind a step implies unsure by
   under 0.0001 m/s, and the nearest wrong reading modelled (`BASE-FAILURE.txt`), the wind read at t(k + 1), is off
   by up to 0.028 m/s.
4. **A held force and a step.** "Held over the substeps" is read as the base's forces act: over a step a force F
   changes a body's velocity by F × dt ÷ m (`BASE-FAILURE.txt`: the base's `drag` does, to 0.000014 m/s of wind).
5. **The cube can't turn.** A gust differs across a face, so the pushes turn a free cube, and the wind it then feels
   would need its turn and all twelve triangles. `locks` on its three turns leaves the law four triangles and one
   line, with the cube's place and velocity read from its own states. The judge fails a locked cube that turns or
   moves across the wind.
6. **The gust's numbers.** The first draft's: amplitude 1, scale 0.5 m, speed 2 m/s, seeds 7 and 8, each seed within
   32 bits, so `noise` takes it as written.
7. **"Wind noise from platform sin".** As the first draft reads it: the gust's noise is drawn from the platform's
   sine in place of the integer lattice hash, so its gusts are others. A program that kept the lattice hash and only
   took its gradients' sine and cosine from the platform would gust as the formula does to an f64's last places; no
   check of states or step hashes on one machine is sure to fail it, and it isn't the twin held here.

## Still open

- **No tolerance for a gust is stated.** The issue says "by hash" and the amended section gives the formula with no
  bound, so 0.001 m/s is this job's (reading 3). A sentence in Force giving the bound would settle it.
- **What the planted program's noise is.** The Proof line says "wind noise from platform sin" and no more. It is
  held as reading 7 takes it. A twin written the other way named there passes the second test's judge, so the third
  test fails on it at "is caught".
- Both conditions are held, and no check was left undrafted for want of a stated value.

## What isn't asserted, because neither condition says so

- A wind with a gust and no `seed` (the world's), and a seed past 32 bits (its halves folded by exclusive or).
- The turn the pushes give a free body, the triangles across y and z, the order the pushes sum in, and a box with an
  offset or beside another shape.
- A wind refused at check on a shape that isn't a box or on a vehicle body; `velocity` as an expression of t and p and
  its bound over 600 s and 10 km; `region` and `strength`.
- The body's speed step by step before it reaches the wind's, and the closed-form time at another mass, size, rate or
  coefficient.
- That no crate calls a platform sin, cos or exp; step hashes across machines or builds; any timing or cost.

## What the implementer adds outside this folder

**`scripts/lanes.mjs` needs this line** (the file builds a cargo binary); this README is the instruction, the
implementer makes that edit:

```js
// #2098's criterion 2 redraft builds deep-physics (release).
alone.push('tests/acceptance/2098-redraft-ac2/');
```

Nothing else but the work itself, and the design's Force section as amended, which lands with it (CONTRIBUTING.md).
