# Acceptance tests for #2874: R1's fixture digest doesn't depend on the checkout's umask

Written first and blind, at base `843f9a67799e108e4da5cd93716fbfdbb6936bf4`, where the issue's bug is present, from
the issue, the design and the base, before any implementation. The drafting job saw no fix, diff, other branch, other
worktree, pull request or git history. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion.

## Sources

- **The issue**, #2874, as quoted in the drafting brief: the failing line, the cause (`packageDigest` counts each file's
  mode; git writes `contracts/fixtures/R1/*` as 664 under umask 002), the reproduction, the Fix and the three criteria.
- **The design**, `docs/technical-design.md`: How we know version 0 works (Frozen contracts: the previous release's
  fixture "kept by its envelope digest and never rebuilt"; Criteria to tests; Wrong programs; Dogfooding; Tests written
  first) and Failing on an assertion.
- **AGENTS.md.**
- **The base, for surfaces only**: `scripts/contract-diff.mjs` (`record`, `old-load`, `fixtureDigest`, `runFixture`),
  `packages/extension-host/src/digest.ts` and `index.ts` (the public entry), `host.ts`'s install (`admit`, `snapshot`,
  `copyPackage`), `contracts/fixtures/R1/` and its modes in git (both `100644`), `packages/contracts/extension-api.json`
  (`deep.registerCheck` is R1's one stable method), suite `tests/acceptance/139` (README, `helpers.ts`,
  `oldload.test.ts`, `REDRAFT.md`), the layouts of suites 2227, 2870, 2665 and 1514, `scripts/proof-change.mjs`
  (`criterionId`, `tagsIn`), `scripts/proof-runs.mjs` (how a twin is laid and built, `atAssertion`), `scripts/lanes.mjs`
  (`testGlobs`, `alone`), `tests/vitest-setup.ts` and `vitest.config.ts`.

## Run

From the repository root, on macOS with Node 24.22:

```sh
npm ci
npm run build --workspaces          # the step imports packages/*/dist
nice -n 10 node node_modules/vitest/vitest.mjs run tests/acceptance/2874 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2874/tsconfig.json
```

- Each test sets its own bound, which overrides `--testTimeout`: AC1 and each AC2 test 10 minutes, AC3 15; each run of
  the step is bounded at 4 minutes and each git command at 2. A step past its bound is killed by its PID and the test
  reads INCONCLUSIVE, never a pass. At a load of 166 to 336 on this Mac the whole suite took 48 to 76 s and no test
  more than 61 s; a run of the step takes 8 to 17 s.
- **Parallel-safe, no `scripts/lanes.mjs` entry.** Every folder is under `/tmp/dh2874-*` (real paths), removed after
  its file. `HOME` is a temp folder for the process and every child, and `TMPDIR` for every child, so the step's own
  scratch copies land in this suite's folders too; `CLAUDE*`, `DEEP_*`, `AI_AGENT`, `NODE_OPTIONS`, npm's and Vitest's variables and git's
  `GIT_*` are taken out of every child's environment, and git reads no system or user config (`GIT_CONFIG_NOSYSTEM`, the
  temp `HOME`). No network, no port, no hub, no daemon, no throttle grant: the only processes are git and
  `node scripts/contract-diff.mjs`, each waited for. No test copies this checkout's `.git`; each scratch repository is a
  new `git init` under its own temp folder.

## The surface under test

The issue names its surfaces: `node scripts/contract-diff.mjs record --release R1`, `node scripts/contract-diff.mjs
old-load`, R1's fixture under `contracts/fixtures/R1/` with its `deepbuild.json` digest, and a checkout made under umask
022 or 002. What it leaves open is how a test makes such a checkout on a Mac whose umask is 022; each choice is marked
*(chosen)*.

- **A checkout made under a umask** is a `git clone` run under that umask *(chosen)*, of a scratch repository holding
  this checkout's contract data: `packages/contracts`' published files and `contracts/` with R1's fixture, no release or
  break recorded, as #139's scratch tree holds them, committed once (`helpers.ts` `source`). git writes each file 0666
  less the umask, 0777 less it for one it records as executable: 644 and 755 under 022, 664 and 775 under 002. Each
  test checks that git did so for every file under `contracts/fixtures/R1/` before it runs the step; where it didn't,
  the test reads INCONCLUSIVE. A real clone, rather than files chmod-ed to 664, also holds the modes git records, so a
  fix that reads them from git's index passes as one that reads them from the files does.
- **The step runs under the checkout's umask** *(chosen)*, as on a machine whose default it is (the issue's Spark runs
  both under 002): `sh -c 'umask <u> && exec node scripts/contract-diff.mjs … --root <checkout>'`, from this checkout's
  root, so the program under test is this checkout's step and its `packages/*/dist`. This matters at the base: on this
  Mac's Node 24.22.2, `cpSync` makes each copy at its source's mode less the process's umask, so the base's step run
  under umask 022 on a 664 checkout would digest 644 copies and pass by accident.
