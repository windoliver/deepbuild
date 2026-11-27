# Acceptance tests for #3689: a twin of a test-path program the test spawns

I drafted these tests blind from these sources:

- issue #3689, read with `gh issue view 3689 --repo windoliver/deepbuild`
- `docs/technical-design.md`, as `node scripts/design-section.mjs --issue 3689` prints it: "How we know version 0
  works" (Wrong programs; the edit guard; Dogfooding)
- `AGENTS.md`
- the base commit `c942af834`, which has no implementation of this issue

At the base I also read `scripts/proof.mjs`, `scripts/proof-runs.mjs` (`twinsOf`, `twinOverlay`, `prepareRuns`,
`before`), `scripts/proof-change.mjs` (`criterionId`, `underTestPaths`, `TEST_DATA`, `isTestFile`, `testImports`,
`relativeImports`), `scripts/lanes.mjs` (`testPaths`), `scripts/comment-ratchet.mjs`, and `tests/acceptance/1832/` for
its conventions. The helpers are written here, never imported from another suite. Per AGENTS.md, the implementing
agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with Node 24 from the checkout's root:

```sh
npm ci                                   # once, if node_modules is missing; the lane imports typescript
node --test 'tests/acceptance/3689/*.test.mjs'
```

Each file makes one scratch repository and runs the before lane once; the whole suite takes about 3 s. No test builds
this repository's workspace, installs anything or starts a hub.

## Criteria and their tests

The IDs are computed as `scripts/proof-change.mjs` computes them: the text after `- [ ] ` on each line under
`### Acceptance criteria`, trimmed, white space collapsed, SHA-256, first 8 hex digits.

| ID | Criterion (short) | Tests |
|---|---|---|
| `#3689.4455e965` | a twin may replace a code file under the test paths that no test it is laid for imports, that is no test file, not under `tests/acceptance/` or test data, and is source code; a test failing on it at its assertion is proven by `before` | `admitted.test.mjs` (three): a whole-file twin proves its test; a `lines.json` twin proves its test; the run with only such twins exits 0 |
| `#3689.13ba22c1` | a twin replacing a test file, an imported helper (directly or through imports), test data, a file under `tests/acceptance/`, a non-code file under the test paths, or anything under `node_modules` is still refused, and the `FAIL before` line names each refused file | `refused.test.mjs` (eight): one per kind, the import kind twice (direct and through a helper), and a twin mixing an admissible file with a refused one |
| `#3689.273a215f` | the merge-base run is unchanged: every file under the test paths the change holds is still laid on the merge base, so such a fix with no twin reads `FAIL before: … passed on the merge base` | `merge-base.test.mjs` (two): a fix in a spawned tool; a fix in a spawned tool with the golden beside it updated |

Every tagged test is a top-level `node:test` test with no subtests.

## Surface

`node scripts/proof.mjs before`, this checkout's, with its cwd at a scratch git repository: `main` committed, with
`origin/main` at it, and a branch `change` with one commit whose message says `Part of #9689`. The planted issue #9689
is read from a folder named by `DEEP_PROOF_ISSUES`; its criteria are the fixture's own, and every fixture tag is built
at run time from that text, so no file here carries a tag a real issue's trace lane could read. The lines read are
`<STATE> before: <file> › <full test name>: ...`, the closing `proof: wall time` line (the lane ran to its end) and the
exit status. A scratch repository gets no bay, so the lane works on temporary copies.

Each test points `HOME` and `XDG_CACHE_HOME` at a temporary folder removed when it ends, sets npm offline, and unsets
`NODE_TEST_CONTEXT`, `DEEP_PROOF_ISSUES` and the other `DEEP_*` variables a session around it may set. Every process
runs to its end under a timeout; nothing is killed by name or port.

## How each condition is made

In every fixture `main` holds the wrong version of each tool under `tests/tools/`, and the change fixes it there, so
the fix lives in a test-path file. Because the merge-base run lays the change's test-path files, each tagged test
passes on the merge base, and only a twin can prove it. A tagged test reaches a spawned file by
`fileURLToPath(new URL('<relative path>', import.meta.url))` and `spawnSync(process.execPath, ...)`, which
`relativeImports` does not read as an import.

