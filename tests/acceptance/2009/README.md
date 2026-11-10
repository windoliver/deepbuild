# Acceptance tests for #2009: physics.world@1 documents stepped on Rapier 0.36.1 behind the backend interface, with its caps and gaps refused at check

Written first, from issue #2009 (its Scope, Fields, four acceptance criteria and Proof line: "The refused caps with their
planted twins"), its Oracle page, the design sections it names and base commit `0c4a4ec7` ("Merge pull request #2051 …";
this worktree's HEAD `96b462a6` is the same tree after main's history rewrite), by a job that never saw an implementation;
none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The upstream tests the Oracle page links for
criteria 1 and 2 are ported in `tests/acceptance/2009-oracle/`, on this suite's surface.

## What was read

- The issue, live with `gh issue view 2009 --repo windoliver/deepbuild`, and its Oracle page
  (`doneright/oracles/issues/2009.md`, `DeepBuildAI/deepbuild`, branch `doneright`).
- `docs/canvas-primitives.md`: A timeline as data over a pinned backend; World and backend `physics.world@1`; Shape; Body
  `body@1`; Contact material; Collision group; Joint `joint@1`; Force; Input track entries; Occurrence list; Physics
  output; Checkpoint ring; Bake; Golden; Physics: behavior kit (the bounce under each combine rule, within 3%; a spring's
  period, 1 ÷ hz within 1%); the note on combine rules and substeps; What holds a document to its rules (the issue shape
  `{check, code, severity, ids, path, actual, t, what, fix}`, and `unknown_field`); Time and the flick (valid rates).
- `docs/technical-design.md`: The physics module; Dogfooding; Tests written first. AGENTS.md.
- At the base: `scripts/canvas-lint.mjs` (its scope: `deep-canvas*` crates and the closure of crates declaring
  `check_kinds`; it bans unsafe, SIMD, clocks, build scripts and proc macros there, so the crate on Rapier can't be in
  it), `crates/deep-canvas-sandbox` with `crates/deep-sandbox-wasmtime` (a module crate without the engine, an engine crate
  with a JSON-lines binary), `scripts/proof-change.mjs` (criterion IDs), `scripts/api-surface.mjs`, the suites `238/`,
  `497/`, `532/`, `377/deps.test.ts` and `505-oracle/` (layouts copied, nothing imported).

