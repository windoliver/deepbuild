# Acceptance tests for #3019: proof bays reuse a build of the same tree

These tests were drafted blind from issue #3019 (its text on 2026-11-21), AGENTS.md (Proof), `docs/technical-design.md`
(Dogfooding, "Built to be hard to get wrong"), `docs/parallel-proof.md` (bays) and the base commit `512d194bb`, which
has no build cache. At the base I also read `scripts/proof.mjs`, `scripts/proof-runs.mjs` (`prepareRuns`,
`baseCheckout`, `changeCopy`, `inBay`, `build`, `runTests`, `before`), `scripts/bays.mjs` (`claimPair`, `Pair.use`,
`replace`, the `BAY claim` / `BAY release` lines, the seal), `scripts/proof-binaries.mjs`, `scripts/throttle.mjs`
(the table's folder in a test run), `scripts/proof-change.mjs` (`criterionId`, `readIssue`) and the earlier blind suites
`tests/acceptance/1117/`, `1118/` and `1119/`. This suite's fixture and sandbox follow theirs. The helpers are written
here and import nothing under test. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to
a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/3019/*.test.mjs'
```

They need `git`, `npm` and `sh`, and for the toolchain test a second node install (below). They are offline: the
fixture's lock links only its own workspace package, and npm runs with `npm_config_offline=true`. There is no cargo
crate. All 7 tests run the real proof (`node scripts/proof.mjs before`) on real processes, real bays, real npm and
real git. Nothing under test is mocked. **Cost**: 17 proof runs of the fixture (2 for AC1, 3 for each of AC2's three
tests, 2 for AC3, 3 for AC4, 2 for AC5). On the Mac at load 120-210, each run took 11-19 s on the base. The five files run side by side, so the suite took
about 2 minutes on the base and 3 minutes with a planted cache (`BASE-FAILURE.txt` has the times and loads). The
suite hasn't been run on the Spark: it couldn't be reached from here.

**Every test points `HOME` at a temporary folder.** Bays are `<HOME>/deepbuild-bays/<k>/`, the cache is
`<HOME>/deepbuild-bays/cache/`, and the throttle table is `<HOME>/.deepbuild/throttle/`, never the real ones. Inside a
`node --test` run, `throttle.mjs` takes its table from HOME. The sandbox unsets `DEEP_THROTTLE`, `DEEP_THROTTLE_TABLE`,
`DEEP_THROTTLE_READINGS`, `DEEP_PERF_LOCK`, `DEEP_BIN_DIR`, `DEEP_APPROVERS`, `NODE_TEST_CONTEXT`, the cargo target
variables, `DEEP_BUILD_CACHE_BYTES`, the fixture's own variables and the `npm_*` variables an npm parent sets. Each proof
gets its own process group. A proof that outlasts 15 minutes is stopped by that group's PID, and the sandbox stops any
group still alive when the test ends. No real cache, bay or table is read or written.

## The surface (my choice where the issue leaves it open)

The issue names the before lane and its bays and no new command. The tests reach the code only through the CLI the
proof already is. They run it from a fixture worktree with that worktree's own `scripts/` (a copy of this checkout's):

```sh
node scripts/proof.mjs before          # cwd: a worktree of the machine's repository
```

What the implementation must provide, and all the tests read of it:

1. **A `BUILD` line for each build a bay would run.** This is one stdout line `BUILD <one-line JSON object>`, printed
   by the proof or by `bays.mjs` under it, wherever `inBay` would run the workspace build. The before lane runs one
   for the base, one for the change and one per twin. Keys the tests read:
   - `role`: `"base"` or `"change"`, the bay's role, as in `BAY claim`.
   - `tree`: the git tree hash (40 hex digits) of the tree built. For the base, this is the merge base's tree,
     `git rev-parse <merge-base>^{tree}`, the same value `BAY claim` prints as `tree` for the base. For other uses the
     tests don't read it.
   - `reused`: `true` when the bay took the build from the cache and didn't run it, `false` when it built fresh.
   - `why`: when `reused` is `false`, a string saying why. When a matching entry was refused because its stored files
     changed (AC3), it contains the word `changed`, for example
     `"the cached build's files changed after it was stored (packages/w/dist/index.mjs)"`.

   Other keys (`use`, `key`, sizes) may be there. No test reads them. Example:
   `BUILD {"role":"base","use":"before","tree":"e926…0181","reused":true}`.
   The prefix is `BUILD`, not `BAY …`. #1118's readers take every non-release `BAY <event> {…}` line that has a
   `role` and a `bay` as a use of a bay, so a `BAY build` line could disturb those tests.
2. **The cache lives in `<HOME>/deepbuild-bays/cache/`**, where `HOME` is the proof's `homedir()` (the folder bays.mjs
   already puts the bays in). A stored build keeps the files the build wrote as plain, uncompressed files of their
   own somewhere under that folder, with the same bytes. Here that is the package's `dist/index.mjs` and
   `dist/blob.bin`. The tests find a stored build by those bytes, so a tar, a compressed store or a content store that
   splits files would hide it from them. The layout under the folder (entry folders, names, metadata) is free.
3. **The ceiling is `DEEP_BUILD_CACHE_BYTES`**, in bytes, read from the proof's environment. The cache's disk use is
   the sum of the sizes (`st_size`) of the regular files under the cache folder, each inode once. After a run it is
   at or under the ceiling. When storing a build would take it over, the oldest entries are removed first until it
   fits. With `0`, nothing is reused and nothing stays stored, though entries from earlier runs with another ceiling
   are there when the run starts. The ceiling holds whenever the cache is read, not only when it is written. The
   tests use `0` as "no cache at all" and check it: such a run prints no `BUILD` line with `reused` `true` and builds
   the merge-base tree itself. With the
   variable unset the ceiling is the implementation's default, which must hold a few MiB (the fixture's builds outside
   AC5 are about 1 KiB each).
4. **Tampering is done by the test itself.** After a first run, every regular file under the cache folder whose bytes
   equal the merge base's built `packages/w/dist/index.mjs` is rewritten in place (`writeFileSync`, same path, same
   length) with `value = 1` changed to `value = 2`. A run that used it would make C1 pass on the merge base.

How "built" is counted: the fixture's build is `npm run build --workspaces --if-present`, which the base's `build()`
already runs in each bay. Its one package's build script appends one JSON line per run of itself to
`$FIXTURE_BUILD_LOG`, a file outside every bay and the cache. Each proof run gets a log of its own. A line names the
build's *marker*, a SHA-256 of the package's `src/` files, so the test counts builds of each tree from the log and
never infers them. A reused build runs no script, so it writes no line. The environment reaches the build as the base
passes it (`childEnv` into `npm`).

How verdicts are compared: a run's verdict lines are its stdout lines `<STATE> before: …` and its plain `before: …`
notes, in order, compared as text. The fixture's right verdicts, which the run with no cache gives on the base and on
a right program, are:

```
PASS before: tests/acceptance/9301/a.test.mjs › #9301.<C1> the built value is two: failed on the merge base at its assertion
PASS before: tests/acceptance/9301/a.test.mjs › #9301.<C2> the built label is w: failed on wrong-label at its assertion
```

### The fixture

As in #1118's suite, the fixture is "a proof rooted in a worktree of the machine's repository". The repository is
`<HOME>/deepbuild`. It holds a copy of this checkout's `scripts/` and has `origin` at
`https://github.com/windoliver/deepbuild.git` (set, never fetched), with `refs/remotes/origin/main` pinned by
`update-ref`. Its `node_modules` links to this checkout's, for `typescript`. The proof's root is a linked worktree,
`<HOME>/deepbuild/.claude/worktrees/w` (AC1 adds `w2`).

The merge base is an npm workspace with one package. Its `package.json` and lock link `packages/w` and nothing else.
`packages/w/build.mjs` hashes `src/` into the marker and writes `dist/index.mjs`, which is `src/value.mjs` plus
`export const marker`. It also writes `dist/blob.bin`, `$FIXTURE_BLOB_BYTES` bytes of the marker repeated (1024 by
default). `src/value.mjs` is `value = 1, label = 'w'`, and `src/note.txt` is a file main edits when it moves.
`dist/` is ignored.

The change is one commit naming the planted issue #9301, whose text is in `DEEP_PROOF_ISSUES`. It sets `value = 2`
and adds `tests/acceptance/9301/a.test.mjs`, two tagged tests that import the built `dist/index.mjs`:
- C1 asserts `value === 2`. It fails on the merge base at its assertion.
- C2 asserts `label === 'w'`. It passes on the merge base, so the before lane runs its twin. That twin is
  `tests/acceptance/9301/twins/wrong-label/packages/w/src/value.mjs`, with label `x`, named in that folder's
  `twins.json`. C2 fails there at its assertion.

Every bay therefore builds: the base, the change and the twin, which is laid before its build, as the base lane
already does. A wrong build served to any of them changes a verdict.
Tags of #9301 are built at run time from the planted criteria's text, so no file here carries one.

## Criteria to tests

Each criterion's ID is `#3019.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`. I computed each by running `criterionId`'s line from `scripts/proof-change.mjs` on the issue's text.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#3019.52ff5ba5` Two `before` runs at the same merge base build the merge-base tree once; the second run's log says it reused the build, naming the tree hash | `reuse.test.mjs` | Worktree `w` runs, then worktree `w2` (another change at the same merge base) runs, in one HOME. The build log shows the merge-base tree built exactly once in all, in the first run. The second run prints `BUILD` with `role` `base`, `reused` `true` and `tree` equal to the merge base's tree hash. Its verdicts equal the first's |
| AC2 `#3019.abf36a2d` A run whose merge base, toolchain or lockfile differs from every cached build builds fresh, with the verdicts of no cache | `fresh.test.mjs` (merge base) | A first run fills the cache. Main then edits `packages/w/src/note.txt` and the worktree merges it. The next run builds the new merge-base tree once, and its verdicts equal those of the same state run with `DEEP_BUILD_CACHE_BYTES=0`, which are the right ones. That run reuses nothing and builds the merge-base tree once |
| | `fresh.test.mjs` (toolchain) | The same, but nothing in the repository changes. The second and third runs use another node install, both as the proof's node and first on `PATH`, so npm and the build run under it too |
| | `fresh.test.mjs` (lockfile) | The same, after main edits only `package.json` and `package-lock.json` (version 0.0.1) and the worktree merges it |
| AC3 `#3019.117a4707` A cached build whose files changed after it was stored is not used; the run builds fresh and says why | `tamper.test.mjs` | After a first run the cache holds the merge base's built `dist/index.mjs` (at least one file with its bytes), and the test tampers with those files. The next run builds the merge-base tree once. It prints `BUILD` for the base tree with `reused` `false` and a `why` containing `changed`, and its verdicts equal the first run's |
| AC4 `#3019.a73b4639` Verdicts with the cache match verdicts without it for the same change, on a change with at least one twin | `verdicts.test.mjs` | Three runs of the same change: one that fills an empty cache, one that reuses it, and one with `DEEP_BUILD_CACHE_BYTES=0`. The no-cache run reuses nothing and builds the merge-base tree once. Its verdicts are the right ones, and both cached runs' verdicts equal them. The reusing run built the merge-base tree 0 times and printed a reused `BUILD` line for it, so it really ran with the cache |
| AC5 `#3019.2e0b1f52` The cache's disk use has a ceiling, and the oldest entries go first once it's reached | `ceiling.test.mjs` | Every build writes a 16 MiB blob of its own bytes, and the ceiling is 60 MiB: room for three builds, never four. After the first run the cache's disk use is at most 60 MiB and it holds the three builds (base, change, twin). Main then moves, and the second run makes three builds of other trees. Afterwards the disk use is at most 60 MiB, the second run's three builds are held, and none of the first run's three is |

## Readings where the issue leaves a choice

- **"The merge-base tree"** is the tree the base bay builds: the merge base as `git archive` gives it. The base lane
  lays the change's test paths over the base bay only after the build, so they aren't part of the built tree. Its
  "tree hash" is the git tree ID that `BAY claim` already prints as `tree`.
- **"On one machine"** is one HOME, so one bays folder and one throttle table. The two AC1 runs are of two worktrees
  with different changes, so a cache kept per worktree or per change wouldn't pass. On the Mac both runs get the one
  bay pair. The suite can't force the second run onto another pair, so a cache kept per pair isn't ruled out.
- **"Toolchain"** is read as at least the node that runs the proof and the build, and the npm it finds. The test runs
  with another installed node version, which changes `process.version`, `node --version` on `PATH` and the bundled
  npm. A key that reads any of them passes. The test looks for another version beside the running node (nvm's
  `versions/node/<v>/bin/node`, same major first, at least 22). On a machine with none it is **skipped**, which the
  before lane reports as INCONCLUSIVE, never as a pass. On this Mac it ran with v24.14.0 beside v24.22.0. Rust's
  toolchain isn't tested, because the fixture has no crate.
- **"Lockfile differs"** while the tree hash is part of the key can only be told apart by a key that leaves the
  lockfile out. The lockfile test changes only the root `package.json` and lock, so a key that covers only the build's
  sources (`packages-only-key`) fails it.
- **"Verdicts with the cache … without it"**: "without it" is a run with `DEEP_BUILD_CACHE_BYTES=0`, the ceiling that
  holds nothing, in the same HOME and state. A fresh HOME would still let a twin be served the change's build within
  one run. "With the cache" counts only when the run used it (the reused base build).
- **"Says why"** is the `why` of the base's `BUILD` line, which must contain `changed`. The test doesn't require the
  why to name the file.
- **"Oldest"** is the time an entry was stored. AC5's second run reuses nothing (every key changed), so storage order
  and last use agree, and the test holds under either reading.
- **Not tested** (scope, not criteria): Rust `target/` reuse, caching on temporary copies (no bay), the default
  ceiling's value, concurrent writers to one cache, and the guarded files' approval tag.

## Files

- `helpers.mjs`: the sandbox, the fixture (the machine's repository, its worktrees, main moving), the fixture's build,
  running the proof, reading the verdict and `BUILD` lines, and finding builds in the cache by their bytes.
- `reuse.test.mjs` (AC1), `fresh.test.mjs` (AC2), `tamper.test.mjs` (AC3), `verdicts.test.mjs` (AC4),
  `ceiling.test.mjs` (AC5).
- `twins.json`, `twins/README.md`: the planted wrong programs, to be laid down once an implementation exists.
- `BASE-FAILURE.txt`: the run on the base, and the throwaway planted program and wrong programs checked against the
  tests.

No fixture holds a secret or personal data. The fixture's git identity is `Fixture <fixture@example.invalid>`.
