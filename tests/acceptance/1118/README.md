# Acceptance tests for #1118: proof copies run in bays, and npm ci runs only when the lock changed (T2)

These tests were drafted blind from issue #1118 (its text on 2026-11-04), `docs/parallel-proof.md` (sections 4, 5,
6, 10, 11 and 12), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `a2ea54a5`, which
holds T1's `scripts/bays.mjs` but no proof lane that uses it. At the base I also read `scripts/proof.mjs`,
`scripts/proof-runs.mjs` (`baseCheckout`, `changeCopy`, `prepareRuns`, the twins, `undoBuild`),
`scripts/proof-suites.mjs` (`crash`, `replay`), `scripts/proof-change.mjs` (`criterionId`, `listFiles`, `readIssue`),
`tests/proof.test.mjs`, `tests/acceptance/569/helpers.mjs` and `tests/acceptance/1117/`, whose fixture and sandbox
these follow. The helpers are written here and import nothing under test. Per AGENTS.md, the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/1118/*.test.mjs'
```

They need `git`, `npm`, `cargo` (found on `PATH`, or in `$CARGO_HOME/bin`, default `~/.cargo/bin`) and `sh`. They are
offline: the fixture has no crate dependency, its one npm package is a folder in the fixture (`file:vendor/vitest`),
and npm runs with `npm_config_offline=true`. All 8 run the real proof (`node scripts/proof.mjs before crash replay`)
on real processes, real bays, real cargo, real npm and real git; nothing under test is mocked. **Cost**: each test
makes two or three proof runs of the fixture (9 in all, the five tests of `run.test.mjs` sharing one pair of runs),
about 3 s each with bays and 7-10 s each at the base, where every use makes a cold copy and runs `npm ci`. The three
files run side by side; the suite takes 37-60 s on the Spark at the base (60 s with a cold cargo cache) and 15-26 s
with the planted implementation. On the base all 8 fail at their assertions, as `BASE-FAILURE.txt` shows.

**Every test points `HOME` at a temporary folder**, so bays are `<HOME>/deepbuild-bays/<k>/` and the throttle table
and log are `<HOME>/.deepbuild/throttle/`, never the real ones. `RUSTUP_HOME` and `CARGO_HOME` stay the machine's
(default `~/.rustup`, `~/.cargo`), so no toolchain is fetched into the sandbox. The sandbox unsets `DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `DEEP_BIN_DIR`, `DEEP_APPROVERS`, `NODE_TEST_CONTEXT`, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`,
the rustc wrappers and the `npm_*` variables an npm parent sets. Each proof a test starts gets its own process group;
a proof that outlasts 10 minutes is stopped by that group's PID, and the sandbox stops any group still alive when the
test ends.

## The surface (my choice where the issue leaves it open)

The issue names the proof lanes and their copies and no new command. The tests reach the code only as the CLI the
proof already is, run from the fixture's worktree with that worktree's own `scripts/` (a copy of this checkout's):

```sh
node scripts/proof.mjs before crash replay      # cwd: a worktree of the machine's repository
```

The three lanes are every lane that makes a copy without StrykerJS: the before lane (the merge base, the change and
each twin), crash and replay. Guard, trace and lifecycle make none, and mutation is left out for its cost.

- **The record** is the proof's stdout. **A use's record is a line `BAY <event> <one-line JSON object>`** whose event
  isn't `release` and whose object has `role` (`"base"` or `"change"`) and `bay` (an absolute path), printed by the
  proof or by `bays.mjs` under it. T1's `BAY claim {…}` lines have this shape; the event word is free (`claim`, `use`
  or another). A proof makes one such line per use: the before lane's base and change, each twin, crash, and replay's
  base and change. Keys the tests read:
  - `role` and `bay`. Every base use's line names one bay path and every change use's line another, both in one pair's
    folder `<HOME>/deepbuild-bays/<k>/` (`k` a grant index, 1 on the Mac, 1-3 elsewhere); and the probe of each use
    ran in that bay (below).
  - `use`, any JSON value naming the use. A line is crash's when its `use` mentions `crash`, replay's when it mentions
    `replay`, a twin's when it mentions `twin` or the twin's folder name, and else the before lane's. With `role`
    that gives the six uses.
  - `tree`, the git tree ID of the commit the use's files start from: `HEAD^{tree}` for the change, each twin and
    crash; the merge base's tree for the base uses (as T1's claim records it).
  - `overlay`, what the use lays over that tree. It must be non-empty (any string, list or object) for the before
    lane's base (the change's test paths), each twin (its files) and crash (main's test paths), and empty (absent,
    `null`, `""`, `[]` or `{}`) for both replay uses. The change's own use isn't checked.
  - For AC4, any string in the change's before-lane record that contains the untracked test's path
    (`tests/acceptance/9118/u.test.mjs`), as an `untracked` list would.
  - For AC3's Rust case, the crate each use rebuilt: any string in that use's record equal to the crate's name
    (`greet`), to `crates/greet`, or starting with `crates/greet/` (a list of crates, or of written files).
  Other keys (`index`, the bundle and untracked hashes, `seal`, `cold`, `installed`, counts) may be there; no test reads
  them.
- **The wall-time reading (AC5)** is the first stdout line containing `wall` (any case) followed by a number: in
  seconds, or in ms when `ms` follows the number or stands between `wall` and it (`wall time 4.2 s`, `"wallMs":4200`).
- **`npm ci`** is counted by a shim: the sandbox's `PATH` starts with a folder holding an `npm` script that appends
  its working folder (`pwd -P`) and arguments to a log, then runs the real npm. A proof's `npm ci` count is the log's
  lines whose arguments start with `ci`, from the proof's start to its end. So the proof and what it runs must find
  npm on `PATH`, as the base does (`spawnSync('npm', …)`).
- **"Compiles 0 crates"** is read from cargo's own output in each use: every `compiler-artifact` message
  `fresh: true` (at least 2: the lib and the bin) and no `Compiling` line on stderr. A crate "rebuilt" is a
  `compiler-artifact` message `fresh: false`, by target name.

### The machine's repository

As in #1117's suite, the fixture meets every reading of "a proof rooted in a worktree of the machine's repository" at
once: it is `<HOME>/deepbuild`, holding a copy of this checkout's `scripts/` (so `bays.mjs` runs from its own
repository), with `origin` at `https://github.com/windoliver/deepbuild.git` (set, never fetched) and
`refs/remotes/origin/main` pinned at the merge base by `update-ref`; the proof's root is a linked worktree made by
`git worktree add`, `<HOME>/deepbuild/.claude/worktrees/w`. `node_modules` there links to this checkout's, for
`typescript`. A scene repository from a plain `git init` is not such a worktree and keeps temporary copies (T1).

### The fixture and the probe

The merge base: a two-crate cargo workspace (`word`, a lib holding `WORD`; `greet`, a binary printing it, which nothing
depends on), a `package.json` and lock whose one package is `vitest`, the folder `vendor/vitest` (a stand-in that runs
the probe and writes a report of one passing test per file, so crash passes), the verdict engine `packages/verdicts`
(its entry runs the probe as it loads, then exports a `verdict`), `packages/p/index.mjs` (exports `p = 1`), the storage code `packages/record/src/store.ts`,
main's crash suite `tests/acceptance/16/crash.test.ts`, one seeded case `tests/fixtures/false-done/one.json`, and
`tests/helpers/main-only.mjs`.

The change, one commit naming the planted issue #9118 (its text in `DEEP_PROOF_ISSUES`): it edits `store.ts` (so crash
runs), the verdict engine (so replay runs) and the crash suite, deletes `tests/helpers/main-only.mjs`, adds
`tests/helpers/change-only.mjs`, the tagged test `tests/acceptance/9118/a.test.mjs` and its twin; and leaves
`tests/acceptance/9118/u.test.mjs`, a second tagged test, untracked. The tagged test runs the probe with a cargo build
and asserts the binary prints `hello` and `packages/p` exports 1; it passes on the merge base and the change, so the
twin runs, and fails on the twin. The twin touches no Rust (`js-twin` rewrites `packages/p/index.mjs`) in `run.test.mjs`
and `lock.test.mjs`, and only the greet crate (`rust-twin` rewrites `crates/greet/src/main.rs`) in `rust.test.mjs`.
Tags are built at run time from the planted criteria's text, so no file here carries a #9118 tag.

The probe (`<sandbox>/probe.mjs`, named by `BAY_PROBE`, writing to `BAY_PROBE_OUT`, both handed down in the proof's
environment) runs in each use's copy: it hashes every file outside `.git`, `target` and `node_modules`, and with a
build runs `cargo build --workspace --all-targets --offline --locked --message-format=json` and `target/debug/greet`.
It writes what it saw outside every copy and prints only the binary's output, as one JSON line. The tests tell the uses apart by who ran the probe
(the tagged test, the stand-in vitest under crash, the engine under replay) and by what the copy held (`store.ts`'s
bytes give the side, the twin's file the twin), never by the record, which is then checked against them.

## Criteria to tests

Each criterion's ID is `#1118.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out; I checked each by running that function's
line on the issue's text. Each test carries its tag at the start of its name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1118.5a7b1fc3` `npm ci` per proof run is 0 without a lock change and 1 when the change edits the lock, plus 1 in the base bay only when the merge base moved past a lock change | `run.test.mjs` | The second proof of the same tree runs `npm ci` 0 times, though all six uses ran their probe, in two bays of one pair |
| | `lock.test.mjs` (lock edit) | After a warming proof, the worktree commits a lock edit (`package.json` and lock, version 0.0.1); the next proof runs `npm ci` exactly once, in the change bay |
| | `lock.test.mjs` (base moved) | The change edits the lock; after a warming proof, main moves past a commit that leaves the lock alone and the worktree merges it: 0 `npm ci`. Then main lands the same lock bytes and the worktree merges them: exactly 1, in the base bay |
| AC2 `#1118.dc689388` Crash's overlay files and the before lane's base overlays are absent from the bays when replay runs, and each use's recipe is in the record | `run.test.mjs` | In both proofs: what replay's engine saw on each side is exactly the merge base's files and exactly the change's (worktree, untracked test included), byte for byte; every other use held exactly its recipe too; and each of the six uses has a record with its role's one bay, its `tree`, and an `overlay` non-empty for the base, the twin and crash, empty for replay |
| AC3 `#1118.1f06c2df` A second proof of the same tree, with `origin/main` pinned and an input whose twins, crash overlay and before-lane base overlay touch no Rust, compiles 0 crates in both bays; when they touch Rust, only the crates they touch rebuild, named in the record | `run.test.mjs` | In the second proof (no Rust touched) every use's build is all fresh, with no `Compiling` line, and prints `hello`; both proofs used the same two bays |
| | `rust.test.mjs` | The twin rewrites greet's `main.rs`. In the second proof no use compiles `word`, the base uses compile nothing, the twin use compiles exactly `greet` and prints `HELLO`, and every use that compiled a crate names it in its record; both proofs used the same two bays |
| AC4 `#1118.4cb77839` An untracked tagged test in the worktree is present in the change bay and named in the record | `run.test.mjs` | In both proofs: the change's before-lane record names `tests/acceptance/9118/u.test.mjs`, the change bay holds it with the worktree's bytes, and it ran there |
| AC5 `#1118.e7117f8d` Proof wall time before and after on the same commit is a reading | `run.test.mjs` | Each of the two proofs of the same commit prints a wall-time reading, more than 0 and no more than the run's wall time as the test measured it, plus 1 s. No threshold |

## Readings where the issue leaves a choice

- **"Per proof run" and the warm-up.** A first proof in a new pair installs both bays (they are empty), so AC1 counts
  only proofs after a warming one in the same pair. "1 when the change edits the lock" is read as the first proof
  after the change's lock bytes changed; a second proof of that same lock isn't counted either way, nor is the first,
  cold proof.
- **"Moved past a lock change"** is read as `origin/main` moving to a commit whose lock differs and the change taking
  it in by a merge. To isolate the base bay's install, main lands the lock bytes the change already held, so the change
  bay's lock never changes; "only when" is the merge of a commit that leaves the lock alone, before it.
- **What each use's recipe is.** The before lane's base: the merge base's files with the change's files under the test
  paths laid over them (all under `tests/` in this fixture), as the base lays them. The change: the worktree as
  `listFiles` reads it. A twin: the change with the twin's file at its path. Crash: the change with main's files under
  the test paths laid over it. Replay: the merge base alone and the change alone. "Absent when replay runs" is checked
  as replay's two copies holding exactly their trees: no file of the change's tests in the base bay, no
  `tests/helpers/main-only.mjs` in the change bay, and the crash suite with each side's bytes.
- **"Touch Rust" and "the crates they touch".** A twin, the crash overlay or the base overlay touches a crate when it
  lays a file under `crates/<name>/` with other bytes. The fixture's Rust twin touches greet, which no crate depends
  on, so "only the crates they touch rebuild" is exact: word must stay fresh everywhere. The change bay may rebuild
  greet in the uses after the twin (crash, which puts the change's `main.rs` back), and each use that rebuilds a crate
  names it; the base bay rebuilds nothing.
- **"Compiles 0 crates in both bays"** is read from the builds the proof's own uses run in the bays (here, the probe in
  each use), not from a build the proof would add.
- **"Named in the record" (AC4)** is any string of the change's before-lane record holding the untracked test's path.
- **"Proof wall time before and after on the same commit"**: before and after T2 is a reading for the PR's evidence;
  what a test can hold is that the proof prints its own wall time on each run of one commit.
- **Not tested** (scope, not criteria): the record naming the bay's seal check (T1's `seal` key), the
  `packages/*/dist` deletion, Stryker's relink walk skipped in a bay (`runs.bay`; the mutation lane isn't run), the
  guard's approval tag for the guarded files, and how the pair is claimed (once per proof or per lane).

## Files

- `helpers.mjs`: the sandbox and its npm shim, the fixture (the machine's repository and its worktree, main moving),
  the probe, running the proof, the record readers, the recipes, and telling uses apart.
- `run.test.mjs`: AC1 (no lock change), AC2, AC3 (no Rust), AC4 and AC5, on one pair of proofs.
- `lock.test.mjs`: AC1's two lock cases.
- `rust.test.mjs`: AC3 when the twin touches Rust.
- `twins.json`, `twins/README.md`: the planted wrong programs, to be laid down once an implementation exists.
- `BASE-FAILURE.txt`: the run on the base, and the planted implementation and wrong programs checked against the tests.

No fixture holds a secret or personal data.
