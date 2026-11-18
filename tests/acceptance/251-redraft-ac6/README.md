# Acceptance tests for #251, criterion 6 redrafted: a vehicle body refused at check in a 2D world, with a follow channel or with a ninth wheel

A blind redraft (design: Dogfooding) of two clauses of criterion 6, `#251.2e102906`:

> A vehicle body in a 2D world, with a follow channel or with a ninth wheel is refused at check, naming the field; on a
> test backend whose caps() list no vehicle controller, a world with one is refused, naming the body and the backend;
> and no Rapier type appears in the physics crate's public items; and a planted check that counts only the wheels
> passes the 2D world and fails, naming the field

This folder covers the first clause (with a check that a right vehicle body is admitted) and the last (the planted
check). The caps() clause and the public-items clause stay with the first draft. ID checked with
`scripts/proof-change.mjs`'s rule: the first eight hex digits of the SHA-256 of the text, trimmed, white space
collapsed.

Written at base commit `a6e742ed0` ("Merge pull request #2708 …"), which has no implementation of #251, by a job that
saw no implementation. The only other commit read was `bf254d0fc`, and only two of its files, `tests/acceptance/251/README.md`
and `tests/acceptance/251/helpers.ts`, for the surface names its blind job chose. Its test files weren't read, and no
other worktree, branch or pull request was. The implementing agent doesn't edit these files (AGENTS.md, Proof).

**It redrafts** the first draft's `fields` and `twin: check_counts_wheels_only` tests in
`tests/acceptance/251/ac6-refusals.test.ts`, as that folder's README lists them. The dispute decides which draft
stands (design: Dogfooding). The first draft's `caps` and `api` tests aren't redrafted.

## What was read

- Issue #251, live (`gh issue view 251 --repo windoliver/deepbuild --comments`): its Scope, Fields, criterion 6 and the
  one comment.
- `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Character body;
  Vehicle body; Behavior kit), Dogfooding and Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (`dimensions: 2 | 3 = 3`, caps(), `drive_vehicle()`),
  Body `body@1` (`follow: channel path (kinematic only)`) and Body `body@1`: vehicle.
- At the base, for surfaces and facts only: `tests/acceptance/523/` (conventions), `2009/`, `2010/`, `1918/` and
  `522/` helpers (the runner, `world()`, `errorsOf`); `crates/deep-canvas-physics/src/check.rs` (the caps refuse every
  2D world at `dimensions`, naming no body: "2D on rapier2d is #2098"), `doc.rs` (the body reader refuses `kind:
  vehicle` with `physics.unsupported`, "#251 brings it", and has no `vehicle` field) and `doc/reads.rs` (`follow` on a
  body that isn't kinematic is already refused at `bodies/<id>/follow`); `crates/deep-physics-rapier/src/runner.rs`
  (a check issue's `ids` is the entry its path is under); `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`
  (`twins.json`) and `scripts/lanes.mjs`.

## Run it

This folder imports `../251/helpers.ts` read only, so it runs beside the first draft's folder.

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # cargo, where it isn't on PATH
npm ci                                             # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/251-redraft-ac6 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/251-redraft-ac6/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/251-redraft-ac6/node_modules/.vite
```

The file builds `deep-physics` once, before its tests (`cargo build --locked --bin deep-physics`, through #2009's
helper, which honors `CARGO_TARGET_DIR`), and copies the binary out. Every test passes #2009's 60-minute timeout. Node
built-ins and vitest only. No process is started but `cargo` and `deep-physics`, each waited for, and none is stopped by
name or port. Nothing here depends on the machine or its load, so no test is INCONCLUSIVE; a missing cargo is
`BLOCKED:`, a failure, never a pass. The folder builds a cargo binary, so `scripts/lanes.mjs` needs
`'tests/acceptance/251-redraft-ac6/'` in its `alone` list. The implementer makes that edit.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The first draft's surface, as its README and `helpers.ts` give it, used here unchanged:

- **`deep-physics`** (#2009's JSON lines): `{"call": "check", "world": <physics.world@1>}` answers `{"ok": true,
  "issues": [...]}`. A refusal is an issue `{code, severity: "error", ids, path, actual, what}`. Its `path` names the
  field, and its `ids` hold the entry the path is under.
- **The vehicle body** is the issue's Fields as written: `{"kind": "vehicle", "shapes", "pose", "mass", "vehicle":
  {"wheels": {name → {"at", "radius", "suspension": {"rest", "travel", "hz", "damping_ratio"}, "grip"?, "steers"?,
  "drives"?, "brakes"?}}, "steer_max"?}}`, with body@1's other fields. The body's ID is `kart`, as the first draft names
  it.
- **The twin** is `deep-physics --planted check_counts_wheels_only`, the first draft's: "the vehicle body's check
  refuses only a ninth wheel: not a 2D world, not a follow channel". Its process must exit 0 and answer each call.
  `twins.json` maps `#251.2e102906` to it.