- **A release moves between checkouts** as a release does *(chosen)*: what `record --release R1` wrote
  (`contracts/releases/R1.json`, `R1.corpus.json`, `contracts/fixtures/R1/recorded.json`) is committed in the checkout
  that recorded it, and the checkout of the same files under the other umask is a clone of that commit.
- **The pin** is `fixture.digest` in `contracts/releases/R1.json`; **the committed digest** is the `digest` field of
  R1's `deepbuild.json` as checked out, read before the step runs.
- **A package digest** where a test needs one (AC3's stamp) is `packageDigest` from the extension host's public entry,
  `packages/extension-host/src/index.ts`.

No test imports `scripts/contract-diff.mjs` or names the file a fix changes: each runs the step the issue names and reads
what it prints and writes.

## Criteria to tests

Each ID is `#2874.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`); each test's name starts with its ID.

| Criterion | ID | Test (file) | What it asserts | Wrong programs it fails on | At the base |
|---|---|---|---|---|---|
| AC1 | `#2874.177fc2d6` | `ac1-record.test.ts`: *on a umask 002 checkout, where git writes R1's fixture as 664, record --release R1 installs and loads R1's fixture package and pins the committed digest its deepbuild.json carries, as it does on a umask 022 checkout (644)* | on the umask 022 clone the record prints no FAIL line, exits 0 and pins the committed digest; on the umask 002 clone it does the same, and records what the fixture's calls returned equal to the umask 022 clone's `recorded.json` | the base; `checkout-modes` | **fails** at `expectRecorded` on the umask 002 record, with the issue's line: `FAIL contracts: R1's fixture package didn't load: deepbuild/r1fixture's envelope digest d1:68bb6bf2… isn't its files' digest d1:b8fd5ae6…`, exit 1. The umask 022 side passed |
| AC2 | `#2874.1637d9b1` | `ac2-old-load.test.ts`: *a release recorded on a umask 022 checkout passes old-load on a umask 002 checkout of the same files* | recorded on the 022 clone (no FAIL, exit 0), committed, cloned under 002: `old-load` prints no FAIL line, exits 0, prints a PASS line and names each stable method R1's record lists | the base; `checkout-modes` | **fails** at old-load's no-FAIL assertion: R1's fixture digests `d1:b8fd5ae6…`, not the pinned `d1:68bb6bf2…`, and didn't load in `next`; exit 1 |
| AC2 | `#2874.1637d9b1` | `ac2-old-load.test.ts`: *a release recorded on a umask 002 checkout passes old-load on a umask 022 checkout of the same files* | recorded on the 002 clone (no FAIL, exit 0), committed, cloned under 022: `old-load` passes as above | the base; `checkout-modes` | **fails** at `expectRecorded` on the umask 002 record, with AC1's line, before any old-load |
| AC3 | `#2874.a254fb4c` | `ac3-executable.test.ts`: *a fixture file git records as executable (755, written 775 under umask 002) is pinned as 755: the same digest under either umask, and a different one than the same bytes not executable* | R1's fixture with `index.ts` committed 100755 and stamped at 755: recorded on the 022 clone (no FAIL, exit 0) it pins the stamp; on the 002 clone (775) the same digest. The same bytes not executable, R1 as committed, recorded on a 002 clone (664): pinned at the committed digest, which isn't the executable one's | the base; `checkout-modes`; `exec-bit-dropped` | **fails** at `expectRecorded` on the umask 002 record of the executable one: its envelope digest `d1:acf19524…`, the stamp the umask 022 record pinned, isn't its files' digest at 664 and 775, `d1:57103365…` |

## The wrong programs

`twins.json` maps each criterion's ID to its twins. A twin holds whole files at their repo paths, laid over the program
by the proof lane before it builds (`scripts/proof-runs.mjs`), so a twin's `digest.ts` reaches both this suite's
in-process `packageDigest` and the step's `packages/extension-host/dist`.

- **The base**, for every criterion: its step copies the fixture at the modes the checkout's umask wrote and the host
  digests them as they are, so on a umask 002 checkout R1's files digest `d1:b8fd5ae6…`, not the committed
  `d1:68bb6bf2…`, and the install refuses them (BASE-FAILURE.txt).
- **`checkout-modes`** (AC1, AC2, AC3), for a merge base that no longer shows the bug: the base's
  `scripts/contract-diff.mjs` and `packages/extension-host/src/digest.ts`, the two files the issue names as the fix and
  the cause, each line that carries the bug marked with a comment. Laid over a fix in either file, it brings the bug
  back.
