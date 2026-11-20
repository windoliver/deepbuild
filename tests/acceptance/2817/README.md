# #2817 — blind acceptance tests

Drafted blind against issue #2817, `docs/technical-design.md` (Dogfooding; Built to be hard to get wrong),
`docs/parallel-proof.md` (Binaries for tests), `AGENTS.md` and base commit `f17fa347c` only. No implementation was
seen or written. Do not edit these tests; a dispute goes to a blind redraft.

## Surface

Each test builds a disposable fixture repository and runs the real before lane on it
(`node scripts/proof.mjs before`, which calls `prepareRuns` and `before` in `scripts/proof-runs.mjs` and
`buildBinaries` in `scripts/proof-binaries.mjs`). The fixture holds:

- this checkout's `scripts/` folder, copied unchanged: that is the code under test;
- a two-crate Cargo workspace whose bins are `deep-hook` and `deep-show`, each printing one word from its source
  (`hook-base`/`show-base` on the merge base, `hook-change`/`show-change` on the change), with no `target/` committed;
- a hub stand-in at `packages/cli/dist/main.js`: `hub run` looks for both binaries only under its own checkout's
  `target/{release,debug}/`, as `deepHook()` and `canvasCore()` do, and prints `BLOCKED: no deep-hook is built under
  target/` (exit 3) when one is missing, else runs both and prints their words;
- one tagged inner test under `tests/acceptance/2817/` and a `Part of #2817` commit; the issue body comes from
  `DEEP_PROOF_ISSUES`, holding #2817's own three criteria, so inner tags are the real criterion IDs.

Inner tests append what they saw (their side, read from their copy's own `crates/deep-hook/src/main.rs`, their
copy's path, the hub's reply or the binaries found) to an observations file; the outer test asserts on those rows and
on the lane's own output lines. Nothing is mocked; HOME, bays, throttle table and temp files live in the sandbox.

IDs are `#2817.` plus the first eight hex digits of SHA-256 of the criterion text, trimmed with white space
collapsed (`criterionId` in `scripts/proof-change.mjs`).

## Requirement → test → proof

| Criterion | Test | What it proves |
|---|---|---|
| `#2817.caef3798` hub through `packages/cli/dist/main.js hub run` runs to its assertions on both sides | `hub.test.mjs` | The inner test starts the hub stand-in and throws `BLOCKED` (not an assertion) if the stand-in finds no binary, as `tests/acceptance/1868/` did. The outer test requires both sides to have run it, the hub to have started (exit 0) on each side, the change side to answer `hook-change show-change`, no `BLOCKED`/`FAIL before` line for the test, and `PASS before: … failed on the merge base at its assertion`. |
| `#2817.51a8f2a0` each side's `target/debug/` binaries are built from that side's own sources | `sources.test.mjs` | The change edits the `deep-hook` crate (and `deep-show`'s). The inner test names `packages/cli/dist/main.js` and runs `<copy>/target/debug/deep-hook` and `deep-show` directly. The outer test requires each side's programs to run from its own copy's `target/debug/`, the change side to see `hook-change`/`show-change` and the base side `hook-base`/`show-base`, and the lane's `PASS before` line. Shared binaries or binaries from one side's sources fail it. |
| `#2817.e0f437e2` a test naming neither package finds no lane-put `deep-hook`/`deep-show` | `neither.test.mjs` | Run 1: the only tagged test names none of `packages/hub/`, `packages/cli/`, `@deepbuild/hub`, `@deepbuild/cli`; on both sides its copy's `target/debug/` must hold neither binary. Run 2 (fresh sandbox, so fresh bays): a control test naming `packages/cli/dist/main.js` must find both on both sides. The control is there because a lane that never builds passes run 1; the base fails at the control's assertion. |

Wrong programs these were checked against (in a scratch copy, not committed): a planted lane that builds both bins
into each copy's `target/debug/` when a selected test names a hub/CLI package passes all three; the same lane building
for every test fails `#2817.e0f437e2` at run 1; one that copies the first side's binaries to the other fails
`#2817.51a8f2a0`. No `twins.json` is needed: every test fails on the merge base at its assertion.

## Run

Node 24, Git, Cargo and rustc on PATH; the repository's `node_modules` installed (the copied scripts import
`typescript`). Keep TMPDIR outside any Cargo-configured repository.

```sh
node --test --test-concurrency=1 tests/acceptance/2817/*.test.mjs
```

On the base: 3 tests, 3 failures at their assertions (`BASE-FAILURE.txt`), about 35 s in all at load ~100.

## Limits

- The outer tests' helper names `packages/cli/dist/main.js` (inside the fixture), so once the fix lands the real
  before lane will also build the real `deep-hook` and `deep-show` for this folder's runs on each side, per the scope.
- Only the bay path ran here (the fixture is its own worktree, so `claimPair` grants a bay pair under the sandbox
  HOME); the temporary-copy path and twin copies are not exercised. Twin sides getting their own binaries is unproven
  by these tests.
- The hub stand-in exits after answering; it is not the real hub. The issue's reading (a before-lane run of
  `tests/acceptance/1868/` on #2798's branch reaching its assertions) is not run here.
- Spark: not run.
