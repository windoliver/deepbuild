# Acceptance tests for #182, Oracle lane, blind redraft: upstream's character_controller_climb_test, run against our output

Written first, blind, by a job that read only: issue #182 live (`gh issue view 182 --repo windoliver/deepbuild`: Scope,
Fields, criteria); its Oracle page (`doneright/oracles/issues/182.md` on branch `doneright` of `DeepBuildAI/deepbuild`);
the one upstream file the page pins for this test, read once from
`doneright/oracles/vendor/rapier-3406750a38/src/control/character_controller.rs` at that ref (never at run time); the
design (`docs/technical-design.md`: The physics module, Character body; `docs/canvas-primitives.md`: World and backend,
Shape, Body `body@1`, Body `body@1`: character, Input track entries, Physics output); and, for surfaces only, base
`1ab891283` (`crates/deep-physics-rapier/src/main.rs`, `planted.rs`, `runner.rs`: the `bake` call, its `bodies` states and
`track`; `crates/deep-canvas-physics/src/doc.rs`, `doc/inputs.rs`, `track.rs`, `check.rs`, `caps.rs`; this worktree's
`9ae04c6cd` has the same physics crates), with the helper style of `tests/acceptance/191-oracle/`,
`tests/acceptance/2009-oracle/` and the #191 suite's helpers they re-export. No implementation of #182 existed; no other
worktree, branch, stash or pull request was read, nor `tests/acceptance/182/` or `tests/acceptance/182-oracle/`. #136's
rule applies: the linked test counts only when run against our output, so it builds our `physics.world@1` document and
asserts on what `deep-physics` bakes, never on the engine called directly. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1, 3, 8 and 10, the four the page links `character_controller_climb_test` to. This folder ports that
one test. It doesn't stand in for those criteria's own fixtures (the 30°, 50° and 25° ramps, the 20° descent, the
0.04 m and 0.07 m hovers, the test backends), which stay with the #182 suite.

## Source

| Criteria | Upstream, pinned | File (test ported) | Use | Wrong program it rejects | License |
|---|---|---|---|---|---|
| 1, 3, 8, 10 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `src/control/character_controller.rs` (character_controller_climb_test) | port | `--planted slope_limit_ignored` | Apache-2.0 |

No upstream code is copied: the test's world and assertions are re-expressed in `character-controller-climb-rapier.test.ts`,
whose header keeps the upstream file's license notice and says what changed. Its geometry, step rate, motion and
assertion numbers are upstream's except where Deviations says our documents force a change.

## Run

```sh
npm ci                      # once, with node 24.22.0 first on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/182-oracle-redraft-climb --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/182-oracle-redraft-climb/tsconfig.json
rm -rf tests/acceptance/182-oracle-redraft-climb/node_modules/.vite
```

`helpers.ts` builds `cargo build --locked -p deep-physics-rapier --bin deep-physics` once in a `beforeAll` (4-hour
timeout), honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set and
`/opt/homebrew/opt/rustup/bin` first on PATH when it exists, and copies the binary to a temporary folder; the test passes
a 60-minute timeout. No cargo is `BLOCKED:`, never a pass. The only processes it starts are cargo and `deep-physics`,
each stopped by its own PID on timeout. **`scripts/lanes.mjs` needs `'tests/acceptance/182-oracle-redraft-climb/'` in
its `alone` list**; the implementer makes that edit. `BASE-FAILURE.txt` says how the base fails, read from its code
(this job built nothing).

## The surface under test

At the base already: `deep-physics` (JSON lines on stdin, one reply a line) and `--planted <name>` on the shipped
build; the `bake` call with `world`, `steps`, `read` and `track`; its reply's `ok` and `bodies` (`{ID: [state]}`, the
built state at index 0, then one a step), each state's `pos`; the world's `shapes` (`box {half}`,
`capsule {radius, half_height}`), `static` bodies with `pose {pos, rot}` (`rot` a quaternion `[x, y, z, w]`), shape uses
with `contact_material`, `inputs: {ID → {kind, targets}}`, and track entries `{step, kind, target, data}`, an entry
stamped k applying at the start of step k + 1.

New, which the implementer provides:

- **A body of `kind: "character"` accepted by `bake`: its `shapes` one use of a capsule (here radius 0.5 m, half height
  0.001 m, upright), no `follow`.**
- **Its `character` object with `slope_limit` (degrees), `offset` (m) and `snap` (m); `step` and `jump` are left out
  and take their defaults.**
- **A declared `move` input whose targets are character bodies, and its track entry
  `{step, kind: "move", target, data: {velocity: [x, y, z]}}`: the walk the body wants in m/s, held until its next move,
  its part along up (against gravity, +y here) ignored.**
- **The shipped `deep-physics` moving each character body every step through the backend's character controller as
  Body `body@1`: character says: its vertical speed falling only off the ground, sliding along what it meets and keeping
  `offset` from it, a slope steeper than `slope_limit` stopping its climb, snap to ground within `snap`.**
- **Each stepped state of a character body (index 1 on) carrying `character: {grounded: true | false}`: whether a
  walkable surface lies within `offset` + 0.05 m below the capsule after that step's move.**
- **`--planted slope_limit_ignored` accepted by the shipped `deep-physics`: the #182 suite's wrong program, whose
  controller climbs any slope under 45° whatever the body's `slope_limit`.**

## Upstream's world as ours

- `IntegrationParameters::default()` is `step_rate: 60` (dt 1/60 s) and `substeps: 4` (its 4 solver iterations), as in
  the #191 and #2009 Oracle lanes; gravity (0, −9.81, 0) is what upstream passes to its step; seed 182.