- **`exec-bit-dropped`** (AC3): a wrong fix that counts every file as 644, so modes stop mattering and an executable
  file digests as the same bytes not executable: `digest.ts` with `644` in place of each file's mode, and the base's
  `contract-diff.mjs`. AC1 and AC2 pass on it; AC3 fails at its last assertion, both repositories pinned at one digest.

Each twin replaces what main changes in its two files after this base, so a twin may need a blind redraft when main
moves them.

## Readings where the issue leaves a choice

- **"A checkout made under umask 002"** is a clone git writes under 002 with the step run under 002 too (The surface
  under test). A 664 checkout with the step run under 022 is not tested.
- **"Installs and loads R1's fixture package"** is the record printing no FAIL line (the base's step prints `FAIL
  contracts: R1's fixture package didn't load: …` when install, check or load refuses it) and exiting 0, with
  `recorded.json`, what the fixture's calls returned, equal to the umask 022 checkout's.
- **"The committed digest its deepbuild.json carries, `d1:68bb6bf2…`"** is read from the checked-out `deepbuild.json`
  (at the base `d1:68bb6bf21e482001d93a9b43b93f30849445a60647e494ef9169b238558ac35d`), not written into the tests: R1 isn't
  cut at the base, so its fixture may still be re-stamped when a stable method joins it. A program that re-stamped the
  committed fixture at 664 instead of fixing the step would fail AC1 on the umask 022 clone, whose files would no
  longer match the stamp (reasoned, not run).
- **"Passes `old-load`"** is no FAIL line, exit 0 and a PASS line, run as the criterion writes it, without `--release`,
  and naming each stable method R1's record lists, so a run that found no release to load can't pass.
- **AC3's executable file** is R1's own `index.ts`, committed 100755 in a scratch repository, never in this checkout, so
  no file is added to the package; its `deepbuild.json` is stamped as a build stamps a package, with the host's digest
  of the folder at the modes git records (its own `digest` field isn't counted). **"The same bytes not executable"** are
  R1's fixture as committed, every file 100644, at its committed digest. **"Pinned as 755"** is the pin equal to the
  stamp at 755.

## Checked once, outside the suite

Each program was laid over the base in this worktree, never committed, and the suite run once on it, on November 20,
2026, at a load of 166 to 366:

| Program | What it is | Result |
|---|---|---|
| right program A | the issue's Fix, in `scripts/contract-diff.mjs` only: one function makes the fixture's copy, `recorded.json` left out, and chmods each file 755 when its owner may run it, else 644; `fixtureDigest` and `runFixture` both use it | 4 of 4 pass (76 s) |
| `checkout-modes` over A | both twin files laid over A | 4 of 4 fail at the base's assertions, with the base's FAIL lines |
| `exec-bit-dropped` over A | both twin files laid over A | AC1 and both AC2 tests pass; AC3 fails at its last assertion, both repositories pinned at `d1:68bb6bf2…` |
| right program B | the fix in `packages/extension-host/src/digest.ts` only, each file counted 755 when its owner may run it, else 644, with the base's step | 4 of 4 pass, so no test depends on which file a fix changes |

- Each twin replaces both files whole, so laid over B it is the same program as over A; those runs weren't repeated.
- Where a program changes `digest.ts`, its `packages/extension-host/dist/digest.js` was emitted with TypeScript's
  `transpileModule`, first checked to emit the base's `digest.ts` byte for byte as `npm run build --workspaces` had; no
  other `dist` file holds its text. Afterwards `scripts/contract-diff.mjs`, `digest.ts` and `dist/digest.js` were put
  back, and `git status` showed only `tests/acceptance/2874/`. No `/tmp/dh2874-*` folder was left after any run.
- After these runs, the bounds were already as above and one assertion was strengthened: AC1's umask 022 record is held
  by `expectRecorded` (no FAIL line as well as exit 0). AC1 alone was run on A again and passed, and BASE-FAILURE.txt is
  the base run of the final files; an earlier base run, before the bounds were shortened, failed the same four ways.
- Not run: Linux. Nothing in the suite is macOS-only (`/bin/sh`, git and `umask`), but Node's copy may keep modes
  differently there; the tests set every umask themselves, so a machine's own umask doesn't change them.

## Files

- `helpers.ts`: temp folders and the clean environment, git under a umask, the scratch repository (`source`), a
  checkout under a umask with its modes checked (`checkout`, `fixtureFiles`), committing a release, the step run under a
  umask, its FAIL lines, the pin and `expectRecorded`.
- `ac1-record.test.ts` (AC1), `ac2-old-load.test.ts` (AC2, one test per direction), `ac3-executable.test.ts` (AC3).
- `twins.json` and `twins/checkout-modes/`, `twins/exec-bit-dropped/`: the wrong programs above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, twins left out.
- `BASE-FAILURE.txt`: the run on the base.
