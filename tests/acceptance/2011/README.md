# Acceptance tests for #2011: physics.pairs, roles that expand to collision groups, and the step budget on each host

Written first, from issue #2011 (its Scope, Fields, three acceptance criteria and Proof line: "The `physics.pairs`
reports on the locked pairs and the roles with their planted twins, and each host's step_p95 on the reference Mac"), its
Oracle page, the design sections it names and base commit `f28d8777e` ("Merge pull request #2229 …", which holds
#2009's, #2010's and #2012's merges), by a job that never saw an implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle page says
no upstream test checks any of the three criteria, so there is no oracle lane.

Disclosure: while this job ran, the checkout's working tree held another session's uncommitted changes to
`crates/deep-canvas-physics` and `crates/deep-physics-rapier` (new `pairs.rs` and `roles.rs` among them). This job read
`crates/deep-canvas-physics/src/doc.rs` once after it had been changed, before it noticed, read none of the changed files
after that, and took nothing from them: the base's code was read with `git show HEAD:<path>`, and the base run below used
a clean export of `HEAD` (`git archive`) with its own target folder.

## What was read

- The issue, live with `gh issue view 2011 --repo windoliver/deepbuild`, and its Oracle page
  (`doneright/oracles/issues/2011.md`, `DeepBuildAI/deepbuild`, branch `doneright`): Rapier's `InteractionGroups` needs
  both colliders' memberships and filters to agree, but its tests only round-trip groups; step budgets per host and
  BLOCKED without a reference Mac are ours.
- `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Input,
  occurrence, output; Behavior kit); Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (`budget: {step_p95: ms = 2, …}`); Shape (kinds, a
  shape use's fields; "Narrow phase per pair: sphere and capsule are cheapest, then box, then convex(n), then mesh");
  Body `body@1`; Collision group ("Two shapes interact when each one's `member` meets the other's `collides`. A sensor
  reports overlaps and never responds"); Occurrence list (`sensor_enter`, a and b in canonical order, entries naming
  shape uses); Bake (`counters: {contacts, awake, step_p50, step_p95}`); Physics: behavior kit; Frame budget (the
  five-run rule); logic.budget and net.budget (a web part "in the web player in headless Chrome on the reference Mac,
  BLOCKED with one unblock ask until that has run").
- At the base: `tests/acceptance/2009/`, `2010/`, `2012/` (README, helpers, a test each), `tests/acceptance/532/helpers.ts`
  (`inChrome`); `crates/deep-canvas-physics` (doc.rs, check.rs, caps.rs, backend.rs, lib.rs) and
  `crates/deep-physics-rapier` (runner.rs, main.rs, lib.rs, Cargo.toml, README.md); `scripts/physics-wasm32.mjs`,
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`
  (`alone`); `Cargo.toml` (no `[profile.release]`), `rust-toolchain.toml`.

What the base already answers, which these tests don't credit: `deep-physics` with `check`, `bake` (`read`, `every`,
step hashes, outputs), `restore`, `play`, `runtime` and the golden calls; a shape use's `member`, `collides` (bit masks
over `collision_groups`, all groups when absent) and `sensor`; `scripts/physics-wasm32.mjs` (a debug wasm32 build in
Node's V8). It has no `pairs` call, no `role` or `owner`, no occurrences in a bake, no step timing, no budget check, and
it refuses `convex`, `mesh` and `compound` shapes ("#927 brings it").

Checked apart from the run, at the base: criterion 3's world, with its roles written out as explicit groups (the pickup a
sensor that collides with the player), bakes as the test expects: the player reaches x = 1.5 at step 60, passes the
pickup and is at x = 6.0 at step 240 with its centre at y = 0.5; enemy_b ends at x = −2.0; with the pickup solid to the
player instead, the player stops at x = 1.5000 and never passes it.

Calibration of criterion 2's level, outside the checkout: a scratch crate on rapier3d 0.36.1 (`dim3`, `f32`, `std`,
`enhanced-determinism`), cargo's release profile, natively and for wasm32-unknown-unknown in Node 24's V8 (Chrome's
engine), the world's settings (120 Hz, 4 solver iterations, frictionless, the capsules and walls below), CPU time per
step, p95 over the steps, on this Mac17,10 under a one-minute load of 26 to 200 (so readings, not results):