The base has no physics module: no crate depends on Rapier (`Cargo.lock` holds no `rapier`), no `deep-physics` binary.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2009 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2009/tsconfig.json
rm -rf tests/acceptance/2009/node_modules/.vite
```

Each file builds `cargo build --locked --bin deep-physics` once, before its tests, and copies the binary out
(honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; Homebrew's rustup put on
PATH when present). `ac4-interface.test.ts` also runs `cargo metadata --locked` and `cargo rustdoc` (below) into its own
target folder, `target/acceptance-2009-doc/`. Every test passes an explicit 60-minute timeout (a first Rapier build takes
minutes), which overrides `--testTimeout`. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`'tests/acceptance/2009/'` in its `alone` list** (the files build cargo binaries); this README is the instruction, the
implementer makes that edit. No cargo on the machine fails `BLOCKED:` (a failed test, never a pass).

`BASE-FAILURE.txt` is the run at the base: every test fails because the surface is absent.

**Checked against Rapier directly, before the base run.** A throwaway program (not committed, and no part of any
implementation) built `rapier3d =0.36.1` with `enhanced-determinism` and ran this suite's setups through Rapier's own
pipeline at 120 Hz with 4 solver iterations: the AC1 drop rebounds 0.248 of 2 m and rests; the kit's bounces land 1.2%
to 1.7% under e²h; the spring (k = m·(2π·hz)²) swings at 0.50013 s; the chain stays under its limit; the rolling ball
first slows under 0.05 m/s at 6.55 s; the resting box settles 6.9e-5 m into the floor within 0.25 s and then doesn't
move. **Free fall misses the issue's bound there:** Rapier's drop at 1 s is 4.9152303 m against the discrete solution's
4.91521875 m, 1.15e-5 m off, and a plain f32 loop of the same two lines (`v += g·h; y += v·h`) gives the same numbers to
the bit, so the gap is f32's rounding over 480 substeps (from y = 2.4576, 5 or 10 m it's 1.1e-5 to 1.4e-5 m). The test
keeps the issue's 1e-5 m, so on a faithful f32 implementation it fails unless the bound is changed in the issue
(a decision for the owner, not this job).

## The surface under test

The issue names a document kind, its fields, a backend interface and a pinned engine, but no command line. **Every
package, binary, call, reply field and planted name below that the issue or the design doesn't give is this job's
invention**, the smallest surface the criteria need, after `deep-sandbox` (#238) and `deep-logic` (#531, #532); the
implementer builds exactly these, or a dispute goes to a blind redraft.

### Packages

- **`deep-physics-rapier`**, a workspace crate (outside the canvas lint's scope: not `deep-canvas*`, no `check_kinds`)
  with a library, the Rapier backend behind the backend interface (`id() caps() build(doc) step(inputs) …`), depending
  on `rapier3d =0.36.1` (and `rapier2d` if it wants), and the binary **`deep-physics`** (`cargo build --locked --bin
  deep-physics`). Where the module's own code (the document, its check, the interface) lives is the implementer's: a
  `deep-canvas-physics` crate under the lint, as `deep-canvas-sandbox` is, or this crate.
- Cargo feature **`test-leaks-rapier`** on `deep-physics-rapier`: criterion 4's twin (Planted twins).

### `deep-physics`: JSON lines

It reads one JSON object per stdin line and answers each with exactly one JSON line, in order, then exits 0 at end of
input. `deep-physics --planted <name>` runs the same binary with one planted twin; an unknown name writes one
`{"ok": false, "code": "bad_input"}` line and exits 2. A line that isn't JSON or lacks a required field answers
`{"ok": false, "code": "bad_input"}`.

| Call | Reply |
|---|---|
| `{"call": "check", "world": World}` | `{"ok": true, "issues": [Issue]}`: the document check, `caps()` included; the world is refused when an issue has `severity: "error"` |
| `{"call": "bake", "world": World, "steps": n, "read"?: [body ID], "every"?: 1, "checkpoints"?: false}` | `{"ok": true, "bodies": {<body ID>: [State]}, "checkpoints"?: [Checkpoint]}`, or for a refused world `{"ok": false, "issues": [Issue]}` |
| `{"call": "restore", "world": World, "checkpoint": Checkpoint, "steps": m, "read"?: [body ID]}` | `{"ok": true, "bodies": {<body ID>: [State]}}`, or a refusal `{"ok": false, …}` that holds no `bodies` |

- **bake** builds the world and runs `n` steps from step 0. `bodies[id][j]` is body `id`'s state after `j × every`
  steps: index 0 is the state as built, before any step, and there are ⌊n ÷ every⌋ + 1. `read` names the bodies
  answered (absent: every body). With `checkpoints: true` the reply holds the checkpoint ring's entries taken while
  baking: one each `checkpoint.every` steps, at steps `every`, 2 × `every`, … ≤ n.
- **restore** builds the world, restores `checkpoint` into it in place of the built state and runs `m` steps:
  `bodies[id][0]` is the restored state and `[i]` the state `i` steps on, so a restore of the bake's checkpoint at step
  s gives the bake's states s to s + m exactly. A checkpoint whose `backend.version` isn't the pin is refused, never
  loaded: the reply is `{"ok": false, …}` with no `bodies`, and its text (`code`, `what` or an issue: the implementer's)
  names both versions, the checkpoint's and `0.36.1`.

```text
State      = {"pos": [x, y, z] m, "rot": [x, y, z, w], "linear": [x, y, z] m/s, "angular": [x, y, z] deg/s,
              "contact_impulse": N·s}
              contact_impulse: the size of the sum of the contact impulses the body took over the step that ended in
              this state (every substep's), 0 at index 0; only the Oracle lane reads it (Rapier's total_contact_impulse)
