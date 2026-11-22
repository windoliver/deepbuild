# Acceptance tests for #1832: a twin kept as its wrong lines

I drafted these tests blind from these sources:

- issue #1832, as saved verbatim for this job
- `docs/technical-design.md`: "How we know version 0 works" (Dogfooding, Wrong programs, "Failing on an assertion",
  Criteria to tests, Criteria in a checked shape), and `docs/parallel-proof.md`
- AGENTS.md
- the base commit `11eb8c6fd`, which has no implementation of this issue

At the base I also read `scripts/proof.mjs`, `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `before`,
`atAssertion`), `scripts/proof-change.mjs` (`criterionId`, `tagsIn`, `underTestPaths`), `scripts/proof-binaries.mjs`
(`selectBinaries`), `scripts/bays.mjs` (`claimPair`), `scripts/loads-lint.mjs` and `scripts/plant-lint.mjs` (how a lint
here prints), `scripts/affected.mjs` (`lintFindings`), `packages/hub/src/plant.ts`, the twins and `twins.json` of
`tests/acceptance/25/` and `27/`, and `tests/acceptance/1838/`, `1830/` and `1120/` for their conventions. The helpers
are written here, never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A
dispute goes to a blind redraft by this job.

The owner's rulings this draft builds in: the change under test converts only the twins of #25 and #27; the other
suites' whole-file twins stay for later changes; the converted twins are written by separate blind redraft jobs in the
format this README defines.

Run them with Node 24:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/1832/*.test.mjs'
```

As readings on this Mac at a one-minute load of 30 to 39 on its cores: `lint.test.mjs` 2 s, `lines.test.mjs` 19 s,
`plant.test.mjs` 38 to 49 s (two offline `npm ci` runs and thirteen `tsc` builds of two files, in temporary folders).
No test builds this repository's workspace or starts a hub.

## The line form

The issue leaves the on-disk shape of "its wrong lines and where they go" open. This is the shape these tests are
written against, and the one the blind redrafts of #25's and #27's twins are to be written in.

**Where.** A twin is still the folder `tests/acceptance/<suite>/twins/<twin>/`, named under a criterion's tag in
`tests/acceptance/<suite>/twins.json`, which doesn't change. A twin kept as lines holds one file, `lines.json`, at the
top of its folder:

```json
{
  "packages/hub/src/plant.ts": [
    {
      "find": ["  if (!value) return undefined;"],
      "wrong": ["  if (!value) return 'waiter-never-wakes';"]
    }
  ]
}
```

**Shape.** One JSON object. Each key is the repo path of a file the twin edits, with `/` between its parts. Each value
is a list of one or more edits. An edit is an object with exactly two keys: `find`, a list of one or more strings, and
`wrong`, a list of zero or more strings. Each string is one whole line, without its line end, and holds no line break.

**Matching.** The file is read as the change holds it when the lane runs and split into lines at `\n`. An edit's
`find` matches where that many lines in a row equal its strings exactly: same characters, same leading and trailing
white space, nothing trimmed or folded. An edit applies only if its `find` matches at exactly one place in the file.
Every edit of a file is placed against the file as the change holds it, before any edit of the twin is made, and no two
edits of a file may overlap. Where an edit applies, its `wrong` lines take the place of its `find` lines; an empty
`wrong` removes them. To add lines, find the line beside them and repeat it in `wrong`. Line numbers are never stored
and never used. The edited file keeps its line ends and its last line end as they were.

**When.** A line twin is laid when the lane runs, over the change, before the build, as a whole-file twin is at the
base, and again after the build's writes are undone.

**All or nothing.** A twin applies only when every edit of every file it names applies. Otherwise none of it is laid
and no test runs on it. Each of these makes a twin not apply:

- an edit's `find` matches nowhere in its file (the lines main has since changed);
- an edit's `find` matches at more than one place (a twin never applies somewhere it was not written for, so the lane
  picks neither the first place nor all of them);
- the file a key names is not in the change;
- two edits of one file overlap;
- `lines.json` is not JSON or not of the shape above.

