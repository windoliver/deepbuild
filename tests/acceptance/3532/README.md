# Acceptance tests for #3532: a lint-lane check holds the kit ledger to the tree's own digests

Issue #3532: "A release canvas core can refuse its own seal and no lane sees it: at aafef3131 the kit ledger held scene3d at another digest". A check in the lint lane holds the committed `crates/deep-show/kit-ledger.json` to every shipped canvas module's digest as the tree's own seal gives it, read from a debug build's `kinds --dump`, and names the module, the ledger's digest and the tree's.

Written first, blind, on November 27, 2026, at the base `d303e2b64` (origin/main, whose last merge is #3643), by a job that never saw an implementation; none existed. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job (design: Dogfooding). Lean, per the owner's rule: one test a criterion.

**Open for an owner ruling: criterion 1's "its parent passes" can't hold on this history** (Readings, 3). aafef3131's first parent 292673fc5 doesn't compile, and once repaired it holds scene3d at the same stale digest as aafef3131. The suite tests the criterion's control on aafef3131's own tree, with its ledger written again for scene3d as #3388 wrote it.

## What was read

- The issue as it read on November 27, 2026: its opening paragraph, Scope, three acceptance criteria, `Runs on:` and Proof lines. It had no comments.
- The design section it links, Built to be hard to get wrong (`node scripts/design-section.mjs --issue 3532`), for the layers and the lint lane's repo guards (the wait ratchet, home paths in run records).
- The interface fixed before the work, given with the brief: the check is `node scripts/kit-ledger.mjs [--root <tree>]`, in the lint lane of `scripts/lanes.mjs`. It builds the tree's debug `deep-show` (`cargo build --locked --bin deep-show` in `<tree>`, `CARGO_TARGET_DIR` honored as cargo does), reads each canvas module's digest from the header `modules[]` rows of `deep-show kinds --dump <dir>`, and compares them with `<tree>/crates/deep-show/kit-ledger.json`. It prints `PASS kit ledger: …`, one `FAIL kit ledger: <module>: …` line per finding, or `BLOCKED kit ledger: …`, and exits 0, 1 or 3. The brief named "its parent" as aafef3131's first parent, 292673fc5.
- At the base: `crates/deep-show/src/kit/ledger.rs` (the release seal's rule, and `kit_of`, which gives each dump row's `kit.digest`), `crates/deep-show/build.rs` (the embedded ledger, rebuilt when the ledger changes), `crates/deep-show/src/kinds.rs` (`--dump`, `module_row`), `SealedModule` in `crates/deep-canvas/src/registry/mod.rs` (a module's digest hashes its registered shapes), and the ledgers and history around aafef3131. Also `scripts/lanes.mjs`, `scripts/lease`, `scripts/throttle.mjs`'s no-grant lines, `scripts/wait-ratchet.mjs`, `scripts/benchmark.mjs` (`judgeLimit`'s load rule), `scripts/proof-change.mjs` (`criterionId`) and `scripts/proof-runs.mjs` (twins, failing at an assertion), and suites 3422, 3612 and 3256 for the house shape.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `kit-ledger.test.mjs` | `#3532.400b035d`, `#3532.4bbb848d`, `#3532.ed1562fc` | the lint lane's command for the check, timed once on aafef3131's built tree; the check on that tree as committed and with its ledger written again for scene3d; the check on that tree with two verdicts planted in its ledger |
| `lane.json` | | alone, for timing: the suite times the check, and it builds deep-show in a kept tree whose ledger it plants |
| `BASE-FAILURE.txt` | | the suite's run on the base |

## Run

```sh
node --test tests/acceptance/3532/kit-ledger.test.mjs
```

Plain `node:test` and Node built-ins, Node 24, with git, a checkout whose history holds aafef3131, cargo with the workspace's dependencies fetched (the builds are `--locked`), `sh`, `tar` and `/usr/bin/time`. The three tests run in order in one file. The budget goes first, on the committed ledger, so a run rebuilds only deep-show's crate for each of the two plants.

- **The tree.** aafef3131's tree is exported once with `git archive <sha> | tar -x` into `<tmp>/deep-3532/trees/aafef3131` (`<tmp>` is the system's temporary folder, realpathed). An `aafef3131.exported` marker sits beside it, and the tree is kept between runs. No `.git` goes with it. git's `GIT_*` variables are removed from every process the suite starts.
- **The build.** Every run of the check gets `CARGO_TARGET_DIR=<tmp>/deep-3532/target`, kept between runs. `git archive` gives every file its commit's time, so a tree exported again at the same path is fresh to cargo. The first run builds deep-show's debug binary. On this Mac at a load of about 60, a first build with its dependencies took 2 h 8 min, and a second tree sharing them took 15 min. Each ledger plant reruns deep-show's build script, which embeds the ledger, and rebuilds that crate. So does a run's first look after the committed ledger is put back.
- **PATH.** Every process gets `/opt/homebrew/opt/rustup/bin` at the front of PATH. In a non-interactive shell on the Macs here cargo isn't on PATH otherwise, and the throttle ends `BLOCKED throttle: cargo could not start`. Where the folder doesn't exist it changes nothing.
- **The lease.** Each run of the check goes through `scripts/lease`, so its build waits for a throttle grant. A run the throttle gives no grant (`INCONCLUSIVE no grant`, `BLOCKED throttle`) throws `INCONCLUSIVE: …`: the check never started.
- Nothing is written in the checkout. Each plant in `<tmp>/deep-3532/trees/aafef3131/crates/deep-show/kit-ledger.json` is put back byte for byte in `t.after`.

## Criteria and tests

Each ID is `#3532.` and the first 8 hex digits of the SHA-256 of the criterion's text from the issue, trimmed, with white space collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with its ID.

| ID | Criterion | Test | On the base |
|---|---|---|---|
| `#3532.4bbb848d` | On a tree whose `scene3d` shapes changed and whose ledger wasn't written again, the check fails, naming `scene3d` and both digests. `aafef3131` is such a tree and fails; its parent passes | *on aafef3131, whose ledger wasn't written again after scene3d's shapes changed, the check fails naming scene3d with the ledger's digest and the tree's; with the ledger written again for scene3d it passes* | fails |
| `#3532.ed1562fc` | A ledger that holds a module at the tree's digest with a verdict other than PASS fails, naming the module and the verdict | *a ledger that holds marks2d and look at aafef3131's own digests with the verdicts FAIL and INCONCLUSIVE fails, naming each module and its verdict* | fails |
| `#3532.400b035d` | Budget: the check adds under 5 s to the lint lane on a built tree (drafted) | *on a built tree, aafef3131, the lint lane's kit ledger command takes under 5 s, one reading recorded with the load* | fails |

## Expected values

These were read outside the check, which doesn't exist at the base, by this job on November 27, 2026. Each tree was exported as above, built with `cargo build --locked --bin deep-show` under `scripts/lease` into the shared target folder, and dumped with its debug `deep-show kinds --dump <dir>`. Each header `modules[]` row's `kit.digest` was read beside the tree's ledger record.

- **aafef3131.** 21 modules in the dump, module set `6fbc9ba1…`. 20 match the ledger, all PASS. `scene3d` doesn't: the tree gives `919d7004d7721fa4bad7f9cc7ea22474d9f72e0d9cc3ad8b9f3de0b87647b793` and the ledger holds `683377360bf94ea1a0bf34a1047052495d2fd83f0f1a72eb00eb6fce21e8fab7`, PASS. The ledger's `core` record has no dump row: the core's shapes are no module's (`registry/mod.rs`). The dump took 5.5 s on the built tree.
- **#3388's merge, 2062d474f,** wrote the ledger again 23 minutes later. Against aafef3131's ledger it moved `scene3d` to `919d7004…b793`, the digest above, along with `media` and `core`, whose trees had moved by then. So `919d7004…b793` is the tree's digest by two readings.
- **292673fc5, aafef3131's first parent,** doesn't compile (Readings, 3). With the one-line repair aafef3131 makes, it dumps the same module set, `6fbc9ba1…`, digest for digest, `scene3d` at `919d7004…b793` included, beside the same ledger. No canvas module's source differs between the two trees: `git diff 292673fc5 aafef3131` touches neither `crates/deep-canvas-scene3d` nor `crates/deep-canvas`.

## Readings where the issue leaves a choice

1. **"Fails" and "passes".** A pass is exit 0, a `PASS kit ledger:` line and no line in another state. A failure is exit 1 with one `FAIL kit ledger: <module>: …` line for each module the tree gets wrong and none for any other, and no `PASS` or `BLOCKED` line beside them. A check that fails every tree, or names modules whose digest didn't move, fails the test.
2. **"Naming `scene3d` and both digests".** The text after `FAIL kit ledger: scene3d:` holds both digests whole, 64 hex digits each, in either order: the ledger's `683377…8fab7` and the tree's `919d70…7b793`. A shortened digest doesn't count: two digests that share a prefix would read as one.
3. **"Its parent passes" (the dispute).** The criterion's parent is the control: a tree like aafef3131 whose ledger is right, which the check must pass, so that a check that fails everything fails the criterion. On this history no parent of aafef3131 can be that control:
   - **The first parent, 292673fc5, doesn't compile.** In `crates/deep-scene3d-render/src/module.rs`, `draw_offscreen` holds `mut post`. `draw_offscreen_texture` calls `post.as_mut()` but holds plain `post`, so `cargo build --locked --bin deep-show` stops at E0596. That function came in with #3392's merge (8f64ca337), and aafef3131's merge moves the `mut`, the only change it makes to that file. As committed, the check can only be `BLOCKED` there.
   - **Repaired, it fails on scene3d too.** With that move laid on it, the first parent holds scene3d at the same stale digest as aafef3131 (Expected values). The shape change came before #3394, by one of #3301, #3244 or #3369, which touched `crates/deep-canvas-scene3d` after #3286 last wrote the ledger. aafef3131 was the first tree after #3392's merge that compiled, so a release build there was the first that could refuse its seal.
   - **The second parent, 34bed4c51** (#3394's branch merged with main), holds #3392's merge as well. This job didn't build it.

   So the test takes the control the criterion stands for: aafef3131's tree with its ledger written again for scene3d alone, its record's `digest` set to the tree's `919d70…7b793`, as #3388 wrote it, nothing else moved. It must pass. This keeps the criterion's two halves, a stale tree failing and a right one passing, on the trees the issue names. Whether the issue's parent clause should be rewritten, or the control taken from another commit, is the owner's ruling. If the ruling names another tree, the blind redraft swaps the control.
4. **Criterion 2's ledger.** aafef3131's ledger written again for scene3d (reading 3), with two more records' `verdict` changed and nothing else, so each stays at the tree's digest: `marks2d` to `FAIL` and `look` to `INCONCLUSIVE`, two of the five verdicts. Each finding's text after `FAIL kit ledger: <module>:` must hold its verdict as a word. One of the two verdicts isn't `FAIL`, so a line can't name its verdict by its own state word alone. The test first asserts both records were PASS and scene3d was at its old digest, the fixture's own checks.
5. **"Adds under 5 s to the lint lane on a built tree".** The lint lane in `scripts/lanes.mjs`'s exported `checks` must hold the command `[process.execPath, 'scripts/kit-ledger.mjs']`, with no arguments, as the brief fixes it. The test runs it from this checkout with `--root` and aafef3131's tree. What the check adds to the lane is its own run, so the reading is that run's wall time. A warm-up run of the same command first makes sure the tree is built. Then one run under `/usr/bin/time -p` gives the reading, its `real` line, inside the lease, so a wait for a grant isn't counted. The time comes from that tool, not from two clock reads in the test, which the wait ratchet would count as a fixed wait. Per AGENTS.md it is one reading, taken without waiting for a quiet machine and recorded with the 1-minute load (`t.diagnostic`). Under 5 s passes. 5 s or more fails at a load within the cores. Above the cores it is `INCONCLUSIVE: …` (the load rule of `judgeLimit` in `scripts/benchmark.mjs`), never a pass. Both runs must give the tree's verdict, its one scene3d finding (reading 1), so a reading of a check that blocked or found the wrong thing counts for nothing.
6. **BLOCKED.** The brief gives `BLOCKED kit ledger:` with exit 3 for a tree that can't be built or dumped. No criterion names it, so no test plants one. A BLOCKED line in any run here fails its test.

## On the base

All three tests fail at their assertions, as `BASE-FAILURE.txt` shows. `scripts/kit-ledger.mjs` doesn't exist, so node exits 1 with no `kit ledger` line (criteria 1 and 2), and the lint lane holds no such command (criterion 3). A failure at the base is each test's wrong program, so the suite has no planted twins and no `twins.json`: a twin replaces code the change adds, and none exists yet.

## Not covered here

- The check's output on main's head and on 292673fc5, which the issue's Proof names. Whether main's head passes isn't a criterion, and the tree moves with every merge. 292673fc5 can only be BLOCKED (Readings, 3). Both are the PR's proof to show.
- A tree that can't be built or dumped (`BLOCKED`, exit 3). `CARGO_TARGET_DIR` is honored only as far as the suite's runs finding the build fresh shows it.
- The issue's out-of-scope items: running the kit, and a release build in a lane.