Checkpoint = {"step": s, "backend": {"name": "rapier3d", "version": "0.36.1"}, "state": base64, …}
              state: the backend's whole-world state (Checkpoint ring); other fields (a deep hash) are the implementer's
Issue      = {"check", "code", "severity": "error" | "warning" | "notice", "ids", "path", "actual", "t", "what", "fix"}
```

### The world document

`World` is a `physics.world@1` document as one JSON object: `"kind": "physics.world@1"` and the issue's fields by their
names (`dimensions`, `step_rate`, `substeps`, `gravity`, `seed`, `mode`, `capacity`, `solver`, `combine`, `defaults`,
`contact_materials`, `checkpoint`, `budget`, `backend`, `collision_groups`), plus the world's items as maps by ID:

- `shapes: {ID → Shape}`, a Shape `{"kind": "sphere", "radius"}`, `{"kind": "box", "half": [x, y, z]}`, `{"kind":
  "cylinder", "half_height", "radius"}`, … (the issue's kinds, each with its fields beside `kind`);
- `bodies: {ID → Body}`, a Body with the issue's `body@1` fields, its `shapes` a list of shape uses `{"shape": shape
  ID, "contact_material": ID, …}`; `pose.pos` a vec3; `velocity.angular` in deg/s;
- `joints: {ID → Joint}`, a Joint with the issue's `joint@1` fields; `a` and `b` a body ID or `"world"`; `frame_a` and
  `frame_b` `{"anchor": vec3, "axis"?: vec3}`, the anchor in the body's frame, or in the world's for `"world"`.

The tests write `backend` as `{"name": "rapier3d", "version": "=0.36.1"}` and leave its other fields (features, target,
rustc) to the build. Fields the tests leave out take the issue's defaults. A field the kind doesn't define is
`unknown_field` (What holds a document to its rules); no test here depends on that.

### Refusals

A refusal at check "naming the field and the backend" is read as: an issue with `severity: "error"` whose `path` names
the field, whose `actual` is the refused value and whose `what` contains `rapier3d`. `path` is read as its field names
split on `/` or `.`, ignoring empty parts, and must end with the field's own path: `solver/restitution_threshold`,
`contact_materials/<ID>/rolling_resistance`, `contact_materials/<ID>/tangent_speed`, `joints/<ID>/kind` (the gear's,
`actual` `"gear"`, and its `ids` name the joint, as Joint `joint@1` says caps() names it). `code`, `check`, `t` and `fix`
are the implementer's and aren't compared.

### The public-API check (criterion 4)

`ac4-interface.test.ts` reads `cargo metadata --locked` and takes as the physics crates every workspace member with a
normal dependency on a Rapier crate (`rapier2d`, `rapier3d`, their `-f64` forms, `parry2d`, `parry3d` and their `-f64`
forms, `glamx`: Rapier's own crates and the dimforge crates whose types Rapier re-exports as its shapes and poses) and
every member whose name contains `physics`; they must include `deep-physics-rapier`, which holds the `deep-physics`
binary, a member must depend on `rapier3d`, and `rapier3d` must resolve to `0.36.1` alone. Each physics crate must have
a library. For each, `RUSTC_BOOTSTRAP=1 cargo rustdoc --locked -p <crate> --lib -- -Z unstable-options --output-format
json` (rustdoc's JSON on the checkout's stable 1.99.1; `RUSTC_BOOTSTRAP=1` admits the flag, as cargo-semver-checks does
on stable) gives its public API, and `api.ts` walks every documented item of the crate (auto-trait and blanket impls
rustdoc adds by itself skipped): a public `use` whose source or target is a Rapier crate's, an item inlined from one, or
any public item whose signature, field, bound, alias or impl refers to an item of one, is a leak. None may leak. The
world document's fields must be public items the walk reads: struct fields named `restitution_threshold`, `max_speed`,
`contact_materials`, `rolling_resistance` and `tangent_speed` among the physics crates' documented items, so "every world
document field name none" is checked from the public API too.

### Planted twins

Each is one criterion's wrong program, reachable only through its switch, and changes nothing else:

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted caps_allow_restitution_threshold` | 1 | caps() admits a `restitution_threshold` above 0 (the check raises no issue for it) |
| `--planted caps_allow_rolling_resistance` | 3 | caps() admits a contact material's `rolling_resistance` above 0 |
| `--planted caps_allow_tangent_speed` | 3 | caps() admits a contact material's `tangent_speed` above 0 |
| `--planted caps_allow_dynamic_gear` | 3 | caps() admits a `gear` joint in dynamic mode |
| `--planted restore_ignores_version` | 4 | restore loads a checkpoint whatever its `backend.version` |
| Cargo feature `test-leaks-rapier` | 4 | `deep-physics-rapier`'s public API gains one `pub use` of a Rapier type and one public function whose signature names a Rapier type |