**What the lane says.** A twin that does not apply reads `BLOCKED` in the before lane: for it the lane prints at least
one line that starts `BLOCKED before: ` and holds both the twin's folder name (`<twin>`) and the repo path of the file
whose lines did not apply (for a `lines.json` that can't be read, the path of that `lines.json`). The run then exits 1,
as any BLOCKED line makes it. It is never left out of the run, never FAIL as a wrong program that didn't fail its test,
and never applied in part. This holds for every twin the lane would have laid, that is, each twin of a tagged test that
didn't fail on the merge base at its assertion, also when another twin of the same criterion fails the test. A test
whose only twin didn't apply gets no `PASS before:` line. A line twin that applies reads as a whole-file twin does:
`PASS before: <test>: failed on <twin> at its assertion` when its test fails on it at its assertion, `BLOCKED ... cannot
run on its planted wrong program <twin>: ...` when it no longer builds.

**Rules kept from the base.** A twin edits code under test, never a file under the test paths or `node_modules`; a
`lines.json` key naming one is refused as a whole file there is. A whole file in a twin's folder (any file other than
its top-level `lines.json`) is still laid whole, so the suites not yet converted keep working, and a twin may hold both
until it is converted. `lines.json` at the top of a twin's folder is never laid as a file of the repository.

## The lint

`node scripts/twins-lint.mjs [--root <checkout>]` reads, under `<root>/tests/acceptance` (default: the checkout holding
the script), each suite's `twins.json` and the folder `twins/<twin>/` of every twin it names. A whole-file twin is a
named twin whose folder holds any file other than its top-level `lines.json`, at any depth. The lint prints one line
per whole-file twin, each twin once however many criteria name it:

```
FAIL twins: tests/acceptance/<suite>/twins/<twin>: <the whole files it still holds, or any other words>
```

and exits 1; a `  Fix:` line may follow, as the other lints print one. With no whole-file twin it prints the one line
`PASS twins` and exits 0. A `twins/` folder in a suite with no `twins.json` (a suite's own fixtures, as
`tests/acceptance/1830/twins/` is) is no twin and is never listed. The shape follows `scripts/loads-lint.mjs` and
`scripts/plant-lint.mjs`, so `scripts/affected.mjs` reads each line as a lint finding, keyed by the twin's folder.
Where the lint runs (the `lint` check of `scripts/lanes.mjs`) and how main's remaining findings are set apart is the
implementing change's to decide; these tests don't read it.

## Criteria and their tests

The IDs are computed as `scripts/proof-change.mjs` computes them: the text after `- [ ] ` on each line under
`### Acceptance criteria`, trimmed, white space collapsed, SHA-256, first 8 hex digits.

| ID | Criterion (short) | Tests | Wrong program |
|---|---|---|---|
| `#1832.28845f50` | after a planted change elsewhere in `packages/hub/src/plant.ts`, each converted twin of #25 and #27 still builds and fails its test at its assertion | `plant.test.mjs` (one) | the merge base: its twins of #25 and #27 are whole files, which lose the planted change and no longer build |
| `#1832.6c8186e3` | a twin whose wrong lines no longer match reads BLOCKED in the before lane, naming the twin and the file; a planted lane that skips it fails | `lines.test.mjs` (three): lines that match nowhere; lines that match in two places; a run that would pass by skipping the twin | the merge base: its lane lays `lines.json` as a file, applies nothing and never says BLOCKED |
| `#1832.49f466eb` | a lint lists every whole-file twin left, and the list is empty once the conversion lands | `lint.test.mjs` (three): every whole-file twin of a scratch checkout, each once; `PASS twins` on a scratch checkout with line twins only; none of #25's and #27's twins on this checkout | the merge base: it has no `scripts/twins-lint.mjs` |

Every tagged test is a top-level `node:test` test with no subtests.

## Surfaces

The issue names the before lane, a lint, `packages/hub/src/plant.ts` and the twins of #25 and #27. These tests reach
each only by running a process or reading a file the issue names.

