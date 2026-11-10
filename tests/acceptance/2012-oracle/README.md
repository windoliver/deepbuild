# Acceptance tests for #2012, Oracle lane: Rapier's cross-target goldens, ported onto our output

Written first, blind, from issue #2012 (`gh issue view 2012 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/2012.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that page pins
(read from `doneright/oracles/vendor/rapier-3406750a38/`, each byte for byte the file the rapier3d 0.36.1 crate ships),
the #2012 suite's surface (`tests/acceptance/2012/README.md`, written by the same job) and base commit `903a1c07`, by a
job that never saw an implementation of #2012; none existed, and no other worktree, branch or PR was read. #136's rule
applies: a linked test counts only when run against our output, so every case here builds our `physics.world@1`
document and asserts on what `deep-physics` answers on each machine, never on Rapier called directly. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1 and 3, whose Oracle rows call these upstream tests "the backend half" of a golden that matches on
arm64, x86_64 and wasm32. Criterion 2's row is Rapier's own tests run with our pinned build; they run unported in
`tests/acceptance/2012/ac2-rapier-own-tests.test.ts`. Criterion 4 has no upstream test. The parts the page calls ours
(matching step for step through our golden's replay, the Linux VM's `machines: same`, the pending criterion) stay with
`tests/acceptance/2012/`.

## Sources

| Criteria | Upstream, pinned | File (test) | Use | License |
|---|---|---|---|---|
| 1, 3 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `crates/rapier3d/tests/snapshot_portability.rs` (snapshot_is_target_independent) | port | Apache-2.0 |
| 1, 3 | rapier, the same commit | `crates/rapier3d/tests/simd_backend_determinism.rs` (golden_state_hash_is_backend_independent) | port | Apache-2.0 |

No upstream code is copied: each test's scene and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and keeps upstream's numbers. Not ported: `crates/rapier2d/tests/snapshot_portability.rs`
(no 2D backend is in the build), `simd_backend_parity.rs` (per-operation SIMD lanes, which no world document reaches; it
runs as Rapier's own test under criterion 2) and `snapshot_roundtrip.rs` (a restore on one machine, ported for #2010 in
`tests/acceptance/2010-oracle/`; it runs as Rapier's own test under criterion 2).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2012-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2012-oracle/tsconfig.json
rm -rf tests/acceptance/2012-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #2012 suite's helpers (`../2012/helpers.ts`, which re-exports #2010's and #2009's), so both
lanes build and ask the same programs the same way: `deep-physics` built here once per file; `node
scripts/physics-wasm32.mjs` for wasm32; the #1983 lane's pinned image as linux/amd64 for Linux x86_64, its build cached
under `target/acceptance-2012-linux/amd64/` and shared with the #2012 suite, every run with no network. Each test has a
3-hour timeout (the first emulated build). The gates and Docker's unblock asks are that suite's (its README: Run them).
Upstream's world as ours comes from `../2010-oracle/helpers.ts` (`upstreamScene`, `withJointsAndSensor`): 60 Hz, 4
solver iterations as substeps, gravity (0, −9.81, 0), average combine, friction 0.5, density 1, a checkpoint ring of
1 GiB so its spacing never doubles. **`scripts/lanes.mjs` needs `'tests/acceptance/2012-oracle/'` in its `alone`
list**; the implementer makes that edit. `BASE-FAILURE.txt` is the run at the base: both tests fail at the wasm32 leg,
which doesn't exist, before any container build.

Checked at the base, before that run: both scenes pass the document check, record a golden and replay it PASS on this
Mac, with distinct step hashes at every step (61 of 61; 121 of 121); snapshot_portability's scene is 452,037 bytes of
whole world at step 60 (upstream's 488,334 includes the multibody chain left out here), simd_backend_determinism's
1,924,854 at step 60 and 1,924,942 at 120.

## The surface under test

The #2012 suite's: `golden` and `bake` (`checkpoints: true`, `read: []`) on this Mac, and `bake` through the wasm32
leg and in the linux/amd64 container. A bake's checkpoint `state` is the backend's whole-world bytes (base64) and its
`deep_hash` the golden's `checkpoint_hashes` entry. Nothing new is named here.

## Upstream's tests as ours

- **snapshot_portability** steps a mixed scene 60 steps and requires the whole world's bincode snapshot to be one
  committed size and FNV-1a digest on every target, wasm32 included: a size mismatch localizes an encoding change (a
  `usize` sentinel on 32-bit wasm32 was one), an equal size with another digest a value change. Ours: its scene as our
  document (a 6 × 3 × 6 jittered box pile, four r 0.25 balls on ball joints from (0.3, 7, 0) that never sleep, a
  3 × 0.5 × 3 sensor at y 4, a never-sleeping r 0.15 CCD ball from (−8, 2, 0.5) at (90, −20, 1) m/s; the multibody chain
  left out, our document has none), a golden of 60 steps recorded here. The committed constant is this Mac's: on wasm32
  and on Linux x86_64 the bake gives the golden's step hash at every step, and its checkpoint at step 60 holds this Mac's
  whole-world bytes exactly (same size, same bytes, naming the first that differs) with the golden's deep hash.
- **simd_backend_determinism** steps a 12 × 3 × 12 pile and a four-ball chain from (0, 8, 0) 120 steps and requires one
  committed hash of every body's pose and velocity bits whichever SIMD intrinsics `wide` picks: NEON here, SSE2 on
  x86_64, its scalar fallback on wasm32 without simd128. Ours: that scene as our document, a golden of 120 steps recorded
  here, whose step hash covers every body's pose and velocity bits; on wasm32 and on Linux x86_64 every step hash equal,
  and the whole-world bytes at 60 and 120.

## Criteria to tests

Each test's name starts with its criteria's IDs (`#2012.<8 hex>`, as `CRITERIA` in `../2012/helpers.ts`).

| IDs | File (tests) | Upstream assertion, on our output |
|---|---|---|
| 1 `#2012.4d10a14c`, 3 `#2012.53ff430e` | `snapshot-portability-rapier.test.ts` (1) | the mixed scene's golden recorded on this Mac, 60 steps: in wasm32 and on Linux x86_64 all 61 step hashes, and the whole world at step 60 byte for byte with its deep hash |
| 1 `#2012.4d10a14c`, 3 `#2012.53ff430e` | `simd-backend-determinism-rapier.test.ts` (1) | the pile-and-chain scene's golden, 120 steps: in wasm32 and on Linux x86_64 all 121 step hashes, and the whole world at 60 and 120 byte for byte with their deep hashes |

Test count: 1 + 1 = 2.
