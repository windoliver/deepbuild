# Acceptance tests for #2010: bakes keyed by the document, the input track, the frame rate and the pinned build, and goldens checked on one machine

Written first, from issue #2010 (its Scope, Fields, five acceptance criteria and Proof line: "The pinned dependency
tree, and a golden recorded on macOS"), its Oracle page, the design sections it names and base commit `d51be2c3`
("Merge pull request #2108 …"), by a job that never saw an implementation; none existed, and no other worktree, branch
or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). The upstream tests the Oracle page links for criterion 2 are ported in
`tests/acceptance/2010-oracle/`, on this suite's surface.

## What was read

- The issue, live with `gh issue view 2010 --repo windoliver/deepbuild`, and its Oracle page
  (`doneright/oracles/issues/2010.md`, `DeepBuildAI/deepbuild`, branch `doneright`).
- `docs/canvas-primitives.md`: A timeline as data over a pinned backend; World and backend `physics.world@1`; Input
  track entries; Physics output; Checkpoint ring; Bake; Golden; Time and the flick; Registry and seal: runtime digest;
  Check input: `physics.determinism`.
- `docs/technical-design.md`: The physics module; Dogfooding; Tests written first. AGENTS.md.
- At the base: `tests/acceptance/2009/` (README, helpers.ts, api.ts, ac4-interface.test.ts), `2009-oracle/`,
  `2009-redraft-ac2/`; the crates `deep-canvas-physics` and `deep-physics-rapier` (to know what the base answers);
  `tests/acceptance/532/` (README, helpers.ts: goldens, a linux/amd64 Docker host, `BLOCKED:`), `429/steps.test.ts` (a
  BLOCKED result with one unblock ask), `scripts/wasm32.mjs` (a lane that refuses a build naming why),
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (what failing on a wrong program means),
  `scripts/preflight.mjs`, `Cargo.toml`, `.cargo/config.toml`, rapier3d 0.36.1's own manifest (its feature table).

