# #2470 acceptance tests: deep-contracts compiles on main, and a second generate leaves no diff

Written first and blind at base `e0c90a5a5`, from issue #2470 (its text, and the closed-issue sweep's comment that names
each criterion's ID), the design and the base, before any fix. The drafting job saw nothing of a fix: it read no other
branch, no other worktree, no pull request and no commit after the base. Per AGENTS.md the implementing agent doesn't
edit these tests. A dispute goes to a blind redraft by this job.

**Read:** AGENTS.md. In `docs/technical-design.md`: How we know version 0 works (Criteria to tests, both ways; Closed
issues stay proven; Criteria in a checked shape; Wrong programs; Dogfooding; Built to be hard to get wrong), Fail
before, pass after, and Failing on an assertion. At the base: `packages/contracts` (`package.json`, `README.md`,
`tsconfig.json`, `src/generate.ts` and the files it reads through: `schemas.ts`, `slots.ts`, `lifecycle.ts`, `words.ts`,
`errors.ts`), the root `package.json`, `tsconfig.json` and `.gitignore`, `crates/deep-contracts` (`Cargo.toml`,
`README.md`, the head of `src/lib.rs`, `src/main.rs`, the lines of `src/generated.rs` the issue names), the root
`Cargo.toml` and `rust-toolchain.toml`, the proof lanes (`scripts/proof.mjs`, `proof-runs.mjs`, the head of
`proof-change.mjs`, `proof-reporter.mjs`, the test paths, unit lane and `alone`, `timed` and `slow` lists in
`lanes.mjs`, the head of `affected.mjs`), and for their shape `tests/acceptance/2201/`, `603/README.md`,
`349/twins.json` and the cargo lookup in `2009/helpers.ts`.

**Run:**

```sh
npm ci   # once, if node_modules is missing: the generator builds with the checkout's tsc
node --test tests/acceptance/2470/deep-contracts.test.mjs
```

Plain `node:test` and Node built-ins. Two tests, about ten seconds at the base: AC1's first check of the crate took 8 s
and later ones about 5 s, AC2 2 to 4 s; on the shared Mac under load the file took up to 34 s. It needs cargo with the
toolchain `rust-toolchain.toml` pins (on PATH, or rustup's proxies in `/opt/homebrew/opt/rustup/bin`, which the test
puts first when that folder exists), npm, and the checkout's `node_modules`. It runs from any working folder and finds
the checkout from its own place. It writes no file of the checkout: cargo writes only its build folder (`target/`, or
`CARGO_TARGET_DIR`), which git ignores, and `--locked` keeps `Cargo.lock` as it is; the generator runs on a temporary
copy, which the test removes.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, as the sweep's comment gives them. Both tests are in
`deep-contracts.test.mjs`, each title starting with its criterion's number and ID. The twins are in `twins/` (its
README), named for their criteria in `twins.json`.

| ID | Criterion | Test | Wrong programs it fails on |
|---|---|---|---|
| `#2470.16c0da75` | `cargo check --locked -p deep-contracts` passes on main | `AC1 #2470.16c0da75 …`: the issue's command, run in the checkout, exits 0 | The base: exit 101 with E0428 for `RULE_340` and `RULE_341` in `src/generated.rs` (lines 86396 and 86398, first defined at 84003 and 84005), `could not compile deep-contracts (lib)`. The twin `defined-twice`: exit 101 with the same E0428 pair in `src/bin/defined-twice.rs`, `could not compile deep-contracts (bin "defined-twice")` |
| `#2470.296a591a` | A second `npm run generate -w @deepbuild/contracts` leaves no diff | `AC2 #2470.296a591a …`: the issue's command, run on a copy of the checkout, exits 0 and leaves every file as the checkout holds it, adding and removing none | The base: the generate rewrites `crates/deep-contracts/src/generated.rs`, the one file it changes, first at line 86396, where the checkout's second `RULE_340` is the generator's `RULE_344`. The twin `slot-digest-by-hand`: it rewrites `packages/contracts/hub-slots.json` at line 6, the digest the twin edited by hand |

Each twin leaves the other criterion holding: on `defined-twice` AC2 passes, and on `slot-digest-by-hand` AC1 passes.
In the `before` lane, a merge base that still has the fault proves both tests there; a later one that holds both
criteria proves each on its twin.

## How the tests reach the code

- **AC1** runs `cargo check --locked -p deep-contracts` in the checkout as a child process and holds its exit code to 0.
  The message carries cargo's output, with the checkout's path cut out.