| Level | Native p95 | wasm32 p95 |
|---|---|---|
| 100 convex slabs in a compound | 0.05 ms | 0.12–0.17 ms |
| one mesh, a 100 × 100 grid of square cells (any size from 6 to 10 cm) | 0.2–0.5 ms | 0.6–1.3 ms |
| one mesh, 10,000 strips across the floor, 30 m square (this suite's) | 1.66–1.79 ms | 3.09–3.24 ms |

A regular grid never reaches 2 ms in V8, so with it the criterion's web FAIL couldn't happen; the strip tessellation is
this suite's level (The level, below). If an unloaded reference Mac reads the strip level's app step over 2 ms, or its web
step under it, the level's strip count is what a blind redraft would change.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2011 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2011/tsconfig.json
```

What a run builds and needs (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`
unless set; Homebrew's rustup put on PATH when present, as #2009's helpers do):

- **`deep-physics`** (criteria 1 and 3), the dev profile, once per file, through `../2009/helpers.ts` (`cargo build
  --locked --bin deep-physics`, the binary copied out). 37 s cold on this Mac at the base. Nothing in these files is
  timed.
- **The step-budget check** (criterion 2), `node scripts/physics-budget.mjs`, which builds what it times itself, in
  cargo's release profile (below), and runs headless Chrome at `CHROME_BIN` or `/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome`. The first run builds Rapier twice in release (natively and for wasm32), so
  each criterion-2 test has a 2-hour timeout; the others 60 minutes.

Criterion 2's verdicts are timings: they count only on a reference Mac on mains, with Low Power Mode off, the thermal
state nominal and a one-minute load average at or under the core count at each run's start and end
(`scripts/benchmark.mjs`'s `judgeLimit`). On a loaded or other machine the check reads INCONCLUSIVE, and the test fails
with `INCONCLUSIVE:` and the check's reasons, never passing and never retried, after judging everything the check
reports apart from the verdict. A shared, loaded Mac reads INCONCLUSIVE until it is quiet.

Node built-ins and vitest only. **`scripts/lanes.mjs` needs `'tests/acceptance/2011/'` in its `alone` list** (the
files build cargo binaries, release builds of Rapier for two targets, and time steps in headless Chrome); this README is
the instruction, the implementer makes that edit.

`BASE-FAILURE.txt` is the run at the base: every test fails at an assertion because the surface is absent.

## The surface under test

The issue names a check kind, roles, a role table, budgets per host and planted wrong programs, but no command line.
**Every call, reply field, script, request field and planted name below that the issue or the design doesn't give is this
job's invention**, the smallest the criteria need, extending #2009's, #2010's and #2012's (`tests/acceptance/2009/`,
`2010/` and `2012/README.md`: The surface under test), whose calls, fields and worlds stay as those READMEs define them.
The implementer builds exactly these, or a dispute goes to a blind redraft.

### The world document: what this suite adds

