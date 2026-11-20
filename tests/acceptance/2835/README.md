# #2835: blind acceptance tests

Written blind from issue #2835, `docs/technical-design.md` (Dogfooding), `docs/parallel-proof.md` (Binaries for
tests), `AGENTS.md` and base commit `18f89124c` (head of PR #2821) only. No implementation was seen or written. Do not
edit these tests. A dispute goes to a blind redraft.

## Surface

Each test builds a disposable fixture repository and runs the real mutation lane on it:
`node scripts/proof.mjs mutation`, which runs `prepareRuns` and then `mutation()` in `scripts/proof-runs.mjs`. The
fixture holds:

- this checkout's `scripts/` folder, copied unchanged. That is the code under test.
- a `node_modules/` folder of its own whose entries link to this checkout's installed packages, as
  `tests/acceptance/569` lays it. The lane finds StrykerJS at `<fixture>/node_modules/.bin/stryker`.
- a two-crate Cargo workspace whose bins are `deep-hook` and `deep-show`. Each prints one word from its source:
  `hook-base`/`show-base` on the merge base, `hook-change`/`show-change` on the change. No `target/` is committed.
  Each bin's source is `crates/<name>/main.rs`, outside `crates/*/src/`, so the change gives cargo-mutants (not
  installed here) no Rust line. Only the TypeScript lines are mutated.
- a hub stand-in at `packages/cli/dist/main.js`. `hub run` looks for both binaries only under its own checkout's
  `target/{release,debug}/`, as `deepHook()` and `canvasCore()` do. When one is missing it prints `BLOCKED: no
  deep-hook is built under target/` and exits 3. Otherwise it runs both and prints their words.
- `packages/numbers/src/numbers.ts`, which the change adds `next()` to. Those are the added lines StrykerJS mutates.
  Every inner test asserts `next(1) === 2`, so it kills the mutants.
- tagged inner tests under `tests/acceptance/2835/` in a `Part of #2835` commit. `DEEP_PROOF_ISSUES` holds #2835's
  own three criteria, so the inner tags are the real criterion IDs.

Inner tests append what they saw to an observations file: their stage, their copy's path, and the hub's reply or the
binaries found. The stage is `mutation` when the lane's `stryker.proof.config.json` is in their copy. The active mutant
comes from `__STRYKER_ACTIVE_MUTANT__`, which is unset in StrykerJS's initial run. The outer test asserts on the
initial-run rows and on the lane's own lines.

A proof gets a bay pair because the fixture is its own worktree, so `claimPair` grants one under the sandbox HOME. The
"outside a bay" path runs the proof as the child of a process holding a `bay-pair` grant. `bays.mjs` then refuses a
pair ("an ancestor of this process holds a bay pair"), and the mutation lane's copy is a fresh `copyChange` copy.
Nothing is mocked. HOME, bays, the throttle table and temp files all live in a sandbox folder.

IDs are `#2835.` plus the first eight hex digits of SHA-256 of the criterion text, trimmed with white space collapsed.
That is the formula of `criterionId` in `scripts/proof-change.mjs`, which is not exported. The IDs were computed with
the same formula.

## Requirement → test → proof