**`admitted.test.mjs`** (criterion 1). Tools `tests/tools/sum.mjs` and `tests/tools/product.mjs`, spawned and not
imported by `tests/acceptance/9689/tools.test.mjs`. Twin `sum-adds-one` holds a whole wrong `tests/tools/sum.mjs`
(main's version, `a + b + 1`); twin `product-adds` is a `lines.json` turning `const value = a * b;` into
`const value = a + b;`. Each is named for its own criterion in `tests/acceptance/9689/twins.json`. Expected: each test
reads only `PASS before: …: failed on <twin> at its assertion`, and the run exits 0.

**`refused.test.mjs`** (criterion 2). One test file, `tests/acceptance/9689/refused.test.mjs`, that imports
`tests/tools/lib.mjs` and `tests/tools/chain.mjs` (which re-exports from `tests/tools/deep.mjs`). Eight tests, each
under its own criterion with its own twin; each twin is a real wrong program, so a lane that laid it would see its
test fail at its assertion and read `PASS`:

| Kind | Twin | Replaces | How the test reaches it |
|---|---|---|---|
| a test file | `replaces-test-file` | `tests/unit/count.test.mjs` | spawned with `node`, exit status asserted |
| an imported helper | `imported-helper` | `tests/tools/lib.mjs` | imported directly |
| imported through an import | `imported-twice-removed` | `tests/tools/deep.mjs` | imported through `tests/tools/chain.mjs` |
| test data | `fixture-data` | `tests/__fixtures__/make.mjs` | spawned; code, but in a `__fixtures__` folder |
| under `tests/acceptance/` | `acceptance-tool` | `tests/acceptance/9689/tool.mjs` | spawned; code, not imported, not a test |
| non-code under the test paths | `shell-adds-one` | `tests/tools/sum.sh` | run with `sh`; spawned, not imported, not data, but not a listed extension |
| under `node_modules` | `installed-package` | `node_modules/sumlib/index.mjs` | not reached; the test checks `tests/tools/sum.mjs` |
| mixed | `sum-and-helper` | `tests/tools/sum.mjs` (admissible) and `tests/tools/lib.mjs` (imported) | the test checks the spawned `sum.mjs` |

Each case is built to fail exactly one condition of criterion 1, so a lane that drops that one condition is caught by
that test. Expected for each: no `PASS` line for the test, and a `FAIL before: <test>: …` line that names the twin and,
after the test's name, each refused file (for the mixed twin, `tests/tools/lib.mjs`; whether it also names the
admissible `tests/tools/sum.mjs` is left open). The mixed twin also proves the twin is refused whole: a lane that lays
its admissible file and drops the refused one would read `PASS`.

**`merge-base.test.mjs`** (criterion 3). No `twins.json`. `tests/tools/sum.mjs` is fixed by the change; and
`tests/tools/render.mjs` changes its output from `sum=5` to `total: 5` while `tests/goldens/render.txt` changes with it,
the golden the test compares against. Expected: each test reads exactly `FAIL before: <test>: passed on the merge base`
and the run exits 1.

## Wrong programs each test fails on

- **The merge base** (`BASE-FAILURE.txt`). It refuses every twin that names a test-path file, so criterion 1's three
  tests fail: each tagged test reads `FAIL before: …: its planted wrong program <twin> replaces files under the test
  paths or node_modules (tests/tools/sum.mjs)` (or `product.mjs`) and the run exits 1. Criterion 2's and criterion 3's
  tests pass there: the base already refuses these twins, naming the files, and already lays the change's test paths on
  the merge base. They are regression protection for the change.
- **A lane that lays every twin** (the refusal removed). Planted by hand in a scratch copy of `scripts/`, never in this
  checkout: every criterion 2 test fails (each twin's test reads `PASS`, or for `installed-package` a FAIL line that
  names no refused file); criterion 1's tests pass on it, which shows their fixtures prove a test when the twin is laid.
- **A lane that refuses without naming the files** (the file list dropped from the refusal). Every criterion 2 test
  fails on the naming assertion.
- **The alternative the issue rejected**: the merge base keeps its own copy of spawned test-path code
  (`tests/tools/*.mjs` left out of the overlay). Both criterion 3 tests fail: each test reads `PASS before: …: failed
  on the merge base at its assertion` (for `render`, because the base's `render.mjs` meets the change's golden).
  Criterion 1's twin tests fail too there, for the same reason.

## What this suite does not prove

- **A `.rs` twin.** The issue's own case is a cargo integration test (`crates/deep-hook/tests/busy_disk.rs`) run by an
  acceptance test. Building a crate in a scratch repository costs minutes and a cargo toolchain, so this suite uses
  spawned `.mjs` tools. The listed extensions other than `.mjs` (`.rs`, `.js`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`)
  are not each tried, and `.sh` is the only non-code extension tried.
- **"None of the test files it is laid for imports the file" across several files.** Each fixture has one tagged test
  file. A twin laid for two test files, one of which imports the file, is not built.
- **Test data other than `__fixtures__`.** `__snapshots__`, `fixtures`, `golden` and `testdata` folders are not each
  tried. At the base, `TEST_DATA` counts a script in a `fixtures/`, `golden/` or `testdata/` folder as code under test,
  not data; see Disputes.
- **A twin laid in a bay.** Scratch repositories get temporary copies, so the bay path (`inBay`) is not reached.
- **A `vitest` test.** Every fixture test is a `node:test` `.mjs` test.

## Disputes

- **"Test data" for a script in a `fixtures/` folder.** Criterion 1 excludes files "under … test data (`__snapshots__`,
  `__fixtures__`, fixtures, golden or testdata)", which reads as any file in such a folder. At the base `TEST_DATA`
  treats a `.js`/`.ts`-family file inside `fixtures/`, `golden(s)/` or `testdata/` as code under test ("a script may be
  code under test, as a fixture factory is"), while all of `__snapshots__/` and `__fixtures__/` is data. I used
  `__fixtures__/`, which both readings call test data, and leave the other folders untested.
- **What else the refusal line may name.** "The `FAIL before` line names each refused file" says nothing of the
  admissible files of a mixed twin; the tests require the refused file and don't look for the others.

## The base

`BASE-FAILURE.txt` holds the run on the base `c942af834`, with its load.