- **Shapes** `convex`, `mesh` and `compound`, with the design's fields (Shape): `{"kind": "convex", "points": [[x, y,
  z]], "radius"?: 0}` (4 to 64 points, built as their hull); `{"kind": "mesh", "vertices": [[x, y, z]], "triangles": [[i,
  j, k]]}` (static bodies only); `{"kind": "compound", "children": [{"shape": shape ID, "pose": {"pos", "rot"?}}]}`, each
  child another shape of the world by ID (a convex shape here) at its pose in the compound's frame. The base refuses all
  three; criterion 2's level needs them. No decomposition (#927): a mesh is stepped as one mesh.
- **A shape use's `role`** (Scope): `"role": "player" | "enemy" | "ground" | "wall" | "pickup" | "shot" | "trigger" |
  "prop"`, which a first-party table expands at check into the use's groups, `member`, `collides` and `sensor`, adding
  the groups it uses to the world's; and **`"owner": body ID`** on a shot's use, the body that fired it. A world built
  only from roles writes no `collision_groups`, `member` or `collides`. `bake` and every other call step and read the
  expanded world. The table is the implementer's, held to the Scope: a shot never interacts with a shape on its owner;
  a pickup or trigger is a sensor that interacts with players; criterion 3's pairs below.
- **`budget.step_p95`** (World: `budget: {step_p95: ms = 2, …}`) is the step budget the check holds; criterion 2's worlds
  leave `budget` out, so it is 2 ms.

### ShapeUse

A shape use is named everywhere as `{"body": body ID, "index": i, "shape": shape ID}`: body `body`'s `shapes[i]`, which
uses shape `shape`.

### `deep-physics`: what this suite adds

| Call | Reply |
|---|---|
| `{"call": "pairs", "world": World, "brief": {"touch"?: [[group, group]], "never"?: [[group, group]]}}` | `{"ok": true, "verdict": "PASS" \| "FAIL", "groups": [group], "matrix": [Entry], "shapes": [ShapePair], "failures": [Failure]}`, or a refusal `{"ok": false, "issues": [Issue]}` |
| #2009's `bake`, plus `"occurrences"?: true` | #2010's reply, plus with `occurrences: true` `"occurrences": [Occurrence]` |
| `--planted role_table_pickup_solid` | (Planted wrong programs) |

```text
Entry      = {"a": group, "b": group, "interacts": bool}
ShapePair  = {"a": ShapeUse, "b": ShapeUse, "contact": "solid" | "sensor" | "none"}
Failure    = {"lock": "touch" | "never" | "role", "pair": [group, group], "shapes": [ShapeUse, ShapeUse], "what": string}
Occurrence = {"step": k, "kind": string, "a": ShapeUse, "b": ShapeUse}
```

**`pairs`** is the check kind `physics.pairs`. It runs the document check (a world it refuses is refused here with the
same issues), expands roles, and reads the world's shape uses after expansion. Two shape uses interact when each one's
`collides` names a group the other is a member of (Collision group; a use with no `member` is a member of every group
and one with no `collides` collides with every group, as the base reads them).

- `groups`: the world's collision groups after expansion: `collision_groups` in its order, then any the roles add.
- `matrix`: every unordered pair of `groups` once, a group with itself included, so n groups give n(n + 1)/2 entries
  (four give 10). `interacts`: whether some two shape uses on different bodies, one a member of `a` and the other of `b`,
  interact.
- `shapes`: every unordered pair of shape uses on different bodies once. `contact`: `none` when they don't interact,
  `sensor` when they do and either is a sensor (`sensor: true`, written or expanded), `solid` otherwise.
- The locks: each brief pair in `touch` must interact in the matrix; each in `never` must not. Beside the brief's, the
  check holds each role's rule from the Scope: a `shot` shape's contact with every shape on its `owner` body is `none`,
  and a `pickup` or `trigger` shape's contact with every `player` shape is `sensor`. A lock or rule the matrix breaks is a
  Failure: `lock` (`role` for a role's rule), `pair` (the locked groups, or for a role's rule a group of each shape),
  `shapes` (two shape uses that break it: for `touch`, a member of each group that don't interact; for `never` or a
  rule, two that interact as they mustn't) and `what`, a sentence. One Failure per broken lock or rule.
- `verdict`: `PASS` with no failures, else `FAIL`.
- **Refusal**: a shape use whose `member` is an empty list (a member of no group) is refused at check: `{"ok": false,
  "issues": [Issue]}`, an issue with `severity: "error"` whose `path` is `bodies/<body>/shapes/<i>` or a path under it
  (`…/member`), and whose `ids`, as #2009's issues have them, name the body. No verdict is given.

**`bake` with `occurrences: true`** answers the occurrences its run wrote (Occurrence list), sorted by step, kind, a, b.
Each names its step k (written after step k, 1 to n) and its kind; `a` and `b` are the two shape uses, in canonical
order (body ID, then index). This suite reads only `sensor_enter`: written once, at the step a shape first overlaps a
sensor it interacts with, naming the sensor's use and the other's (read as a pair, in either order). Other kinds may be
present; their fields are the implementer's.

### The step-budget check: `node scripts/physics-budget.mjs [--planted times_only_app]`

A new script, the budget part of the physics module's checks (Scope: "Step cost per host"). Run from the checkout with
one JSON request on stdin, it writes one JSON report line on stdout and exits 0 whatever the verdict. A request it can't
read, or an unknown flag, writes `{"ok": false, "code": "bad_input"}` and exits 2; a world the document check refuses
writes `{"ok": false, "issues": [Issue]}` and exits 0.

```text
Request = {"world": World, "steps": n, "reference_mac": {"app": bool, "web": bool}}
Report  = {"ok": true, "verdict": Verdict, "limit_ms": ms, "hosts": {"app": Host, "web": Host}, "asks": [Ask]}
Host    = {"verdict": Verdict, "target": triple, "engine": string, "profile": "release", "runs": [ms], "loads": [{"start", "end"}],
           "slowest": Slowest | null, "reason": string | null, "what": string | null}