| Criterion | Test | What it proves |
|---|---|---|
| `#2835.addc1d10`: a passing tagged test that starts the hub through `packages/cli/dist/main.js hub run` gets through StrykerJS's initial run, and the lane reports mutants, not BLOCKED | `hub.test.mjs` | No bay, so the mutation copy is fresh with no `target/`. The inner test starts the hub stand-in and throws on a missing binary. It fails on the merge base at its assertion (the hub answers `hook-base show-base`), so it is in the lane's plain StrykerJS run, as the issue describes. The outer test requires the inner test to have passed in the before-lane change copy, and StrykerJS's initial run to have run it in a different, non-bay copy. In that run the hub must start (exit 0) and answer `hook-change show-change`. There must be no `BLOCKED mutation:` line, and the lane must report `N mutants of the added lines` with N ≥ 1. |
| `#2835.1b0cb5cf`: the mutation copy's `target/debug/` programs are built from the change's own sources, even after a twin's before-lane run in the same bay put its `deep-hook` there | `sources.test.mjs` | Bay path. The inner test names `packages/cli/dist/main.js` and runs `<copy>/target/debug/deep-hook` and `deep-show`. It throws (not an assertion) on the merge base, so the lane runs its twin `hook-twin` (in `twins.json`), which edits the `deep-hook` crate, as a use of the change bay. The outer test checks that this twin run saw `hook-twin` in the bay. StrykerJS's initial run, in that same bay, must then read `hook-change` and `show-change` from the copy's own `target/debug/`, with no `BLOCKED mutation:` line and mutants reported. |
| `#2835.fe9d8d8e`: a tagged test naming neither package finds no `deep-hook`/`deep-show` in the mutation copy's `target/debug/` that the lane or an earlier use of its bay put there | `neither.test.mjs` | Run 1 (bay): an earlier proof (the before lane) runs a test naming `packages/cli/`, and the change bay's `target/debug/` then holds both binaries (checked). The next change replaces that test with one naming none of `packages/hub/`, `packages/cli/`, `@deepbuild/hub` or `@deepbuild/cli`. In the mutation lane, in the same bay, StrykerJS's initial run must find neither binary. Run 2 (fresh sandbox, no bay) is a control: a test naming `packages/cli/dist/main.js` must find both in the mutation copy. The control is there because a lane that never builds passes run 1. The base fails at the control's assertion. |

### Wrong programs checked

These were checked in scratch copies of this checkout, not committed. Each one adds code to `mutation()` just before
StrykerJS's runs.

| Program | `addc1d10` | `1b0cb5cf` | `fe9d8d8e` |
|---|---|---|---|
| Base (never builds) | fails | fails | fails (at the control) |
| Planted fix: `selectBinaries` over the passing tagged tests, then `buildBinaries` and `placeHubBinaries` in the mutation copy | passes | passes | passes |
| Always places both binaries, for every test | passes | passes | fails (run 1) |
| Builds only when a test names the hub and no `target/debug/deep-hook` is there yet, so a stale one is kept | passes | fails | passes |

No twin is needed for proof. Every test fails on the merge base at its assertion. The `twins.json` in
`sources.test.mjs` belongs to the inner fixture's scene, not to this folder.

## Run

You need Node 24, Git, Cargo and rustc on PATH, and this checkout's `node_modules` installed with `npm ci`. That gives
StrykerJS and the `typescript` the copied scripts import. Keep TMPDIR outside any Cargo-configured repository.

```sh
node --test --test-concurrency=1 tests/acceptance/2835/*.test.mjs
```

On the base, the 3 tests give 3 failures, each at its assertion (see `BASE-FAILURE.txt`). That took about 85 s in all,
at load ~55–65 on this Mac. The planted fix passes all three in about 110 s.

## Limits and ambiguities

- **Criterion 1's base failure depends on the path.** The issue says the lane ends BLOCKED. That holds when the
  hub test is in the lane's plain StrykerJS run, which happens for a test already proven by the merge base or a twin.
  This test uses that path. A test proven by nothing runs alone under the lane's at-assertion judge. There, the stand-in
  hub's plain `Error` makes the judge exit 0, and on the base the lane reports surviving mutants instead of BLOCKED.
  The assertion on the inner test's initial-run row covers both paths.
- **Criterion 3 cannot fail on the base by itself.** The base mutation lane never builds. #2817's before-lane use of
  the change bay also clears hub binaries for a test naming neither package, before the mutation lane starts. So run 1
  passes on the base, and the base failure comes from the control.
- **Mixed proofs are left out on purpose.** A proof whose mutation lane runs both a hub-naming test and a test naming
  neither is ambiguous. Read as a single build "before StrykerJS's first run", the scope would place both binaries,
  and criterion 3 would then fail. Read as one choice per StrykerJS run, it would not.
- The hub stand-in exits after answering. It is not the real hub, and `tests/acceptance/1868/` is not run here.
- The no-bay path is reached through a held bay-pair grant, as when a proof runs under another's pair. A proof whose
  root simply is not a worktree is not run.
- A build that cannot run ending the lane BLOCKED or INCONCLUSIVE is in the issue's scope, not its criteria. No test
  covers it.
- Spark was not run.