Each refusal test runs its twin on the refused world (or the other version's checkpoint) and requires the judge that
passes the real program to fail on the twin's answer; the twin's process must exit 0 and answer `ok: true`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#2009.59ac371b` | `ac1-restitution.test.ts` (2) | `restitution_threshold: 1` refused at `solver/restitution_threshold` naming rapier3d, `0` admitted, `caps_allow_restitution_threshold` caught; with 0, a ball (r 0.1 m, 1 kg) whose lowest point is 2 m above a floor, both of restitution 0.5: its first apex ÷ 2 m within 0.05 of 0.25, and over its last second of 5 s its speed under 0.05 m/s and its centre within 0.01 m of its radius. Fails: a check that admits the threshold or refuses 0, a refusal naming no field or no backend, a bounce off e², a ball that never rests |
| 2 `#2009.67d10d73` | `ac2-integrator.test.ts` (4) | free fall from rest at 120 Hz × 4 substeps: at every step k ≤ 120 the drop within 1e-5 m of ½·g·h²·N(N+1), N = 4k (4.9152 m at 1 s); a 1 m box built resting on a floor rests at 1 s and stays within 1e-5 m of that height to 2 s; restitution 0.5 against 0.9 dropped 1 m under each combine rule (max, min, average, geometric, multiply): first bounce within 3% of e²h (0.81, 0.25, 0.49, 0.45, 0.2025 m); a 4 kg bob hanging on a distance joint's spring (hz 2, damping_ratio 0, rest 1 m) from the world, released at rest at its rest length: period from its upward crossings of its mean over 5 s within 1% of 0.5 s; a chain of 5 ball-jointed 1 kg spheres (r 0.05 m) 0.5 m apart, released level from a world pivot: over 10 s its energy (½mv² + ½Iω², I = 2/5·m·r², + m·g·height above hanging straight) never above E0·(1 + 0.01·t), and some link passes 1 m/s. Fails: an explicit or implicit Euler other than the pinned one, a sinking rest, a wrong combine rule, a spring tuned off hz, a solver that gains energy |
| 3 `#2009.43ed60cb` | `ac3-rolling-and-caps.test.ts` (2) | `rolling_resistance: 0.05` and `tangent_speed: 1` on contact material `pad`, and a gear (ratio 2, `of` two hinges to the world) in dynamic mode, each refused at its field naming rapier3d; at 0 and without the gear each admitted; each cap's twin caught. A 1 kg solid ball of r 0.1 m on a level floor, rolling at 2 m/s (ω = v ÷ r) with angular damping 2/s: its first step under 0.05 m/s lies between 6 and 7.5 s. Fails: a cap missing or refusing everything, a refusal naming the joint's ID only, damping that doesn't reach the roll |
| 4 `#2009.e7924149` | `ac4-interface.test.ts` (2) | the public-API check above passes, and finds both leaks with `test-leaks-rapier`; a bake (the drop world, `checkpoint.every` 60, 180 steps) holds a checkpoint at step 60 naming rapier3d 0.36.1, whose restore run 60 steps equals the bake's states 60 to 120; the same checkpoint with `backend.version` `0.35.3` is refused naming 0.35.3 and 0.36.1, with no states; `restore_ignores_version` caught. Fails: a public Rapier type, a document type off the public API, a restore that ignores the version or loads anything |

Test count: 2 + 4 + 2 + 2 = 10.

## Readings where the issue leaves a choice

- **The surface.** A JSON-lines binary on the engine's crate, as `deep-sandbox` and `deep-logic` are, because the
  criteria need a check, runs read step by step, checkpoints and planted twins; no scene, `deep-show` or check registry is
  driven (no criterion names one).
- **"Within 0.05 of a quarter of the drop"**: the rebound as a fraction of the 2 m drop within 0.05 of 0.25 (0.4 to
  0.6 m), the band the Oracle page says the criterion shares with Rapier's `issue_974_restitution`. The rebound is the
  first apex of the ball's lowest point over the floor's top after its velocity turns upward. **"Then rests"**: over the
  run's last second (4 to 5 s) the ball's speed stays under `solver.sleep.speed`'s default, 0.05 m/s, on the floor.
- **"Rest on the ground"** matches the discrete solution of a body held by its contact: it doesn't move. A 1 m box
  built touching the floor rests there at 1 s (centre within 1 mm of 0.5 m; the contact may settle it into the floor
  by less than that) and from 1 s to 2 s its height stays within 1e-5 m of its height at 1 s.
- **Free fall's** body starts at rest at y = 0, with no floor; its drop is compared at every step to 1 s.
- **The bounce** is the behavior kit's fixture (0.5 against 0.9, dropped 1 m, under each combine rule, within 3%).
- **The hanging spring** is a `distance` joint with a `spring`, the backend's soft constraint, not a `spring_to_point`
  force (the wrapper's, with a closed form). Set here: hz 2, damping_ratio 0, rest 1 m, a 4 kg sphere of r 0.1 m (the
  kit's spring-to-point mass and hz). Its period: the mean spacing of the bob's upward crossings of its mean height.
- **The pendulum chain** (set here): 5 links, each a 1 kg sphere of r 0.05 m, the first on a ball joint to the world at
  the origin, each next 0.5 m on along +x on a ball joint at the previous link's centre; released at rest, level. "Never
  more than 1% a second above its start": E(t) ≤ E0 × (1 + 0.01 × t), with energy measured above the chain's rest from
  the bodies' states, as the behavior kit measures (never a backend's own reading).
- **The rolling ball** (set here): floor friction 0.5 (the default), the ball rolling without slipping from the start,
  "slows below 0.05 m/s" its horizontal speed.
- **The gear** world: two cylinder wheels (r 0.2 m) each on a hinge to the world about z, and a `gear` of ratio 2 with
  `a`, `b` the wheels and `of` the hinges.
- **"No Rapier type crosses … checked from the crate's public API"**: rustdoc's JSON on the stable toolchain under
  `RUSTC_BOOTSTRAP=1` (rustdoc JSON is otherwise nightly-only), scanned for references to Rapier's crates; the world
  document's types must be public so the same scan reads its fields.
- **"A checkpoint whose backend version differs from the pin"**: the pin's checkpoint with its `backend.version` set to
  `0.35.3` (the version before 0.36, whose snapshots the design says don't load); its bytes stay 0.36.1's, so only the
  record's version can refuse it.

## Not tested, because no criterion reaches it here

The fault `speed_cap` naming a capped body, the 45° turn cap, joint force over the last substep, balloons' `inflate`,
restitution 1 never resting (Scope lines no criterion names); shapes, collision groups, forces, inputs, occurrences,
outputs, queries, the character and vehicle controllers, hashes, goldens and bakes as evidence; 2D worlds; the
determinism and build features (`enhanced-determinism`, `serde-serialize`, no `simd8` or `parallel`, baseline target
features) beyond `rapier3d` resolving to 0.36.1.