## The worlds

Each is #2009's `world()` (3D, 120 Hz, 4 substeps, gravity (0, −9.81, 0), `rapier3d` `=0.36.1`) with a static floor
whose top is y = 0, and the vehicle body `kart`: 1,000 kg, a box chassis of half extents 0.9 × 0.25 × 1.7 m centred on
its origin, standing with every wheel just reaching the floor at rest length. Each wheel has radius 0.3 m and
suspension rest 0.3 m, travel 0.2 m, 2 Hz, damping ratio 0.3, mounted on the chassis's underside (y = −0.25). `grip` and
`brakes` are left to their defaults.

| World | What it holds | Must be |
|---|---|---|
| the four-wheeled kart | the issue's car: wheels `fl`, `fr`, `rl`, `rr` at (±0.8, −0.25, ±1.25), a 2.5 m wheelbase and a 1.6 m track; front steering, rear driving; `steer_max: 35` written out | admitted |
| the eight-wheeled kart | wheels `a1l` … `a4r` on four axles at z = 1.25, 0.42, −0.42, −1.25, x = ±0.8; front axle steering, rear axle driving; `steer_max` left to its default | admitted |
| the 2D world | the four-wheeled kart's world with `dimensions: 2`, nothing else changed | refused, naming `bodies/kart/kind` (or `dimensions`, naming `kart`) |
| the follow channel | the four-wheeled kart with `follow: "items/gate/at/pos"` | refused, naming `bodies/kart/follow` |
| the ninth wheel | the eight-wheeled kart with a ninth wheel `a5c` at (0, −0.25, 0) | refused, naming `bodies/kart/vehicle/wheels` (or a path under it) |

All five are checked in one process. The judge (`helpers.ts`'s `judge`) gives one failure per world that isn't as
the table says, each led by the world's name and naming the field it wanted.

## The tests

| Test | What fails it |
|---|---|
| (fields) | either right kart has an error issue; the 2D world, the follow channel or the ninth wheel has no error naming its field as the table gives it |
| (twin: check_counts_wheels_only) | the twin's process not exiting 0 or not answering each check; the judge finding nothing wrong with it; none of its failures being the 2D world's, naming the field `bodies/kart/kind`; or the twin not refusing the ninth wheel |

Test count: 2.

## Readings where the issue leaves a choice

- **"A 2D world"** is the admitted world with `dimensions: 2` and nothing else changed. The only thing wrong with it
  is then the dimension, so the refusal can't come from 2D shapes, vectors or a `rapier2d` backend, which the design
  doesn't spell out for a vehicle body. The base's caps refuse every 2D world at `dimensions` and name no body ("2D
  on rapier2d is #2098"). That refusal is the world's, not the vehicle body's, so it doesn't count.
- **"Naming the field"** (the 2D world): an error at `bodies/kart/kind`, the field the Fields say is "3D worlds only",
  or at `dimensions` if the issue also names `kart` (in its `ids`, or as a word in its `what`). Either way the refusal
  is the vehicle body's own. The design says this refusal names the body; the criterion says it names the field. This
  reading needs both, because only the body tells it apart from the caps' refusal of any 2D world.
- **"Naming the field"** (the follow channel): an error at `bodies/kart/follow`. The base already refuses `follow` on
  any body that isn't kinematic, at that path. This clause holds that refusal for a vehicle body too.
- **"Naming the field"** (the ninth wheel): an error at `bodies/kart/vehicle/wheels` or under it, such as the ninth
  wheel's own path. Wheels are a map by name, so which wheel is "ninth" isn't pinned.
- **"A ninth wheel"** is one more than the most a vehicle holds (≤ 8), so the eight-wheeled kart is admitted and the
  ninth-wheel world is that kart plus one. The pair proves the limit is 8, not the count alone.
- **"Is refused at check"**: the `check` call's error issues. A right vehicle body is admitted when its check has none.
  Warnings don't count.
- **"Passes the 2D world"** under the planted check: no error refuses the vehicle body in it at its field. The world's
  own `dimensions` refusal from the caps still stands. **"And fails, naming the field"**: the judge that passes the
  right program fails on the twin, and one of its failures is the 2D world's, naming `bodies/kart/kind`. The twin must
  still refuse the ninth wheel, because the planted check counts the wheels. Nothing about the follow channel is
  asserted under the twin: the base's generic `follow` refusal may still catch it there.

## Not tested here

The caps() clause (a test backend without a vehicle controller) and the public-items clause (no Rapier type). Both
are the first draft's `caps` and `api` tests. Also not tested: a vehicle body built in a real 2D document (2D shapes
and a `rapier2d` backend), which the base can't build (#2098), and every Scope line beyond criterion 6.

## What the implementer adds outside this folder

`'tests/acceptance/251-redraft-ac6/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this folder changes.