What the base already answers, which these tests don't credit: #2009's `deep-physics` with `check`, `bake` (states,
checkpoints with the backend's whole-world bytes) and `restore`; a dependency tree that already pins rapier3d 0.36.1
and parry3d 0.31.1 with dim3, f32, std, enhanced-determinism and serde-serialize. It has no bake key, step hash, output,
store, runtime digest, golden, preflight lane or planted name of this suite; its reader refuses a world's `outputs`
("#1918 brings it"), and every call this suite adds answers `{"ok": false, "code": "bad_input"}`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2010 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2010/tsconfig.json
rm -rf tests/acceptance/2010/node_modules/.vite
```

What a run builds and needs (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`
unless set; Homebrew's rustup put on PATH when present):

- **`deep-physics`** for this Mac, once per file, through `../2009/helpers.ts` (`cargo build --locked --bin
  deep-physics`, the binary copied out). A cold build took 11.5 min of wall time on this Mac at the base (2.7 min of
  CPU; the rest waited on cargo's package-cache lock, which other sessions held).
- **The planted lockfile** (criterion 1, its third test): the checkout's `Cargo.lock` copied to
  `target/acceptance-2010-lock/Cargo.lock`, wide moved one release there with `cargo update -p wide --precise 1.7.0`
  (1.7.1 at the base; it needs crates.io's index and is `BLOCKED:` without it), and `deep-physics` built from it into
  `target/acceptance-2010-lock/target`, its own target folder, so the workspace's binary and fingerprints are never
  touched. Every cargo command on it names the lockfile through cargo's `resolver.lockfile-path` configuration, given as
  the variable `CARGO_RESOLVER_LOCKFILE_PATH` (stable since cargo 1.97), so a build script of the build, and any cargo
  it runs to read the resolution, sees the planted lockfile too. The checkout's own `Cargo.lock` is never written.
  That build is cold the first time: 2 min 29 s on this Mac (2.3 min of CPU). Checked at the base, with the same
  commands outside the test: the plant changes only wide's version and checksum in the lockfile, `cargo tree` reads
  wide 1.7.0 through it, and the binary built from it bakes.
- **`node scripts/physics-build.mjs`** (criterion 1's preflight lane, below) three times.
- **`cargo tree`, `cargo metadata` and `cargo config get`** (the last under `RUSTC_BOOTSTRAP=1`, which admits
  `-Zunstable-options` on the stable 1.99.1, as #2009's suite reads rustdoc JSON).
- **Linux x86_64** (criterion 3's second test only): `deep-physics` built in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm` (the channel `rust-toolchain.toml` names), the checkout mounted read-only, caches under
  `target/acceptance-2010-linux/`, as #532's suite builds its second host. Nothing is pulled: no Docker or no
  linux/amd64 image is `BLOCKED:` naming the `docker pull` command; a failed build fails. Docker Desktop on this Mac runs
  that image under QEMU (`uname -m` answers `x86_64`; jemalloc reports QEMU), so the build is slow: that test's timeout is
  3 hours. Not built at the base (the test fails before it, see BASE-FAILURE.txt).

Every other test passes an explicit 60-minute timeout (it overrides `--testTimeout`). Temporary folders (binaries,
bake stores) are deleted. Node built-ins and vitest only. No cargo is `BLOCKED:` (a failed test, never a pass).
**`scripts/lanes.mjs` needs `'tests/acceptance/2010/'` in its `alone` list** (the files build cargo binaries, start
Docker and a second cargo build), **and the preflight needs a lane that runs `node scripts/physics-build.mjs`** (criterion
1's "the preflight refuses"); this README is the instruction, the implementer makes those edits.

`BASE-FAILURE.txt` is the run at the base: every test fails at an assertion because the surface is absent. Each test
calls first what the base lacks, so at the base it fails before its slow legs (the planted lockfile's build, Docker).

## The surface under test

The issue names a key, a golden, its report, a comparator, a preflight and planted wrong programs, but no command line.
**Every call, reply field, flag, planted name, script and configuration below that the issue or the design doesn't give
is this job's invention**, the smallest surface the criteria need, extending #2009's (`tests/acceptance/2009/README.md`:
The surface under test), whose calls, fields, planted names and world document stay as that README defines them. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### The world document: `outputs`

A `physics.world@1` world may hold `outputs: {ID → {"from": body ID, "read": "position"}}` (Physics output's `from` and
`read`; `to`, interpolation and the rest keep their defaults and aren't used). Criterion 5 needs a bake's outputs, and
#2009's reader refuses the field.

### `deep-physics`: what this suite adds

| Call | Reply |
|---|---|
| `{"call": "runtime"}` | `{"ok": true, "runtime_digest": hex, "backend": {"name": "rapier3d", "version": "0.36.1", "features": [feature]}, "pins": [Pin]}` |
| #2009's `bake`, plus `"frame_rate"?: "p/q"` and `"store"?: folder` | #2009's reply, plus `"key": 64 hex`, `"step_hashes": [16 hex]`, `"outputs": Outputs`, and with a store `"reused": bool` |
| #2009's `restore`, plus `"checkpoints"?: true` | #2009's reply, plus `"step_hashes": [16 hex]`, and with `checkpoints: true`, `"checkpoints": [Checkpoint]` |
| `{"call": "play", "world", "steps", "frame_rate", "store"}` | `{"ok": true, "key", "outputs": Outputs}`, or `{"ok": false, "code": "no_bake", "key"}` with no `outputs` |
| `{"call": "golden", "world", "steps", "frame_rate"?, "store", "verify_on": [target]}` | `{"ok": true, "golden": Golden}` |
| `{"call": "golden_verify", "golden": Golden, "world", "steps", "frame_rate"?, "store"?, "shift"?: Shift, "ftz_at"?: step}` | `Run` |
| `{"call": "golden_cross", "golden": Golden, "machines": [Machine], "runs": [Run]}` | `{"ok": true, "verdict": "PASS" \| "FAIL" \| "PENDING" \| "BLOCKED", "asks": [Ask]}` |

```text
Pin      = {"name", "version", "features": [feature]}
Outputs  = {"frame_rate": "p/q", "frames": n, "hash": string, "series": {<output ID>: [[x, y, z]]}}
Golden   = {"bake_key": 64 hex, "runtime_digest": hex, "machine": {"os", "arch", "cpu"}, "step_hashes": [16 hex],
            "checkpoint_hashes", "occurrences_hash", "record_on": target, "verify_on": [target]}   (Golden's fields)
Shift    = {"step": s, "id": body ID, "field": Field, "ulps": n}
Run      = {"ok": true, "verdict": "PASS" | "FAIL", "bake_key", "runtime_digest", "machine": {"os", "arch", "cpu"},
            "target": triple, "report": Report | null, "failure": Failure | null}
Report   = {"first_step": k, "checkpoint": c | null, "field": {"id", "field": Field, "values": [a, b], "ulp_distance": n} | null}
Failure  = {"step": k, "register": "FPCR" | "MXCSR", "what": string}
Machine  = {"name": string, "target": triple}
Ask      = {"kind": "unblock", "target": triple, "what": string}
Field    = pos.x | pos.y | pos.z | rot.x | rot.y | rot.z | rot.w | linear.x | linear.y | linear.z | angular.x | angular.y | angular.z
```

What each means:

- **Step hashes.** `step_hashes[k]` hashes the state after k steps (index 0 the state as built, as #2009's `bodies`
  index their states), a u64 as 16 lowercase hex: each body's pose and velocity by stable ID in canonical order, each
  float by its IEEE bits, never rounded (Checkpoint ring). A restore's `step_hashes[i]` is the state i steps after the
  restored one (index 0 the restored state), so a restore of the bake's checkpoint at step c gives the bake's
  `step_hashes` from c on. With `checkpoints: true` a restore also answers the checkpoints its run takes, as a bake
  takes them, at each multiple of `checkpoint.every` after the restored step up to its last; restored from the bake's
  checkpoint at c, they hold the same `state` bytes as the bake's checkpoints after c (the Oracle lane's
  snapshot_roundtrip port reads them).
- **The bake key** (Bake: `key`), sha256 as 64 lowercase hex, over what the design lists (the canonical world document,
  the scene channels, drivers and input track, the backend's name, version and resolved features with the resolved
  versions and features of parry, wide, glam, glamx, simba and libm, the target triple, rustc's version, solver and
  capacity) and, as the Scope says, the document's frame rate. The same document, frame rate and steps on the same build
  give the same key.
- **`frame_rate`** is the document's (canvas primitives: `frame_rate: rational = 60/1`), written `"p/q"`; absent, `"60/1"`.
- **Outputs** (Bake: `outputs`, sampled at the document's frame rate, f32). Frame k sits at t = k·q/p s, for k = 0, 1, …
  while t is within the steps baked (the frame at exactly the last step may be left out). Output `read: "position"`
  reads its body's position at t by Physics output's rule: with step length h, s = ⌊t ÷ h⌋ and α = (t − s·h) ÷ h, exact
  from flicks, the position is the state after step s lerped toward the state after step s + 1 by α. `frames` is the
  count, `series` each output's values by frame, and `hash` the outputs' hash (its form is the implementer's; equal
  outputs give equal hashes, a planted difference a different one).
- **`store`** is a folder where bakes are kept as evidence by key (Bake: `store`). A `bake` with a store that already
  holds its key answers that stored bake with `"reused": true` and simulates nothing; otherwise it bakes, stores the
  bake and answers `"reused": false`. `bodies` (and `checkpoints` when asked) come only with a bake that simulated.
  `play` reads the store only: it computes the document's key and answers the stored bake's outputs, and never
  simulates; with nothing under the key it answers `no_bake`.
- **`runtime`** names what this build is: `backend.features` rapier3d's resolved features, `pins` every resolved
  version of parry3d, wide, glam, glamx, simba and libm in this build with its resolved features, as `cargo tree
  --locked -p deep-physics-rapier -e normal` resolves them (any order), and `runtime_digest` (Registry and seal:
  runtime digest) over the physics implementation, its version and those pins. A golden's `runtime_digest` is this one.
- **`golden`** bakes the world from step 0 on this machine, stores the bake in `store`, and records its Golden:
  `bake_key` (Golden: the key without the target triple, so the same on every machine), `machine.arch` as Rust names
  the CPU (`aarch64`, `x86_64`), `record_on` this host's target triple, `verify_on` as asked, `step_hashes` as a bake's.
- **`golden_verify`** replays the golden's world on this machine. Each step's start asserts the floating-point control
  register (flush-to-zero off, among what the guard reads); a step that starts with it otherwise ends the run there:
  verdict `FAIL`, `failure` naming the step and the register (`FPCR` on arm64, `MXCSR` on x86_64), `report` null, and
  no hash compared. Otherwise it compares its step hashes with the golden's: none differs, `PASS` with `report` null;
  else `FAIL` with a Report: `first_step` the first step whose hash differs; `checkpoint` the recording bake's first
  checkpoint at or after it, read from `store`, decoded and compared with this run's own state at that step field by
  field in canonical order (bodies by ID, each body's fields in Field's order); `field` the first that differs, with
  the recorded value first and this run's second, as f32 numbers, and their distance in f32 ulps. `target` is this
  host's triple. `shift` plants a one-field change in this run: after step `s` is stepped and before its hash and any
  checkpoint are taken, body `id`'s `field` moves `ulps` f32 values (toward +∞ when positive). `ftz_at: k` sets
  flush-to-zero on the thread that steps the world just before step k starts.
- **`golden_cross`** says where a golden stands across machines. `machines` are the second machines configured: the
  hosts block's entries (canvas primitives, Golden: "runs across machines use the hosts block (R3)"), which don't exist
  at the base, so this call carries them, each a name and the target it runs. `runs` are `golden_verify` replies. For
  the golden's `verify_on` target (one in this suite): a run whose `target` is it, on another architecture than the
  golden's `machine.arch`, decides: the verdict is that run's. Otherwise, a configured machine with that target makes
  it `PENDING`, with no ask. Otherwise it is `BLOCKED` with one ask, `kind: "unblock"`, naming the target. A run on the
  recording machine's own architecture never counts (`machines: same` never satisfies cross-machine). It is never
  `PASS` without such a run, and never `INCONCLUSIVE`.

### Planted twins of `deep-physics`

Each is one criterion's wrong program, reachable only through `--planted <name>` (one name per process, as in #2009),
and changes nothing else:

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted hash_rounds_1e6` | 2 | every state hash the module takes (each step hash, and a checkpoint's canonical hash where the same function takes it) reads each float rounded to the nearest multiple of 1e-6 instead of its bits |
| `--planted key_omits_frame_rate` | 5 | the bake key leaves out the document's frame rate |

The judge that passes the real program must fail on the twin's answers; each twin's process must exit 0 and answer.

### The preflight lane: `node scripts/physics-build.mjs [<cargo argument> …]`

A new script, the preflight's guard on the physics build, after `scripts/wasm32.mjs`. It judges the build `cargo build
--locked -p deep-physics-rapier --bin deep-physics <cargo arguments>` would make in the caller's environment and this
checkout's and machine's cargo configuration (it needn't build): the resolved features (rapier3d's `simd8` and the rest
the criterion excludes are refused) and the flags the build's rustc runs get (`target-cpu=native` and `+fma` are
refused). It prints a line starting `PASS` and exits 0, or a line `FAIL <flag>: <why>` naming the flag and exits 1. The
tests run it with the caller's `*RUSTFLAGS` variables cleared, plain, with `--features rapier3d/simd8`, and with
`--config 'build.rustflags=["-C", "target-cpu=native"]'`; those planted builds are the test's own arguments, so the
script can't plant them itself.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#2010.9300a915` | `ac1-pinned-build.test.ts` (3) | `cargo tree -e normal -p deep-physics-rapier`: rapier3d 0.36.1 and parry3d 0.31.1 alone; rapier3d's resolved features exactly what default, enhanced-determinism and serde-serialize turn on in its own feature table (alloc, dim3, enhanced-determinism, f32, serde-serialize, std), none of block-solver, fem, simd8, parallel, unsync-callbacks; no glam with fast-math; `runtime`'s backend features and pins equal cargo's for rapier3d and for parry3d, wide, glam, glamx, simba and libm; no `rustflags` in cargo's merged configuration holds target-cpu=native or +fma. The preflight passes the checkout's build and fails `--features rapier3d/simd8` naming simd8 and `build.rustflags` with `-C target-cpu=native` naming target-cpu=native. A golden carries `runtime`'s digest; the planted lockfile (wide 1.7.1 → 1.7.0) resolves wide 1.7.0, and the binary built from it pins wide 1.7.0 and answers another runtime digest and another bake key for the same world. Fails: a feature or version off the pin, pins the program doesn't really resolve, a key or digest blind to wide, a preflight that passes simd8 or native or names neither |
| 2 `#2010.fa073c97` | `ac2-step-hashes-and-locator.test.ts` (2) | the pile-and-flyer world (helpers), 360 steps: step hashes (361, more than 180 distinct) equal across two processes, and for the same world with its bodies written in reverse order; restored from each checkpoint (60 … 300), the restore's step hashes equal the bake's from there on. A golden recorded with a store; a second run without change PASS; with a one-ulp shift of `ball`'s `linear.x` at step 300: FAIL, `first_step` 300, `checkpoint` 300, field `{id: ball, field: linear.x, values: [1.5, 1.5000001192092896], ulp_distance: 1}`; `hash_rounds_1e6`'s answer to the same is caught. Fails: hashes that drift between runs or follow document order, a restore that diverges, a hash that rounds (the twin), a comparator naming another step, checkpoint, body or field |
| 3 `#2010.45fbb8dc` | `ac3-cross-machine.test.ts` (2) | a golden of that world recorded here verifies on `x86_64-unknown-linux-gnu`, records this host's triple and arch; with no machine configured it is BLOCKED with one unblock ask naming x86_64-unknown-linux-gnu, also after this Mac's own PASS run is given. With `{name: linux-amd64, target: x86_64-unknown-linux-gnu}` configured it is PENDING with no ask, also with this Mac's run; then `deep-physics` built and run in a linux/amd64 container verifies it (`target` x86_64-unknown-linux-gnu, arch x86_64, PASS or FAIL), and with that run the golden takes its verdict. Fails: a cross-machine golden that passes, is INCONCLUSIVE, asks twice or names no target; one a same-architecture run satisfies; one that stays pending after the machine ran it, or is pending with no machine |
| 4 `#2010.61aa2e8e` | `ac4-fp-control.test.ts` (1) | a golden of that world (240 steps); its replay PASS with no failure; with `ftz_at: 120`, FAIL, `failure` at step 120 naming FPCR (MXCSR on x86_64), `report` null; the same with a one-ulp shift at step 60 as well, still the register at 120 and no report. Fails: a replay that doesn't assert the register (it passes, or fails on a hash), one that compares hashes first, or names another step |
| 5 `#2010.bf531cb7` | `ac5-frame-rate-key.test.ts` (1) | the ball-and-goal lab (helpers), 360 steps at 120 Hz: bakes at 60/1 then 50/1 into one store, keys differ and the second isn't a reuse; each bake's outputs are the ball's positions at k ÷ p s (within 1e-4 m of the lerp of its own states), 180 or 181 frames at 60, 150 or 151 at 50; `play` at 50/1 from that store reads key 50's outputs, sampled at 50 fps, equal by hash and value to a fresh 50/1 bake in an empty store; `play` on an empty store answers no outputs. `key_omits_frame_rate` reuses the 60 fps bake and the judge's failure names frame_rate. Fails: a key without the frame rate (the twin), playback that re-simulates or reads another rate, outputs sampled off the frame times |

Test count: 3 + 2 + 2 + 1 + 1 = 9.

## Readings where the issue leaves a choice

- **The surface.** `deep-physics` again, after #2009, plus one preflight script and cargo's own commands, because the
  criteria need keys, hashes, goldens and planted programs on the same binary, a build cargo resolves, and a lane.
- **"The physics crate's resolved dependency tree"** is `deep-physics-rapier`'s normal tree as `cargo tree --locked`
  resolves it for this host; **"Rapier's resolved features its defaults plus …"** is rapier3d's resolved feature set
  equal to the closure, in rapier3d's own feature table, of `default`, `enhanced-determinism` and `serde-serialize`
  (entries naming another crate's feature left to it), without `default` itself, since the crate may name dim3, f32 and
  std with default features off, as it does at the base.
- **"In the bake key and the runtime digest"**: the program names its pins in `runtime`, which must be cargo's
  resolution, and the planted lockfile shows both values move with wide. The planted lockfile moves wide alone (cargo's
  `update -p wide --precise`), one release down from the base's (1.7.0; 1.7.1 if the checkout ever holds 1.7.0).
- **"Its build flags"** are those cargo's merged configuration gives this checkout on this machine (`cargo config get`,
  every `rustflags` key at any depth), with the caller's `*RUSTFLAGS` variables cleared; a shell's flags aren't the
  checkout's. **"The preflight refuses a build with simd8 or target-cpu=native"** is the new lane, given each planted
  build as cargo arguments.
- **"Run with its bodies created in reverse order"**: the same world document with its `bodies` written in reverse;
  the module creates in canonical order (World and backend: "Building a world creates everything in canonical order"),
  so the step hashes don't move. Checked at the base that this has teeth: with the boxes renamed so that canonical
  order runs the other way, all twelve boxes' states differ from step 13 on, so creation order changes Rapier's results
  on this world and a module that creates bodies in document order is caught.
- **"Replayed from a checkpoint"**: every checkpoint below the last, each run to step 360.
- **"A one-ulp change to one body's x velocity at step 300"**: applied to the state after step 300, before its hash, to
  `ball`, which flies at 1.5 m/s with gravity_scale 0, so its x velocity is exactly 1.5 at every step (checked at the
  base: one value over 361 states) and a one-ulp change stays one ulp. **"At the next checkpoint"**: the first
  checkpoint at or after that step (Golden: "decodes the recording machine's checkpoint at or after that step"), step
  300 with `checkpoint.every` 60.
- **"A planted hash that rounds floats to 1e-6 misses it and fails"**: the twin's comparator doesn't name step 300,
  ball, linear.x and ulp distance 1 (1.5 and its next f32 round to the same 1e-6), so the criterion's judge fails on it.
- **"A cross-machine golden"**: one whose `verify_on` names the other CPU architecture's target (Golden: Linux x86_64
  for one recorded on the arm64 Mac); the tests ask for that one target, leaving out the web player's wasm32, so "one
  unblock ask naming the target" has one target to name. **"Configured"**: listed in `machines`. **"Until that machine
  has run it"**: until a run from that target is among `runs`; then its verdict, PASS or FAIL (the issue doesn't claim a
  cross-architecture match), and never PENDING again.
- **"Before any hash is compared"**: no hash comparison at all in a run that meets the guard; so a run with flush-to-zero
  at step 120 and a hash already off at step 60 still fails on the register at 120 with no report.
- **"Naming the floating-point control register"**: `failure.register`, FPCR on this arm64 Mac (MXCSR on x86_64).
- **"A ball-and-goal lab"** doesn't exist in the repo; it is `ballAndGoal()` in helpers.ts: a 0.11 m, 0.43 kg ball
  kicked at (6, 3, 0.4) m/s toward two posts and a crossbar 8 m away, which it passes under after landing (checked at the
  base without its output: x 7.50 m at step 180, 13.94 m at 360, rolling at 4.31 m/s), with one output, its position.
- **"Playback at 50 fps reads outputs sampled at 50 fps"**: `play` from the store the 60/1 and 50/1 bakes went into;
  "sampled at 50 fps" is checked on the values against the lerp of the bake's own states at k ÷ 50 s, not only on the
  label. **"A fresh bake"**: a 50/1 bake in an empty store. **"Fails, naming the field"**: the test's judgement of the
  twin's answers fails with a message naming frame_rate (the twin itself needn't name it).

## Not tested, because no criterion reaches it here

The input track and the scene's channels and drivers in the key (worlds take no inputs before #522); solver, capacity,
target triple and rustc in the key; occurrences, `occurrences_hash`, counters and checkpoint `deep_hash`; the checkpoint
ring's budget and doubling; a golden under another key or runtime digest, and comparing checkpoint bytes across
versions; the report with the recording bake absent; `emulated: true` on a container's record; the web player's wasm32
target; the GPU rule; `threads: 1`, `libm: pure Rust` and `target_features: baseline` beyond the flags read here;
`physics.determinism` as a check kind; 2D worlds.