- **AC2** copies what the generator reads and writes into a temporary folder: the root `package.json` (npm finds the
  workspace through it) and `tsconfig.json` (the package's own extends it), `packages/contracts` and
  `crates/deep-contracts`, each without `node_modules`, `dist` or `target`, and links the checkout's `node_modules` in.
  It runs `npm run generate -w @deepbuild/contracts` there, then compares every file the copy holds with the checkout's,
  byte for byte, leaving out `node_modules`, `dist` and `target` as `.gitignore` does. The message names each file
  changed, added or removed, with the first line that differs and both versions of it.
- Nothing imports the code under test. A command that can't start or doesn't end within 30 minutes throws a `BLOCKED`
  error, never an assertion, and so does AC2 when the checkout has no `node_modules/.bin/tsc`: nothing was judged
  (AGENTS.md, invariant 2).

## Where the issue is silent, or differs from the base

1. **"On main"** is the checkout the test runs in, at whatever commit it holds.
2. **"Passes"** is cargo's exit code 0. A warning doesn't fail it: the issue's command has no `-D warnings`, and the lint
   lane's clippy holds warnings.
3. **"A second generate"**: the fix's own generate is the first, and the test's run is the second. **"Leaves no diff"**
   is the Proof's `git status` clean after it: no file changed, added or removed, but what `.gitignore` leaves out. The
   test doesn't run git. It compares the copy with the checkout, so it judges the files the checkout holds, committed or
   not.
4. **A copy, never the checkout.** The generator writes tracked files, and at the base it rewrites `generated.rs`. At
   the base, `src/generate.ts` and the modules it calls read only under `packages/contracts` and write there and to
   `crates/deep-contracts/src/generated.rs`, so the copy holds all of it. A later generator that writes into another
   folder fails on the copy, with its own error in the message; it can't pass there.
5. **"Any other generated output that is stale"** (Scope): AC2 compares every file the generator writes, not only
   `generated.rs`. At the base `generated.rs` is the only one a generate changes.
6. **"Regenerated, not edited by hand"** (Scope): no test can see how a file was made, so AC2 holds what a regeneration
   leaves: the committed outputs are the generator's own. At the base a generate changes six lines of `generated.rs`,
   one of which no compiler flags (`"workspace"` checked against `RULE_313`, where the generator writes `RULE_317`), so
   a hand edit that only renames the second `RULE_340` and `RULE_341` passes AC1 and still fails AC2.
7. **No line number, rule name or count of today's** is in the test file, so the tests read the same on a later main.
   The issue's line numbers match the base, as `BASE-FAILURE.txt` shows.

## Lanes

No `scripts/lanes.mjs` entry. Not `timed`: neither test reads a time or the machine's load, only exit codes and bytes.
Not `alone`: nothing starts a hub, takes a port or spawns a binary that a neighbour's build could rewrite; `cargo check`
writes check metadata, not binaries, behind cargo's own lock on the build folder, and the generate runs on a copy of its
own. Not `slow`: the file takes seconds, not two minutes. The unit lane doesn't pick the file up (its `node --test` takes
`tests/*.test.mjs` and vitest takes `.test.ts`), so it runs in the proof lanes, by hand, and when `affected.mjs`
selects it.

## What the drafting job ran, and what it did not

Ran, with Node 24.22.2, npm 11.19.1 and cargo 1.99.1, at `nice -n 10`, each run beside `scripts/proof-reporter.mjs` and
judged by a throwaway copy of `frames`, `asserted` and `atAssertion` from `scripts/proof-runs.mjs`:

- **At the base, in the checkout,** after `npm ci`: the Run command. 2 tests, 0 pass, 2 fail, each at its assertion in
  this file (`BASE-FAILURE.txt`). Afterwards `git status --short` showed only `tests/acceptance/2470/`, and no
  temporary copy was left.
- **On a fix of its own:** `npm run generate -w @deepbuild/contracts` once in the checkout at the base, which changed
  those six lines of `generated.rs` and nothing else. 2 pass. Then each twin laid over it by hand, its file copied to its
  path as the `before` lane lays a twin, and removed after:
  - `defined-twice`: AC1 fails at its assertion, `cargo check --locked -p deep-contracts fails in the checkout`, exit
    101 with `error[E0428]: the name RULE_340 is defined multiple times` at `src/bin/defined-twice.rs:5` and the same
    for `RULE_341` at line 7. AC2 passes.
  - `slot-digest-by-hand`: AC2 fails at its assertion, `a second npm run generate -w @deepbuild/contracts leaves a
    diff: 1 file no longer as the checkout holds it`, naming `packages/contracts/hub-slots.json` line 6, `...61a7c8` in
    the checkout and `...61a7c7` from the generate. AC1 passes.

  The fix was put back with `git checkout` and never committed.
- **The lanes' reading of the file:** `spans()` and `tagsWithImports()` from `scripts/proof-change.mjs` find both tests,
  unskipped, with their IDs, and `underTestPaths()` is false for both twins' files, so the lane may lay them.

Did not run: `scripts/proof.mjs` or any lane of it, so no lane has built and run the twins itself; `scripts/affected.mjs`,
the preflight, or any other suite. Runs went straight to the machine at low priority, not through
`scripts/throttle.mjs`.

## Files

- `deep-contracts.test.mjs`: the two tests and their helpers.
- `twins.json`, `twins/`: the planted wrong programs, and `twins/README.md`.
- `BASE-FAILURE.txt`: the run at the base, the checkout's path cut out.