1. **`node scripts/proof.mjs before`**, this checkout's, with its cwd at a scratch git repository whose branch `change`
   names a planted issue (#9832, read from `DEEP_PROOF_ISSUES`) with `Part of #9832`. The lines read are
   `<STATE> before: <file> › <full test name>: ...`, the `BLOCKED before: ` lines, the closing `proof: wall time` line
   (the lane ran to its end) and the exit status. A scratch repository gets no bay, so the lane works on temporary
   copies.
2. **`node scripts/twins-lint.mjs`**, this checkout's, with `--root` at a scratch checkout, and with none on this one.
3. **`packages/hub/src/plant.ts`** and **the twins `tests/acceptance/25/twins.json` and `27/twins.json` name**, read
   from this checkout as files at run time and copied into the scratch repository; nothing is imported from them here.

## The scratch trees

- **Lines that no longer match** (`lines.test.mjs`). `main` holds `src/price.mjs` and `src/tax.mjs`, both right, so each
  tagged test passes on the merge base and only its twin can prove it. The first repository's change adds three tests,
  each under a criterion of its own, and three line twins:
  - `tax-floors-stale`: two edits. The first fits `src/price.mjs` and alone would fail its test; the second names
    lines `src/tax.mjs` doesn't hold. Expected: BLOCKED, naming the twin and `src/tax.mjs`; no PASS line for its test
    (a lane that lays what fits and drops the rest reads PASS); exit 1.
  - `discount-adds`: one edit of two lines in a row, found once. Expected: its test reads
    `PASS before: ...: failed on discount-adds at its assertion`, and no BLOCKED line names it. This is the control: a
    lane that says BLOCKED for every line twin fails it.
  - `free-from-five-thousand-twice`: one edit whose line is in `shipping()` and in `handling()`. Laid at the first
    place, or at both, it fails its test. Expected: BLOCKED, naming the twin and `src/price.mjs`; no PASS line.

  The second repository's change adds one test and two twins of its one criterion: `total-ignores-count`, which fits
  and fails the test, and `total-starts-at-one-stale`, whose line is nowhere. A lane that skips the second reads PASS
  and exits 0. Expected: a BLOCKED line naming `total-starts-at-one-stale` and `src/price.mjs`, and exit 1. Whether the
  test also gets a PASS line from the first twin is left open.
- **The planted change** (`plant.test.mjs`). `main` is an npm workspace with one package at `packages/hub`, holding:
  this checkout's `packages/hub/src/plant.ts` with a comment added as its first line (every later line moves down by
  one) and an export `plantedElsewhere1832` added at its end; `src/uses.ts`, which imports that export; this
  checkout's copy of every other file a twin names (such as `packages/hub/src/setup.ts`), unbuilt; and a `tsc` that
  runs this checkout's compiler with the root `tsconfig.json`'s settings over `plant.ts` and `uses.ts` alone, so the
  lock installs offline. The change adds every twin of #25 and #27 as this checkout holds it (11 folders at the base, 13 files), copied byte for byte to
  `tests/acceptance/9832/twins/<suite>-<twin>/`, and one test per twin, each under a criterion of its own naming that
  twin alone. Each test asserts, on the built module with `DEEP_HUB_PLANT` unset, that `plantOf(undefined)` and
  `activePlant()` are `undefined`: the right program selects no plant, and each twin of #25 and #27 selects its own
  whatever the variable says, as every one of them does at the base. Expected: for every twin, every line naming its
  test is `PASS before:`, one of them `failed on <suite>-<twin> at its assertion`; exit 0.

Every test points `HOME` (and `XDG_CACHE_HOME`) at a temporary folder removed when it ends, sets npm offline, and
unsets `NODE_TEST_CONTEXT`, `DEEP_HUB_PLANT` and the `DEEP_*` variables a session around it may set. Every process runs
to its end under a timeout; nothing is killed by name or port.

## Wrong programs

For a fix the merge base is the wrong program, and it is for all three criteria; this suite plants no twin and has no
`twins.json`. `BASE-FAILURE.txt` holds the run.