Slowest = {"run": 1..5, "step": k, "ms": ms, "pair": [ShapeUse, ShapeUse], "tests": n}
Ask     = {"kind": "unblock", "host": "app" | "web", "what": string}
Verdict = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE"
```

- **The hosts** are the two a piece ships to, always both: `app`, the physics crate's own build for this machine,
  stepped natively by `deep-physics` (or a call it adds); and `web`, the physics crate built for
  `wasm32-unknown-unknown`, stepped inside headless Chrome (a fresh profile, a page the script serves on `127.0.0.1`,
  Chrome stopped by the PID the script started). Both are cargo's **release** profile of this checkout's crates with
  `--locked`, honoring `CARGO_TARGET_DIR`, the caller's `*RUSTFLAGS` cleared (as `scripts/physics-wasm32.mjs` clears
  them): the app ships optimized builds, so a dev build's step times say nothing about a budget. `target` is the
  build's triple (this Mac's `rustc -vV` host for `app`; `wasm32-unknown-unknown` for `web`), `engine` is `"native"` for
  `app` and the page's `navigator.userAgent` (headless Chrome's names `HeadlessChrome/`) for `web`, `profile` is
  `"release"`.
- **`reference_mac`** says, for each host, whether a reference Mac is configured to time it. The hosts block (`host@1`)
  that will hold this doesn't exist at the base, so the request carries it, as #2010's `golden_cross` carries its
  machines; `true` means this machine is the one configured. A host with `false` is never timed: its verdict is
  `BLOCKED`, `runs` and `loads` are `[]`, `slowest` and `what` null, and the report holds exactly one Ask for it, `kind:
  "unblock"`, `host` naming it, `what` saying a reference Mac must be configured to time it. A `true` host whose engine
  this machine lacks (no Chrome) is `BLOCKED` the same way, its one ask naming the missing engine.
- **Timing a host**: one untimed warm-up run, then five timed runs. Each run builds the world anew and steps it `steps`
  steps from step 0, timing each step's backend step alone (not the JSON, hashes or reads) on the host's own clock (a
  monotonic clock natively; `performance.now()` in the page, which may be cross-origin isolated for its finer
  resolution). A run's reading is the nearest-rank 95th percentile (the ⌈0.95 n⌉-th smallest) of its n step times, in
  ms. The script reads the one-minute load average (`os.loadavg()[0]`) at each timed run's start and end into `loads`.
- **A timed host's verdict** is `judgeLimit({limit: limit_ms, runs, fingerprint: fingerprint(), loads}).status` from
  `scripts/benchmark.mjs` (the reference-Mac rule: PASS when all five are within the limit, FAIL when all five are over
  it by more than the margin, otherwise and off a fit reference Mac or under load INCONCLUSIVE), and `reason` its reason.
  `limit_ms` is the world's `budget.step_p95` (2 ms by default).
- **`slowest`**: the slowest single step among the host's five timed runs (ties: the earlier run, then the earlier
  step): `run` (1 to 5), `step` (k, the k-th step from step 0, 1 to `steps`), `ms` its time, and in that step the pair of
  shape uses that ran the most narrow-phase tests (`tests`, their count; ties: canonical order). A narrow-phase test is
  one contact or intersection computation the backend runs between two shape uses in a step: one for two convex shapes,
  one per child or triangle of a compound or mesh that the other's bounding box reaches. The world is deterministic, so
  a step's counts are the same on both hosts.
- **`what`** on a `FAIL`: a sentence naming the host (`app` or `web`), the step's number and both shape uses of
  `slowest.pair` (their body IDs); null otherwise.
- **The report's `verdict`**: `FAIL` when a host fails, else `BLOCKED` when one is, else `INCONCLUSIVE` when one is, else
  `PASS`. `asks` holds every BLOCKED host's one ask. It is never `PASS` with a host not timed.

### The level (criterion 2's worlds)

`levelWorld()` in `helpers.ts` writes both, identical but for the shape `level`:

- 50 dynamic bodies `c00` … `c49`, standing in for characters: one shape use each of `capsule` (half_height 0.6 m, radius
  0.3 m, so 1.8 m tall), 80 kg, upright (`locks.angular` all true), `sleep: false`, centred at y = 0.9 on an 8 × 7 grid
  over the floor, each sliding at 2 m/s in the direction k × 137.5°; the world's defaults frictionless (`friction: 0`,
  `restitution: 0`).
- The level, a static body `level` with one shape use of `level`, a 30 m square floor whose top is y = 0:
  - **compound of convex pieces**: `level` is a compound of 100 children, each the convex `slab` (the 8 corners of a 3 m
    × 3 m × 0.5 m block whose top is y = 0) at (−15 + 3i, 0, −15 + 3j);
  - **one mesh shape**: `level` is a mesh of 20,002 vertices and 20,000 triangles, the same floor as 10,000 strips
    running along x, each 3 mm wide and split into two triangles.
- Four walls round the floor (a static body `walls` with four box uses, contact material `bouncy`: friction 0,
  restitution 1, which the world's `max` restitution rule applies), so the capsules keep moving on the level.
- `steps: 1200` (10 s at 120 Hz).

## Planted wrong programs

| Plant | Criterion | The wrong program |
|---|---|---|
| ground's `collides` without player (player's still names ground) | 1 | a world whose matrix breaks the player–ground touch lock: `FAIL`, one failure naming it and both shapes |
| shot's `collides` naming player (player's names shot already) | 1 | a world whose matrix breaks the shot–player never lock: `FAIL`, one failure naming it |
| enemy's `member: []` | 1 | a shape in no group: refused, naming `bodies/enemy/shapes/0` |
| the mesh level | 2 | a world over the budget on the web only: the web host `FAIL`, naming web, the step and a capsule–level pair |
| `node scripts/physics-budget.mjs --planted times_only_app` | 2 | a check that times only the app: the app host is timed as usual, and the web host's result is a copy of the app's (its verdict, target, engine, runs, loads, slowest and what); Chrome never starts |
| `reference_mac: {"app": true, "web": false}` | 2 | no reference Mac configured for the web: `BLOCKED` with one unblock ask naming web, never `PASS` |
| `deep-physics --planted role_table_pickup_solid` | 3 | the first-party role table is wrong for pickups: a pickup's shape expands to a solid shape (not a sensor) that interacts with players' shapes, the table changed no further than that needs, in every call of that process |

The first three, the mesh level and the missing reference Mac are the tests' own inputs; the two `--planted` names are
switches of the program, each reachable only through its flag, one name per process as in #2009, changing nothing else.
The judge that passes the real program must fail on each planted program's answer; each planted process must exit 0
and answer.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#2011.3daf6b1d` | `ac1-pairs.test.ts` (2) | Groups player, ground, shot, enemy, one body each (player collides with ground, enemy, shot; ground with player, enemy, shot; shot with ground, enemy; enemy with player, ground, shot); brief touch player–ground and shot–enemy, never shot–player. The world passes with `groups` its four and a matrix of exactly 10 entries, each unordered pair once: player–ground, player–enemy, ground–shot, ground–enemy and shot–enemy interact; player–shot (shot doesn't name player) and the four self pairs don't. Ground omitting player: matrix player–ground false, `FAIL` with one failure, lock `touch`, pair player–ground, shapes `player/shapes/0` and `ground/shapes/0`. Shot naming player: `FAIL`, one failure, lock `never`, pair shot–player, shapes shot's and player's. Enemy's empty `member`: `ok: false`, an error issue at `bodies/enemy/shapes/0…`, no PASS. Fails: a one-sided interaction rule, a matrix missing pairs or self pairs, a failure not naming the pair or both shape uses, an empty member admitted |
| 2 `#2011.a8a76103` | `ac2-step-budget.test.ts` (4) | The compound level: both hosts timed here (app: this Mac's triple, `native`; web: `wasm32-unknown-unknown`, `HeadlessChrome/`; release; five runs and loads each; web's runs not the app's; slowest step and pair well formed; a PASS only with five runs within, a FAIL only with five over; the report's verdict from its hosts', `limit_ms` 2), then app PASS, web PASS, report PASS. The mesh level: the same, the web's slowest step naming a capsule and the level, then app PASS, web FAIL, report FAIL, the web's `what` naming web, the step and the capsule–level pair. `times_only_app` on the mesh level: caught. `reference_mac.web` false: web BLOCKED with no runs, exactly one ask (`unblock`, host web, a `what`), report BLOCKED. A host read INCONCLUSIVE where PASS or FAIL is wanted fails the test as INCONCLUSIVE after the rest is judged. Fails: a check that times only the app, times a dev build, times off Chrome, passes the mesh level on the web, passes or times a host with no reference Mac, or loses the step or pair |
| 3 `#2011.b8ab4f30` | `ac3-roles.test.ts` (2) | A world built only from roles (player, enemy_a, enemy_b, ground, wall, pickup, a shot with `owner: "player"`): `pairs` with no brief gives player, enemy_a and enemy_b touching ground and wall, the shot touching both enemies and the wall (`solid` or `sensor`), shot–player `none` and pickup–player `sensor`, and passes. Its 240-step bake with occurrences: exactly one `sensor_enter` for pickup–player, within 3 steps of step 60, when the player reaches it, and none for either enemy, although enemy_b slides through the pickup's other end; the player passes through (beyond x = 2.5 at 2 s) and stands on the ground. Under `role_table_pickup_solid`: the player never passes x = 1.55 and is stopped at the pickup (x ≥ 1.45 at 2 s), and `pairs` is `FAIL` with a failure naming pickup–player. Fails: an owner that collides with its own shot, a pickup solid to the player or blind to it, a sensor seeing enemies or entering more than once, a role table physics.pairs doesn't hold to its roles |

Test count: 2 + 4 + 2 = 8.

## Readings where the issue leaves a choice

- **"Group pairs"**: unordered, a group with itself included, so four groups give 10 (4 + 6), as the criterion counts.
  A group pair interacts when some two shape uses on different bodies, one in each group, interact; a self pair needs
  two such uses, so in criterion 1's world, one use a group and none colliding with its own group, every self pair is
  false either way.
- **"Naming the pair and both shapes"**: the group pair, and both shape uses as ShapeUse (body, index and shape), since
  criterion 1's player and enemy share the shape `person`.
- **"Refused at check, naming it"**: `pairs` answers a refusal whose error issue's path is the shape use's; whether the
  document check (`check`) refuses it too is the implementer's.
- **"Touch"** in criterion 3: the two interact (`solid` or `sensor`); the player standing on the ground in the bake
  shows the ground is solid to it. **"Never its owner"**: contact `none` between the shot's use and every use on its
  owner. **"A sensor that sees players"**: pickup–player contact `sensor` and one `sensor_enter` as the player arrives;
  "none for enemies" is read in the bake, with an enemy crossing the pickup.
- **"Fails physics.pairs, naming the pair"** for the planted table: physics.pairs holds each role's rule from the Scope
  (a shot never touches its owner; a pickup or trigger is a sensor that sees players) beside the brief's locks, since the
  brief's touch and never can't tell a sensor's overlap from a solid contact; the failure names the pickup's and the
  player's shape uses.
- **"The app"**: the physics crate's native build stepped by `deep-physics`; **"the wasm32 build in headless Chrome"**:
  the same crate for wasm32-unknown-unknown stepped in a headless Chrome page, Chrome's own engine (#2012's wasm32 leg
  ran in Node's V8; this criterion names Chrome). Both in cargo's release profile.
- **"On the reference Mac"**: the timing counts only by `scripts/benchmark.mjs`'s reference-Mac rule (five runs after a
  warm-up, a fit reference Mac, no load above the core count), which the check applies itself. **"With no reference Mac
  configured"**: the request's `reference_mac` for the host is false; tested for the web, with the app's configured, so
  exactly one ask exists.
- **"A planted check that times only the app passes it"**: the plant times the app and reports the web as the app's
  result, so on a fit reference Mac it passes the mesh level; the judge that passes the real check requires the web
  host's readings to come from wasm32 in headless Chrome, and differ from the app's, so the plant is caught on any
  machine, and on a fit reference Mac by its web PASS too.
- **"The step"**: the slowest single step of the failing host's five timed runs, by its number from step 0; **"the shape
  pair with the most narrow-phase tests in it"**: the two shape uses that ran the most narrow-phase tests in that step.
  The test checks that the mesh level's is a capsule's use with the level's.
- **"A 20,000-triangle level built as a compound of convex pieces"**: the level the mesh shape draws, 20,000 triangles,
  stepped as 100 convex slabs whose union has the same top face; the decomposition is written in the document, since
  #927 brings computing one. **"Standing in for characters"**: upright capsules of a person's size, always awake and
  moving. The strip tessellation and the 30 m size are this suite's choice, from the calibration in What was read.
- **Step count**: 1,200 steps (10 s, the span the world's `bake_10s` budget names), so a few slow early steps don't
  decide the 95th percentile.

## Not tested, because no criterion reaches it here

The assumption row each role's expansion shows the person and a shape with both a role and explicit groups refused
(Scope, no criterion; their surface is the implementer's); roles `trigger` and `prop`; `budget.memory` and `bake_10s`;
`collide_connected`; occurrences other than `sensor_enter`; the hosts block itself; a budget on a host other than this
Mac; heightfield shapes and decomposition (#927); the bake's `counters`.