- The ground, a fixed body at (0, −0.1, 0) holding a cuboid of half extents (100, 0.1, 100), is a `static` body with that
  `box`. Each slope, a collider without a parent, is a `static` body with its `box` at its translation, turned by its
  `rotation(Vector::Z * angle)`, our quaternion (0, 0, sin(angle ÷ 2), cos(angle ÷ 2)).
- A collider's defaults are one contact material: friction 0.5, restitution 0, density 1 kg/m³ (no body here is
  dynamic, so none is read).
- Each character, a kinematic position-based body holding `ball(0.5)` at (±0.6, 0.5, 0), is a `kind: "character"` body.
  Its controller's `max_slope_climb_angle`, 0.6 ± 0.001 rad, is `slope_limit` 34.43476° (can climb) and 34.32017°
  (cannot), converted exactly; its defaults `offset: Relative(0.01)` and `snap_to_ground: Relative(0.2)` of the ball's
  1 m height are `offset: 0.01` and `snap: 0.2`; its `up`, +Y, is ours (against gravity); `slide: true` is our
  controller's rule. Upstream's climbing ball starts 0.106 m inside the gentle slope (its centre 0.394 m above that
  slope's top face); kept.
- Each iteration's `move_shape(dt, …, Vector::new(0.1, -0.1, 0.0), …)` is one `move {velocity: [6, −6, 0]}` a body,
  entered at step 0 on the bake's track and held for the run; 200 iterations are `steps: 200`.
- Each controller's query excludes its own body, which is our controller's own rule. Each upstream controller reads the
  bodies before either's next kinematic target applies; ours moves each against the world as the last step left it.
- `effective_movement.grounded` at iteration i is `bodies.<id>[i + 1].character.grounded`. The final `translation()` is
  read after the loop, which has applied 199 moves (the 200th is only the next kinematic target), so ours reads
  `bodies.<id>[199].pos`, its y lowered by the capsule's half height (the lower cap's centre, where the ball's is).

## Deviations

1. The move's part along up is ignored (#182 Scope: `move {velocity}`, "its part along up ignored"), so upstream's
   −0.1 m a step (−6 m/s), which presses its balls down, does nothing here; gravity off the ground and snap to ground
   hold the bodies down instead. The velocity is still sent as upstream's (6, −6, 0).
2. So our body climbs faster: on the 0.6 rad slope a (0.1, 0) m step slides to about 0.082 m along it, where upstream's
   (0.1, −0.1) slides to about 0.026 m, and upstream's 8 m slope would be crested near step 130. Upstream's comment
   rules that out: the slope is long enough that the character never reaches its crest within the iteration budget,
   since wrapping around the crest is a knife-edge configuration and not what the test is about. To keep that reason,
   the slope that can't be climbed is 20 m long (half length `slope_size * 5.0`, upstream's `slope_size * 2.0`), its
   centre moved up the slope by the 6 m added so its foot stays where upstream's is, its top face starting at
   (3.842, 0.553). The move walks at most 0.1 m a step, 20 m in 200 steps, and the crest lies 20 m up a face that
   starts more than 3 m ahead of either body. Its angle and width are upstream's.
3. A ball is a capsule of half height 0.001 m (#182 Scope: a character body holds one capsule). Its lowest point is the
   ball's, on the ground, so its centre is 1 mm above the ball's; the final reading subtracts that 1 mm.
4. Upstream's controllers have no autostep and slide only past 45° (`min_slope_slide_angle`); ours always carry a step
   (0.3 m high, the capsule's radius wide, by default, with no field that turns it off) and one slope limit for climbing
   and sliding. Both bodies keep those defaults: a step lifts a body only where `step.width` is free on top, which the
   34.4° face (rising 0.34 m over 0.5 m) doesn't leave, and the blocked body rests at the slope's foot whether or not
   it slides down the face.
5. `additional_mass(1.0)` is left out: a character body pushes no dynamic body, and this world has none.
6. The move is a track entry on the bake call, not a logic item's (criterion 1's own fixture drives one); both are
   entries on the one input track (Input track entries).
7. Upstream asserts inside its loop and panics at the first breach; ours collects each breach as a failure naming the
   body and step and requires none. The thresholds are upstream's: no two airborne steps in a row and at most 3 in all
   for each body; can climb at x > 6.0 and y > 3.0; cannot at x < 4.5 and y < 2.0.

## The wrong program

`--planted slope_limit_ignored`, the #182 suite's: its controller climbs any slope under 45° whatever the body's
`slope_limit`. The body whose limit is 0.001 rad under the 0.6 rad slope then climbs it, past x = 4.5, so upstream's last
assertion fails naming `cannot_climb`; the test requires that failure.

## Criteria to tests

The test's name starts with the four criteria's IDs (`#182.<8 hex>`, `scripts/proof-change.mjs`).

| IDs | File (tests) | Upstream assertion, on our bake | Rejects |
|---|---|---|---|
| AC1 #182.78fd65bc, AC3 #182.11a4f4a4, AC8 #182.a3e169f2, AC10 #182.ca0e2323 | `character-controller-climb-rapier.test.ts` (1) | two ball characters on a 100 m ground, a 0.2 rad slope 4 m long from x 0.12 and a 0.6 rad slope from x 3.84, each sent along +x by a 6 m/s move for 200 steps at 60 Hz: the one whose slope limit is 0.601 rad ends at x > 6.0 and y > 3.0, the one at 0.599 rad at x < 4.5 and y < 2.0, and neither reads airborne on two steps in a row or more than 3 in all | `slope_limit_ignored` |

Test count: 1.
