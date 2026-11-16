# Acceptance tests for #172, Oracle lane: the upstream physics engine's portability and parity tests, on the web player's output

Written first, blind, from issue #172 (`gh issue view 172 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/172.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the two upstream files that page
pins for criterion 1 (read from `doneright/oracles/vendor/rapier-3406750a38/`), the #172 suite's surface
(`tests/acceptance/172/README.md`, written by the same job) and base commit `f98921218`, by a job that never saw an
implementation of #172; none existed, and no other worktree, branch or PR was read. #136's rule applies: a linked test
counts only when run against our output, so every case here builds our world document in a scene, exports it to the
web and asserts on what the player answers through `probe()` in headless Chrome, never on the engine called directly.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

Scope: criterion 1 (`#172.36bfe3c1`), whose Oracle row calls these tests "the physics half of the player matching the
app"; logic hashes and evaluated data have no upstream test and stay with `tests/acceptance/172/lab.test.ts`. The other
nine criteria have no upstream test (the page says why).

## Sources

| Criterion | Upstream, pinned | File (test) | Use | License |
|---|---|---|---|---|
| 1 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `crates/rapier3d/tests/snapshot_portability.rs` (snapshot_is_target_independent) | port | Apache-2.0 |
| 1 | rapier, the same commit | `crates/rapier3d/tests/parallel_path_parity.rs` (parallel_and_sequential_builds_agree) | port | Apache-2.0 |

No upstream code is copied: each test's scene and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and keeps upstream's numbers. Not ported: `crates/rapier2d/tests/snapshot_portability.rs`
(no 2D backend is in the build). Each test first reads its pinned file from the oracle checkout and checks its SHA-256
(snapshot_portability `96ac7c88…37bd6`, parallel_path_parity `2492334a…04b97`), so the port is held to the pin.

## Where the lane reads the files, and how a fresh checkout gets them

`<oracles>/vendor/rapier-3406750a38/crates/rapier3d/tests/…`, where `<oracles>` is `$DEEP_ORACLES` when set, else
`../deep-oracles/doneright/oracles` beside this checkout (as #1965's Oracle lane reads it):

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

A missing file fails the test with `BLOCKED: the pinned upstream file … is missing …` and that one unblock ask. It never
passes and is never skipped.

## Run

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
DEEP_ORACLES=<path> NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/172-oracle --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/172-oracle/tsconfig.json
rm -rf tests/acceptance/172-oracle/node_modules
```

`helpers.ts` re-exports the #172 suite's helpers (`../172/helpers.ts`), so both lanes build and ask the same programs
the same way: `deep-show` (`full`) and `deep-physics` built once per file, the bundle served by a child process, Google
Chrome headless with WebGPU on. The scenes come from `../2012-oracle/helpers.ts` (`portabilityScene`) and
`../2010-oracle/helpers.ts` (`upstreamScene`, `box`), read only. `scripts/lanes.mjs` needs
`'tests/acceptance/172-oracle/'` in its `alone` list (the #172 README gives the line). `BASE-FAILURE.txt` says where each
test stops at the base.

## Upstream's tests as ours

- **snapshot_portability** steps a mixed scene 60 steps and requires the whole world's snapshot to be one committed
  size and digest on every target, wasm32 included. Ours: #2012's Oracle port of that scene (a 6 × 3 × 6 jittered pile,
  four r 0.25 balls on ball joints from (0.3, 7, 0) that never sleep, a 3 × 0.5 × 3 sensor at y 4, a never-sleeping
  r 0.15 CCD ball from (−8, 2, 0.5) at (90, −20, 1) m/s; the multibody chain left out, our document has none) as the
  world `lab` of a 1 s scene, a deep checkpoint every 60 steps. The committed golden is the app's bake on this Mac
  (deep-show's `physics_bake`, and deep-physics's bake of the same scene for the checkpoint). Exported to the web and
  seeked step by step in the player: every step hash 1 … 60 the app's, and at 60 the app's full-state hash, which is
  the hash over the whole world's bytes, naming the first step that differs.
- **parallel_path_parity** holds a threaded native build and a single-threaded wasm build to one golden hash of the
  broad phase, the narrow phase and every body's pose and velocity, after a pile settles and sleeps (220 steps) and
  ten 12-box clusters drop onto it one every 40 steps with sideways kicks. Ours: the native side is the app's build
  (our physics build excludes `parallel`, so it is single-threaded too, and the contract is the same: native and wasm32
  agree bit for bit), the client the web player on one thread in Chrome. The scene (`parityDoc`): upstream's 30 × 0.5
  × 30 ground, 14 × 2 × 14 jittered pile and ten clusters at upstream's places and kicks. Our document can't add a body
  mid-run, so cluster r rests from the start on a frictionless kinematic trapdoor with its lowest row at 6 + 4r m,
  never sleeps, and is released at upstream's step 220 + 40r: the scene's channel slides its trapdoor 40 m aside and the
  press `drop_r` launches each box at upstream's kick. 620 steps, a deep checkpoint every 20. In the player every step
  hash 1 … 620 and every checkpoint's full-state hash (which covers the whole world, its contact state with it) are the
  app's, naming the first step that differs.

## Criteria to tests

| ID | File (tests) | Upstream assertion, on our output |
|---|---|---|
| 1 `#172.36bfe3c1` | `snapshot-portability.test.ts` (1) | the mixed scene's 60 steps in the web player: all 60 step hashes and the full-state hash at step 60, the app's |
| 1 `#172.36bfe3c1` | `parallel-path-parity.test.ts` (1) | the settling pile and ten drops, 620 steps in the web player: every step hash and every checkpoint's full-state hash, the app's |

Test count: 1 + 1 = 2.

## Legs that read BLOCKED

None is ever a pass: no oracle checkout (the ask above); no Google Chrome or no WebGPU adapter in headless Chrome (the
#172 README's asks). Wrong programs each test fails: the merge base (no web export); a player whose physics differs
from the app's by a bit at any step or in any carried state (a wasm32 build off the pinned features, a threaded or
SIMD path that reorders work, an encoding that differs on 32-bit), naming the step.
