# Acceptance tests for #524: soft@1 ropes, cloth and volumes live on Rapier's soft bodies, drawn through skins, and the three labs as documents

Written first, from issue #524 (its Scope, its Fields for `soft@1`, nine acceptance criteria and its Proof line: "The
rope, banner and soft cube live on Rapier's soft bodies with their skins, seeks and planted twins, and the labs as
documents"), the design sections it names and base commit `e0c90a5a5` ("Merge pull request #2455 …", which holds
#522's, #523's and #525's merges), by a job that never saw an implementation; none existed, and no other worktree,
branch, pull request or plan was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, one test per clause that needs
its own run, plus a test for the planted twin criterion 6 names and for the swapped solver criterion 3 names.
`deep-physics` carries everything a world document alone shows; `deep-show` the documents, the document check and where
a skinned item's vertices are drawn; `deep-gpu` the canvas's own frames for the taste call; `benchmarks/budgets.json`
and its bench the budgets.

## What was read

- The issue, live with `gh issue view 524 --repo windoliver/deepbuild`; for context only, its parent #97 and sibling
  #1786 (the kit's soft fixtures, which #524 unblocks).
- `docs/technical-design.md`: Scenes, physics and the canvas core (Physics); The physics module (World; Soft body and
  checkpoint ring; Input, occurrence, output; Bake and golden; Behavior kit); How we know version 0 works (Dogfooding;
  Criteria to tests; Wrong programs); Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (capacity with `particles`, the interface absorbing
  0.36's break); `soft@1`; Input track entries; Occurrence list (`tear {edges}`); Physics output (`to: skin {item: ID =
  auto, material}`, its lattices and α exact from flicks); Checkpoint ring (its hash: "each particle's position and
  velocity"); Bake; Golden; Physics: behavior kit (the soft measures worked out by the kit from `particle_positions`,
  never reported by a backend); Check input: `physics.determinism`; Extended kinds (`physics.audit`'s settings and
  defaults); Builder (`slab`, `lathe`, `tube`, `ball`, `plate`); Mesh from logic: skins.
- `docs/parallel-proof.md` §12a (budget windows).
- At the base, only for the surfaces these tests extend: `tests/acceptance/2009/`, `2010/`, `2011/`, `1918/`, `1919/`,
  `1921/`, `522/`, `525/`, `252/`, `465/`, `2017/`, `538/`, `420/` (READMEs, helpers, budget and taste tests);
  `crates/deep-physics-rapier` (`runner.rs`, `runner/timeline.rs`, `main.rs`, `planted.rs`, `lib.rs`'s `built`, its
  `Cargo.toml` features); `crates/deep-canvas-physics` (`doc.rs`'s world keys and unknown fields, `doc/reads.rs`, which
  refuses `particle_positions` and skins at the base); `crates/deep-show` (`main.rs`'s calls, `hub.rs`'s `Call`,
  `geometry.rs`, `physics.rs`); `crates/deep-canvas-scene3d/src/builders.rs` (plate's grid gives (nx + 1) × (ny + 1)
  vertices, row-major, a two-sided plate repeating them; tube's rings; slab's plan; lathe's `from` and `caps`);
  `benchmarks/budgets.json`, `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`,
  `judgeTargets`), `benchmarks/canvas.mjs`'s `judge` report; `scripts/proof-change.mjs` (criterion IDs),
  `scripts/proof-runs.mjs` (`twins.json`); `docs/evidence/252`, `465` and `525` (the taste call's shape). The Rapier
  0.36.1 crate in the cargo registry, for what a soft body is there (each has a hidden root rigid body and cluster
  proxies, a volume factor, tearing that splits pieces, and two solvers).

What the base already does, which these tests don't credit: `deep-physics` builds, bakes, restores, seeks
(`seek`, world documents only), checks determinism (`determinism`, world documents only), records and verifies goldens
(world documents only), and takes `{scene, world}` for `check` and `bake` (#1918). Its world reader refuses `soft` as
`unknown_field`, refuses an output's `read: particle_positions` and `to: {skin}` as `physics.unsupported` ("#1786
brings it"), has no `audit` call, no `particles` in a reply, no `soft` or `backend` in `check`, and no
`volume_without_constraint` or `test-swap-soft-solver`. No lab document exists. `benchmarks/budgets.json` holds no
physics task.

## Run them

```sh
npm ci && npm run build --workspaces --if-present   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/524 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/524/tsconfig.json
```

`--no-file-parallelism` is required: two files' builds of `deep-physics` (one with `test-swap-soft-solver`) share the
target folder, and each copies its binary out after its own build. Each file builds `deep-physics` once, in `beforeAll`
(#2009's helper), honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set,
Homebrew's rustup put on PATH when present. `deep-show`, `deep-gpu` and the swapped `deep-physics` are built when a test
first needs one, once per file, so a test whose first assertion fails builds nothing more:

| File | Builds |
|---|---|
| `ac1-labs.test.ts` | `deep-physics`; `cargo build --locked -p deep-show --bin deep-show` |
| `ac2-balloon.test.ts` | `deep-physics` |
| `ac3-solver-swap.test.ts` | `deep-physics`; `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-swap-soft-solver` |
| `ac4-skins.test.ts` | `deep-physics`; `deep-show` |
| `ac5-rope-and-banner.test.ts` | `deep-physics` |
| `ac6-soft-cube.test.ts` | `deep-physics`; `deep-show` |
| `ac7-module-budgets.test.ts` | `deep-physics`; on a reference Mac at rest, whatever `benchmarks/physics.mjs module` builds |
| `ac8-taste.test.ts` | `cargo build --locked --bin deep-gpu` |
| `ac9-soft-lab-budgets.test.ts` | `deep-physics`; on a reference Mac at rest, whatever `benchmarks/physics.mjs soft-labs` builds |

Every test passes a 60-minute timeout (#2009's `TIMEOUT`; the budget tests four times that). Stores, evidence folders
other than `DEEPBUILD_EVIDENCE_DIR` and binaries are temporary and deleted. Node built-ins and vitest only;
`../522/helpers.ts` (and through it `../1918`, `../2010` and `../2009`), `../1921/helpers.ts` (`forGpu`, `LOOK`) and
`../252/helpers.ts` (`apng`, `sha256`) are imported read only. No process is started but `cargo`, `git`, `node`,
`deep-physics`, `deep-show` and `deep-gpu`, each waited for; none is stopped by name or port.

Gates. No cargo on this machine is `BLOCKED:` (#2009's helper), a failed test, never a pass. The budget tests judge a
timing only where `scripts/benchmark.mjs`'s `judgeLimit`, given five zero readings against a limit of 1 (#522's
`standing`), reads PASS (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at the
test's start and at the gate under the core count); otherwise they fail with `INCONCLUSIVE:` and the rule's reason,
after everything that doesn't depend on load. The taste test is `INCONCLUSIVE:` off macOS and without your recorded
call. Nothing else depends on the machine.

## The surface under test

The issue names `soft@1`'s fields, skins, a target volume ratio read back from the built body, tear occurrences,
seeks, physics.determinism and physics.audit, labs as documents, budgets and a planted volume, but no command line.
**Every call, field, reply field, flag, cargo feature, path, task and planted name below that the issue or the design
doesn't give is this job's invention**, the smallest the criteria need, extending #2009's, #2010's, #1918's, #1921's and
#522's `deep-physics` (their READMEs' surfaces stand as written), #393's `deep-show run` with #420's `geometry`, #377's
`deep-gpu run` with #378's `view3d`, and §12a's budget record. The implementer builds exactly these, or a dispute goes to
a blind redraft.

### The world document: `soft`

A `physics.world@1` document may hold **`soft: {ID → Soft}`**, each a `soft@1` body with the issue's fields by their
names, flat beside `shape` (as a Shape's fields sit beside its `kind`):

- `shape: "rope" | "cloth" | "balloon" | "volume"`;
- rope: `from`, `to` (vec3, m) and `particles` (u16), or `positions: [vec3]`; its particles are addressed by their
  index as text, `"0"` … `"39"`;
- cloth: `origin`, `du`, `dv` (vec3, m) and `nu`, `nv` (u16): particle `r{row}c{col}` (with `address: "r{row}c{col}"`)
  rests at `origin + col × du + row × dv`, `col` in 0 … nu − 1 and `row` in 0 … nv − 1;
- balloon: `center` (vec3), `radius`, `subdivisions`, `inflate` (= 1);
- volume: `from` (an item ID of the scene the world runs in), `max_particles` (= 2,048), `inflate` (= 1); its
  particles are the source's welded vertices, addressed `v{i}` in the source's vertex order: the item's evaluated mesh,
  positions equal to 1e-6 m one vertex, numbered in order of first appearance, placed where the item is drawn;
- and `edges`, `address`, `masses: {default, by}`, `pins: [address]`, `pinned_to: {address → body ID[#anchor] |
  "world"}`, `clusters`, `stretch`, `shear`, `bend` (`{hz, damping_ratio}`), `tension_only`, `particle_radius`,
  `self_contacts`, `damping`, `tear: {strain, force, smoothing}`, `contact_material`, `collision_group`. An address in a
  body's own fields is local (`r0c0`); elsewhere it is `<soft ID>#<address>`.

A field `soft@1` doesn't define, such as a balloon's `pressure`, is refused at check with an error issue whose `path` is
`soft/<ID>/<field>` (its code is the implementer's). `capacity.particles` counts every soft body's particles.

**Skins** (Physics output): an output `{"from": soft ID, "read": "particle_positions", "to": {"skin": {"item": item ID |
"auto", "material"?}}}` draws the soft body on an item of the scene. With `"auto"` the core builds the item itself: for a
rope a tube, a cloth a plate, a balloon a geodesic ball, each with the ID **`<world ID>.<output ID>`** (so `lab.onto_own`);
for a volume its source item, which keeps its own ID. A pairing whose item isn't on the body's lattice (a plate whose
grid isn't nu × nv vertices, a tube whose path isn't the rope's particle count) is refused at the document check with an
error issue naming both the item and the soft body (in `ids`, `path` or `what`, its own or a physics issue it carries in
`actual`).

### `deep-physics`: what this suite adds

| Call | Reply |
|---|---|
| `check` (#2009's; #1918's `{scene, world}`) | #1921's, plus **`"soft": {ID: {"shape", "particles": n, "target_volume_ratio": r \| null}}`** and **`"backend": {"rigid_bodies": n, "joints": n, "soft_bodies": n, "particles": n}`** |
| `bake` (#2009's to #522's fields) | plus **`"particles": {ID: {"addresses": [address], "positions": [[[x, y, z]]]}}`** |
| `seek` (#522's), now also on **`{scene, world: "<world ID>"}`** | plus `"particles"` as `bake`'s, from the restored step on |
| `determinism` (#522's), `golden` and `golden_verify` (#2010's), now also on **`{scene, world: "<world ID>"}`** | as before |
| **`{"call": "audit", "world" \| "scene" + "world", "track"?, "steps": n, "settings"?: Settings}`** | **`{"ok": true, "kind": "physics.audit", "verdict": "PASS" \| "FAIL", "settings": Settings, "failures": [AuditFailure]}`** |
| `runtime` (#2010's) | plus **`"soft_solver": string`**, the name of the solver that steps soft bodies in this build |

```text
Settings     = {"settle"?: {"by": s, "speed": m/s}, "energy": {"max_gain": ratio per s}, "max_speed"?: m/s,
                "penetration": {"max": m}, "joints"?: {"max_error"}, "faults": [kind], "soft": {"max_stretch": ratio}}
AuditFailure = {"rule": "settle" | "energy" | "max_speed" | "penetration" | "joints" | "faults" | "soft",
                "id": ID | null, "step": k | null, "measured": number | null, "limit": number | null, "what": string}
```

- **`soft`** in `check` reads each soft body back from the backend's built body: `shape` as declared, `particles` its
  particle count, `target_volume_ratio` its volume constraint's target over its rest volume (Rapier's volume factor), null
  for a body with no volume constraint (a rope, a cloth).
- **`backend`** counts what the backend built, read from its own sets: `rigid_bodies`, every rigid body other than a
  soft body's own (Rapier gives each soft body a hidden root body and each cluster a proxy, which aren't counted);
  `joints`, every joint (impulse and multibody); `soft_bodies`; `particles`, theirs summed. `built` (#1921's) stays the
  rigid bodies built for the document's bodies.
- **`particles`** in a bake (and a seek): for each soft body (or those `read` names, with the bodies), its `addresses` in
  the order its positions come, and `positions[j][i]`, particle `addresses[i]`'s position after `j × every` steps (index
  0 the state as built, or for a seek the restored state), f32 values as JSON numbers. Like `bodies`, it comes only from
  a bake that simulated.
- **Step hashes, checkpoints and seeks** cover soft bodies: the step hash reads each particle's position and velocity
  (Checkpoint ring), a checkpoint holds the soft bodies whole, and a seek restores them.
- **Occurrences**: a tear writes a row `{"kind": "tear", "a": soft ID, "b": null, "edges": [[address, address]]}` (#1918's
  Row), each edge two local addresses (`["r3c14", "r3c15"]`; the full `banner#r3c14` form is read too), every edge that
  tore in that step listed in exactly one row, once.
- **`audit`** is physics.audit over the run of `steps` steps from step 0 on the track. With no `settings`, or for each
  key it omits, it runs at the design's defaults (canvas primitives, Extended kinds): `energy.max_gain` 0.01,
  `penetration.max` 0.01 m, `faults` `[nan, capacity, speed_cap, penetration]`, `soft.max_stretch` 1.1 (each soft body's
  most stretched edge, its length over its rest length); `settle`, `max_speed` and `joints` have no default and are off
  unless given. `settings` echoes what it ran with. `PASS` with no failures, else `FAIL`; a `soft` failure names the
  body in `id`.
- A **check of a soft volume** from an open source (some edge on one triangle only, welded at 1e-6 m) is refused with an
  error issue holding **`"edge": ["v{i}", "v{j}"]`**, the two welded vertices of an open edge; one past `max_particles`
  is refused naming the count.

### The swapped solver (criterion 3)

Cargo feature **`test-swap-soft-solver`** of `deep-physics-rapier`: `deep-physics` built with it steps soft bodies with
another solver (Rapier's other soft-body solver, or one of ours), and changes nothing else: every world document runs
unchanged, `runtime`'s `soft_solver` names the other solver, and the feature's name appears under `crates/` only in
`crates/deep-physics-rapier/Cargo.toml` and in one `.rs` file of that crate. It is a test build, never shipped, and not a
wrong program: both builds must pass.

### Planted twin of `deep-physics`

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted volume_without_constraint` | 6 | a soft volume is built without its volume constraint (no target volume, no inflate); nothing else changes |

Its process must exit 0 and answer; the judge that passes the real program must fail on it. `twins.json` maps
criterion 6's ID to it.

### `deep-show`: what this suite adds

- The physics module runs `soft` bodies and skins in a scene a session presents (#1918's `worlds`), refusing what the
  check refuses, and the document check refuses a skin off its lattice (above).
- **`geometry`** (#420's `{"call": "geometry", "doc", "items": [ID], "t": flicks}`) answers a skinned item as drawn at
  `t`: `positions` (item space; through the row's `world` matrix, 3 × 4 rows, identity when absent, they are where each
  vertex is drawn in world metres), `normals`, `indices`, and for a tube its `rings` (#441's, each with `vertices`). It
  also answers an item the core built for `item: auto` by its ID `<world ID>.<output ID>`, with its `kind`.
- Driven unchanged: #393's scenario (`evidence`, `sessions`, `processes`, `panels`, `docs`, `calls`), `deep_show` with
  `include: ["issues"]`, a refused document's `outcome: "refused"`.

### `deep-gpu`: what this suite adds

`view3d` (#378's, with #1921's `worlds`) draws a scene's soft bodies through their skins: the labs' documents and the
soft cube, each in the session's form (`forGpu`), frames at the call's `fps`, `final` PNGs named by their SHA-256 in
`out`.

### The labs

Three documents in the repo, each a scene in the agent's form (#421's payload: no `id`, no `layers`) whose world
**`lab`** (`worlds.lab`) the lab runs, presented by the app with no error issue:

- **`packs/examples/labs/rope-bridge.json`**: a rope bridge a heavy ball rolls across, standing on soft ropes (at least one
  soft body of `shape: rope`), about 35 bodies and particles (30 to 40, as `check`'s `backend` counts them: rigid bodies
  plus particles) and 32 joints;
- **`packs/examples/labs/banner.json`**: a banner in gusty wind you can poke, its soft body **`banner`** a cloth of `nu: 28`,
  `nv: 10`, `address: "r{row}c{col}"`, drawn on a plate by its skin;
- **`packs/examples/labs/ball-and-goal.json`**: a ball that bounces down ramps into a goal.

The tests read each file, take `worlds.lab` as the world and the file as its scene, and run them over their first 600
steps (5 s) with an empty track.

### The budgets

Two tasks in `benchmarks/budgets.json` (§12a), each with `"margin": 0.5`, `"limits": {}`, an `initialReason` naming
#524 and `criteria` naming its criterion:

| Task | Command | Targets | Criteria |
|---|---|---|---|
| `physics-module` | `["node", "benchmarks/physics.mjs", "module"]` | `{"bridge_step_ms": 2, "stress_step_ms": 2, "bake_10s_ms": 1000, "world_mb": 50, "startup_ms": 5}` | `#524.584c6e80` |
| `physics-soft-labs` | `["node", "benchmarks/physics.mjs", "soft-labs"]` | `{"bridge_step_ms": 2, "banner_step_ms": 2}` | `#524.d7f0282a` |

`benchmarks/physics.mjs <mode>` measures in a release build and prints its report as its last stdout line;
`benchmarks/physics.mjs judge` reads `{current, base}` on stdin and prints `{"task", "status": "PASS" | "FAIL" |
"INCONCLUSIVE" | "BLOCKED", "targets": {name → judgeLimit's verdict}, "reason"?}` (as `canvas.mjs judge` does), so
`scripts/benchmark.mjs`'s `judgeTargets` runs it. What each target reads, each on five runs after a warm-up one:
`bridge_step_ms` the 95th percentile of the CPU time of a 120 Hz step of the rope bridge lab's world;
`stress_step_ms` the same of a 200-body stress world (200 dynamic 0.5 m boxes in a 5 × 8 × 5 stack on a static floor,
#522's `stack(5, 8, 5)`); `bake_10s_ms` a 1,200-step bake of the bridge lab's world; `world_mb` the peak memory of a
world over that bake; `startup_ms` what the physics module's seal checks (its interface checks and runtime digest) add
to `deep-show`'s startup; `banner_step_ms` as `bridge_step_ms`, of the banner lab's world. The soft-labs mode steps
each lab over the 600 steps its golden records.

### The taste call

The test keeps its screenshots and recordings in **`DEEPBUILD_EVIDENCE_DIR`** (else `deep-524-taste` in the temporary
folder) and prints their paths. You record the call in a file named by **`DEEPBUILD_TASTE_524`**: `{"criterion":
"#524.b97ba86d", "by": "you", "screenshots": [sha256 × 3], "recordings": [sha256 × 3], "call": "looks_right" |
"looks_wrong"}`.

## Fixtures (helpers.ts and the test files)

g = 9.81 m/s², 120 Hz, 4 substeps, seed 524, a checkpoint every 60 steps; materials `ground` (friction 0.8), `cloth`
(0.5), `jelly` (0.8), `rubber` (0.5), restitution 0. A cloth here has 0.01 kg a particle, stretch 30 Hz, shear 10 Hz,
bend 1 Hz (damping ratio 0.5), damping 0.5/s; a rope 0.05 kg a particle, stretch 30 Hz, bend 1 Hz.

- **The banner**: 28 × 10, flat in the xz plane 3 m up (origin (−1.35, 3, −0.45), du (0.1, 0, 0), dv (0, 0, 0.1)),
  its row 0 pinned, so it swings down. As `flag` it is skinned onto `sheet` and onto its own plate (`skinnedCloth`, 2 s
  at 50 fps); alone it is criterion 5's seek world; with the rope (2 m, 40 particles, 4 m up, pins "0" and "39") over a
  static floor it is criterion 5's built world.
- **The torn banner**: the same lattice upright in z = 0 with no gravity and `tear: {strain: 0.25}`, column 0 pinned in
  place, column 27 pinned to `puller`, a kinematic sensor post that follows the scene's channel `grip` at 1 m/s along +x.
- **The flat cloth** `still`: 28 × 10, upright in z = 0 (origin (−1.35, 2, 0), du (0.1, 0, 0), dv (0, −0.1, 0)), no
  gravity, no pins, skinned onto the one-sided plate `pane` (28 × 10 vertices).
- **The rope on a tube** `cord`: 40 particles 0.05 m apart along +x from (0, 2, 0), pinned at "0", swinging down,
  skinned onto `hose`, `tube@1 {path: its 40 resting points, radius: 0.02, segments: 8, caps: "none"}`.
- **The limp cloth** `limp` (the audit's control): 10 × 10, upright, row 0 pinned, stretch 0.5 Hz, under gravity.
- **The two balloons**: radius 0.5 m, subdivisions 2, inflate 1.2 (`b12`) and 1.5 (`b15`).
- **The soft cube** (`cubeScene`): `cube`, `slab@1 {size: [1, 1, 1]}` at (0, 0.02, 0), the source of `jelly` (volume,
  inflate 1.2, 1 kg a particle, stretch 8 Hz, damping ratio 0.5), skinned back onto `cube`; the ground plane y = 0; the
  1 kg ball (radius 0.1 m, gravity_scale 0) at rest at (−1.5, 0.55, 0) until `kick`'s entry `{step: 360, kind: "launch",
  target: "ball", data: {linear: [5, 0, 0]}}`; 7 s at 50 fps (60 for the taste call).
- **The two lathe cubes**: `lathe@1` of 4 segments from 45° (a 1 m square, its corners √½ m out), 1 m tall, `caps:
  "none"`: `shut`'s outline through the axis at both ends, `open`'s at the bottom only.
- **The sampled times**: 50 fps frames 3, 7, … 79 (0.06 s to 1.58 s; frame f is step 2.4 f), 16 between steps.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#524.98cf72b1` | `ac1-labs.test.ts` (3) | The three lab documents exist at their paths; each world builds in its scene with no error issue, the bridge on soft ropes, the banner a 280-particle cloth `banner` declared 28 × 10, r{row}c{col}; the app presents all three with no error issue. physics.determinism of each over 600 steps at [1, 2.5, 4.5] s: PASS, no failure. physics.audit of each with no settings: run at the defaults (echoed), PASS, no failure, and the bake writes no `fault` row; the same audit FAILs a 0.5 Hz cloth, a `soft` failure naming `limp`. Fails: a lab missing or refused, a check that can't fail, a fault, settings not the defaults |
| 2 `#524.f05ac03c` | `ac2-balloon.test.ts` (2) | `check`'s `soft` reads `b12`'s and `b15`'s target volume ratios back as 1.2 and 1.5 (1e-6). `pressure: 2` on `b12` is refused with an error at `soft/b12/pressure`; the world without it is admitted. Fails: a ratio dropped or constant, a pressure taken, a refusal elsewhere |
| 3 `#524.4c32c52f` | `ac3-solver-swap.test.ts` (1) | Seven worlds (the suite's and the labs') admitted and baked 120 steps by the shipped build and by `test-swap-soft-solver`; `runtime.soft_solver` differs; the banner's step hashes differ; the feature named under `crates/` only in deep-physics-rapier's Cargo.toml and one of its `.rs` files. Fails: a swap that needs a document changed, that changes nothing, or that spreads over modules or crates |
| 4 `#524.f18cb67c` | `ac4-skins.test.ts` (4) | The banner skinned onto `sheet` (28 × 10 vertices) and onto `lab.onto_own` (a plate@1 of 280 or 560): every vertex within 1e-6 m of its particle's interpolated position at the 20 sampled times. A flat cloth at rest: every normal within 0.1° of the plane's, on one side. A 40-particle rope on a 40-point tube: ring k's centre within 1e-6 m of particle k at the 20 times. A 27 × 10 plate refused, an error naming `sheet` and `flag`; 28 × 10 presented. Fails: held (unlerped) or stale positions, a wrong vertex order, no auto plate, normals not recomputed, rings out of order, a pairing not checked |
| 5 `#524.78f2e1a8` | `ac5-rope-and-banner.test.ts` (3) | `runtime` rapier3d 0.36.1; `check`: rope 40 particles, banner 280, 2 soft bodies, 320 particles, 1 rigid body (the floor), 0 joints; both move in 120 steps. The torn banner's `tear` rows list each edge once, each a lattice edge, every row or column edge longer than 0.15 m at 3 s among them. Seek to 90, play 600: from 60, hashes and particles for steps 60 … 690 equal the bake's; the hash changes every step 61 … 180 with no rigid body in the world. Fails: rigid bodies or joints standing in, an edge listed twice or missing, a checkpoint or hash without the particles |
| 6 `#524.49daa6e5` | `ac6-soft-cube.test.ts` (6) | One volume of 8 particles v0 … v7 at the cube's corners, 2 rigid bodies, no joint. Settled (steps 300 … 360) within 1.176 … 1.224 m³, on the ground; the ball at 5 m/s; a dent of at least 5 mm; back within the band from 2 s to 2.5 s after the dent began. The skin: each vertex of `cube` within 1e-6 m of particle v{welded index} at the 20 times, and v{i} at step 0 the cube's welded vertex i. Seek to 150, play 600: from 120, hashes and particles equal for 120 … 750. A volume from the closed lathe cube admitted, from the open one refused with `edge` an open edge of it. `volume_without_constraint`: settled at most 1.02 m³, and the settled judge fails naming `jelly`. Fails: rigid stand-ins, no inflate, no dent or no return, a skin off its particles or welded order, a seek without the soft body, an open source taken |
| 7 `#524.584c6e80` | `ac7-module-budgets.test.ts` (1) | The record (`physics-module`, the issue's numbers, margin 0.5, #524, the ID; valid against the merge base); the bridge lab: soft ropes, 32 joints, 30 … 40 bodies and particles; on a reference Mac at rest, the task's judge: every target judged, PASS (FAIL fails; else INCONCLUSIVE). Fails: no record, other numbers, a bridge not as the criterion names it, a budget missed |
| 8 `#524.b97ba86d` | `ac8-taste.test.ts` (1) | Three screenshots (frame 180, 640 × 360) and three recordings (frames 0 … 89 at 30 fps, 320 × 180) of the bridge lab, the banner lab and the soft cube, from `view3d`'s own final PNGs, kept and printed; the call read from `DEEPBUILD_TASTE_524` on those hashes: `looks_right`, else INCONCLUSIVE (no or another call) or FAIL (`looks_wrong`) |
| 9 `#524.d7f0282a` | `ac9-soft-lab-budgets.test.ts` (1) | The record (`physics-soft-labs`, the issue's numbers, margin 0.5, #524, the ID; valid against the merge base); the bridge on soft ropes, the banner's 280-particle cloth; each lab's 600-step golden recorded and verified here (PASS); on a reference Mac at rest, the task's judge: both targets judged, PASS (FAIL fails; else INCONCLUSIVE). Fails: no record, other numbers, labs off soft bodies, goldens that don't repeat, a budget missed |

Test count: 3 + 2 + 1 + 4 + 3 + 6 + 1 + 1 + 1 = 22.

## Readings where the issue leaves a choice

- **The surfaces.** `deep-physics` carries what a world document alone shows, as #2009's to #522's suites do; a world
  whose soft volume is built from an item, or whose skin draws one, arrives with its scene (`{scene, world}`), so
  `seek`, `determinism`, `golden`, `golden_verify` and `audit` take that form too. `deep-show`'s `geometry` is the
  smallest call that says where each vertex of an item is drawn at a time, and the document check is the app's.
- **"Read back from the built body"** (criterion 2) is `check`'s `soft[ID].target_volume_ratio`, read from the
  backend's built soft body (Rapier's volume factor), never echoed from the document; "1.2" is within f32's rounding.
- **"Naming the field"** (criterion 2) is an error issue whose path is `soft/b12/pressure`; the code is the
  implementer's (an unknown field's or another).
- **"Changes one module and no world document"** (criterion 3): no document changes because the same bytes run on both
  builds; "one module" is one source file of the physics module's backend crate, the only place the swap is named, with
  no other crate naming it. That the swap is real is shown by its solver's name and by different step hashes.
- **"About 35 bodies and particles, 32 joints"** (criteria 7) is 30 to 40 rigid bodies plus particles as `check`'s
  `backend` counts them, and exactly 32 joints.
- **"Draws every vertex at its particle's interpolated position"** (criteria 4 and 6): a plate's vertex (col, row) is
  particle r{row}c{col}; a two-sided plate's back repeats its front, so vertex k is particle k mod 280; a volume's
  vertex is the particle of its welded vertex. The interpolation is Physics output's: k = ⌊t ÷ step⌋, α exact from
  flicks, positions lerped. The 20 times are 50 fps frames, 16 of them between steps.
- **"Passes through its particles in index order"** (criterion 4) is ring k's centre (the mean of its vertices, which
  sit evenly round it) at particle k's interpolated position, within the cloth's 1e-6 m, k = 0 … 39.
- **"Within 0.1° of its plane's"** (criterion 4) is the angle between each normal's line and the plane's normal (from
  the particles), all normals on one side of a one-sided plate. The flat cloth stands upright so the plate builder's
  own +Y normals are 90° off.
- **"Naming both items"** (criterion 4) is the plate and the soft body.
- **"No rigid body or joint stands in"** (criteria 5 and 6) is `backend`'s counts: only the declared rigid bodies (a
  soft body's own hidden root and cluster proxies aside) and only the declared joints.
- **"List every torn edge once"** (criterion 5): no edge in two rows or twice in one; each a pair of neighbouring
  particles; every row or column edge longer than 1.5 × its rest length at the end (which a stiff, intact edge never
  is) listed. Diagonal edges may be listed and aren't required, since whether `edges: grid` holds them is the
  implementer's.
- **"Seeking … equals playing by step hash for 600 steps"** (criteria 5 and 6) is #522's `seek` from a checkpoint
  (the one at or before the target) playing 600 steps past it, its hashes equal to the bake's, and its particles equal
  too, so a checkpoint or hash that leaves the soft body out can't pass.
- **"Once settled … holds 1.2 m³ within 2%"** (criterion 6) is every step from 2.5 s to 3 s within 1.176 … 1.224 m³,
  measured here from the particles (the cube's six faces, each four triangles about its centre, closed on the body's
  centre); "dents it" is some distance between two particles moving at least 5 mm from its settled length (a rigid
  motion moves none); "returns … within 2 s" is every step from 2 s to 2.5 s after the dent began (its first 1 mm)
  back within the band. The ball flies without gravity so it meets the cube's middle at 5 m/s.
- **"A cube with one face removed"** (criterion 6) is a lathe@1 cube open at its top, built by an existing builder; the
  closed lathe cube is its twin, admitted. "Naming an open edge" is the issue's `edge`, two welded vertices of an edge
  on one triangle only; which open edge is first is the implementer's.
- **"Holds no more than its rest 1 m³"** (criterion 6) is at most 1.02 m³ (the criterion's 2%) at every settled step;
  "fails, naming the body" is clause 2's settled judge failing on it, each failure naming `jelly`.
- **"Pass physics.audit at its defaults"** (criterion 1) is the audit given no settings, its `settings` the Extended
  kinds line's defaults; a check that can't fail proves nothing, so the same call fails a 0.5 Hz cloth.
- **"With no fault"** (criterion 1) is no `fault` row in the lab's occurrence list over the audited 600 steps.
- **Budgets** (criteria 7 and 9) follow §12a: the task names the criterion and the window measures it against the merge
  base; this test checks the record and, on a reference Mac at rest, runs the task's own judge as the window does.
  "On their goldens" (criterion 9) is each lab's 600-step golden recorded and verified here, the run the bench steps.
- **"The balloon cube"** (criterion 8) is criterion 6's soft cube inflated to 1.2; "the banner on its plate" is the
  banner lab drawn through its skin.

## Not tested, because no criterion reaches it here

Clusters, `tension_only`, `self_contacts`, `particle_radius`, `pinned_to` a body's anchor, `max_particles` refusals,
a mesh asset as a volume's source, cutting, a balloon drawn on its ball, a skin's material, heavier cloth and fluid
bakes through asset jobs (#128), `cross_machine` and `web` goldens of soft bodies, the kit's soft fixtures (#1786),
audit rules other than `soft` failing. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The three lab documents at their paths; the two tasks in `benchmarks/budgets.json` and `benchmarks/physics.mjs`.
- `scripts/lanes.mjs`: `'tests/acceptance/524/'` in the `alone` list (the files build `deep-show`, `deep-gpu` and a
  second `deep-physics`), and `ac7-module-budgets.test.ts` and `ac9-soft-lab-budgets.test.ts` in `timed`.

`BASE-FAILURE.txt` is the run at the base.