- **#1832.28845f50**: on the base the twins of #25 and #27 are whole copies of `plant.ts` (and `setup.ts`). Laid over
  the planted file they drop `plantedElsewhere1832`, `uses.ts` no longer compiles, and each reads
  `BLOCKED before: ...: cannot run on its planted wrong program <twin>: npm run build --workspaces --if-present failed`.
  That is the issue's fault, shown through the lane. With the converted twins and the base's lane (the tagged tests'
  run on the merge base, which takes the change's test paths), `lines.json` is laid as a stray file, the program is
  unchanged and each test reads `FAIL ... fails on neither the merge base nor its planted wrong program`.
- **#1832.6c8186e3**: the base's lane lays `lines.json` at the root of its copy, applies nothing, runs the test on the
  unchanged program and reads `FAIL ... fails on neither the merge base nor its planted wrong program`. No line says
  BLOCKED or names the twin's file.
  "A planted lane that skips it fails" is read two ways, and the tests hold under both. A lane run in which a twin was
  skipped must itself fail: each test requires exit 1 with the BLOCKED line. And a wrong lane that skips the twin must
  fail these tests: the second repository is built so that such a lane reads PASS and exits 0, and
  `tax-floors-stale` so that a lane laying only what fits reads PASS. I could not plant that lane as a twin of this
  suite: in line form its `find` lines would be lines of an implementation that doesn't exist yet, and as a whole
  copy of `scripts/proof-runs.mjs` it would be the kind of twin this issue retires.
- **#1832.49f466eb**: the base has no lint; `node scripts/twins-lint.mjs` exits 1 with `Cannot find module` and an
  empty stdout, and each test fails at its first assertion on what the lint prints.

## What this suite does not prove

- **"The list is empty once the conversion lands", for the whole repository.** By the owner's ruling this change
  converts only #25's and #27's twins, and the lint goes on listing the other suites' whole-file twins. The suite proves
  the list holds none of #25's and #27's twins on this checkout and is empty (`PASS twins`) on a scratch checkout
  whose twins are all lines. That half of criterion 3 stays open for the repository until the later conversions land.
- **"Fails its test" with #25's and #27's own tests.** `plant.test.mjs` lays each twin through the real lane over the
  real `plant.ts` after the planted change, builds `plant.ts` alone, and fails a stand-in test that reads only whether a
  plant is selected. It does not build the hub or run `tests/acceptance/25/` and `27/` against each twin. That run, the
  before lane on main with the converted twins before and after a planted `plant.ts` change, is the issue's Proof
  line and is made by hand.
- **That an edit of a file other than `plant.ts` builds.** A converted twin's lines for `packages/hub/src/setup.ts` are
  applied in the scratch repository (so lines that no longer match the real file read BLOCKED and fail the test), but
  that file is not compiled there.
- **Rows of the line form with no test here:** a file a key names that the change lacks, overlapping edits, a
  malformed `lines.json`, a key under the test paths, and a whole file beside `lines.json` laid by the lane. They are
  stated above as the format; only "matches nowhere" and "matches in two places" run.
- **The lane in a bay.** A scratch repository gets temporary copies, never a bay pair, so the bay path's laying of a
  line twin (`inBay`, laid before the build and after the undo) is not reached.
- **The converted twins themselves.** They don't exist at the base. The stand-in test assumes each still selects its
  plant with `DEEP_HUB_PLANT` unset; a redraft that makes a twin wrong in another way would need this test redrafted.
- **A `plant.ts` that imports a sibling module.** The scratch build compiles `plant.ts` and `uses.ts` alone; at the base
  `plant.ts` imports only Node's own modules. If it grows a relative import the scratch build fails on both sides and
  this test goes to a blind redraft.

## Notes for the implementing change

- `plant.test.mjs` writes the hub's package folder in pieces (`['packages', 'hub'].join('/')`) because
  `scripts/proof-binaries.mjs` builds the hub's binaries for any test file whose strings name that folder, and this
  test starts no hub.
- I can't edit `scripts/lanes.mjs` from here. `plant.test.mjs` runs `npm ci` twice and thirteen small builds in
  temporary folders; if the unit lane's parallel block makes it slow, it belongs in `alone`.

## The base

`BASE-FAILURE.txt` holds the run on the base `11eb8c6fd` with the load it ran at. All seven tests fail there at their
assertions.
