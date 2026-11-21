# Acceptance tests for #1838: three proof-tool faults

I drafted these tests blind from these sources:

- issue #1838, as saved verbatim for this job
- `docs/technical-design.md`: "How we know version 0 works", Dogfooding, Wrong programs and "Failing on an assertion"
- AGENTS.md
- the base commit `58d3e19e`, which has no implementation of this issue

At the base I also read `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `judgeTask`), `scripts/perf.mjs`,
`scripts/affected.mjs` (`select`, `plan`, `main`), `scripts/proof.mjs`, `scripts/proof-runs.mjs` (`frames`,
`atAssertion`, `runNode`, `prepareRuns`, `before`), `scripts/proof-reporter.mjs` and `scripts/proof-change.mjs`
(`readIssue`, for how a criterion's ID is computed), and `tests/acceptance/568/`, `1115/` and `569/` for their
conventions. The helpers are written here, never imported from another suite. Per AGENTS.md, the implementing agent
doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/1838/*.test.mjs'
```

## Criteria and their tests

| ID | Criterion (short) | Test |
|---|---|---|
| `#1838.25e8bbd8` | 568's lane test passes on a fit reference Mac; a `judgeTask` that ignores the planted fingerprint fails it | `lane568.test.mjs` |
| `#1838.241106cb` | `affected.mjs` on a change that deletes a test file plans no run for it and ends with its verdict line; the merge base throws ENOENT naming the file | `affected.test.mjs`, twin `reads-deleted-test` |
| `#1838.737ec09d` | in the before lane, a test with `at /tmp/x.js:1:1` in its assertion message is proven at that assertion, and a parent whose subtests are each proven reads proven; on the merge base each reads FAIL | `before.test.mjs` (two tests) |

The IDs are computed as `scripts/proof-change.mjs` computes them: the text after `- [ ] ` on each line under
`### Acceptance criteria`, trimmed, white space collapsed, SHA-256, first 8 hex digits.

## Surfaces

The issue names three surfaces, and these tests reach each only by running it as a process.

1. **`tests/acceptance/568/lane.test.mjs`**, run with `node --test --test-reporter=tap` from this checkout. The test
   requires exit 0 and every one of its tests passing, none failed, cancelled, skipped or todo. It doesn't care which
   seam carries the fingerprint (a seam in the perf lane, or 568's blind redraft at the same path).
2. **`node scripts/affected.mjs`** with no arguments, so the change is the worktree against its merge base with
   `origin/main`, in a scratch git repository holding a copy of this checkout's `scripts/`. The output read: its plan
   lines (`<block> <runner>: <files>`), its last line (`<STATE> affected: ... N passed ...`) and its stderr.
3. **`node scripts/proof.mjs before`**, this checkout's, with its cwd at a scratch git repository whose branch `change`
   names a planted issue (#9838, read from `DEEP_PROOF_ISSUES`) with `Part of #9838`. The lines read are
   `<STATE> before: <file> › <full test name>: ...`; a test reads proven when every line naming exactly it is `PASS`
   (a line about a subtest names the parent's key followed by ` › `, so it never counts for the parent).

## The scratch trees

- **affected.mjs** (`affectedTree` in helpers): `main` holds `src/one.mjs` and two node tests that import it,
  `tests/one.test.mjs` and `tests/two.test.mjs`; the commit on `change` edits `src/one.mjs` and deletes
  `tests/one.test.mjs`. As #1115's trees do, the tree stubs `cargo` first on `PATH` (`metadata` reports no crates),
  stubs the lint lane's own scripts (they read folders the tree doesn't have), gives an empty
  `scripts/known-failures.json`, and links each entry of this checkout's `node_modules` into a folder of its own,
  hidden from git.
- **before lane** (`repository` in helpers): `main` holds `src/sums.mjs` with `add` and `half` both wrong; the commit
  on `change` fixes them and adds two tagged tests. `message.test.mjs` asserts `add(2, 3)` is 5 with the message
  `add(2, 3) is not 5\nat /tmp/x.js:1:1`. `parent.test.mjs` is one test with no assertion of its own and two subtests,
  `adds` and `halves`, each asserting one fixed function. Their tags are built at runtime from the planted criteria's
  text, so no file here carries a tag of a real issue. One lane run serves both tests of the file.

Every test points `HOME` (and `XDG_CACHE_HOME`) at a temporary folder removed when it ends, and unsets
`NODE_TEST_CONTEXT` and the `DEEP_*` variables a session around it may set. Every process runs to its end under a
timeout; nothing is killed by name or port.

## Wrong programs

- **#1838.25e8bbd8**: the merge base is the wrong program the criterion names. Its `judgeTask` calls the module's own
  `fingerprint()` (`scripts/benchmark.mjs`), so it ignores the fingerprint 568's suite plants. On any machine 568's
  first test then fails, since each result records the real machine's fingerprint, not the planted one; on a real
  reference Mac in reference conditions its "off the reference Mac" tests fail as well, and anywhere else its "on the
  reference Mac" tests do. No twin is needed.
- **#1838.241106cb**: **this criterion already holds on the base `58d3e19e`.** Commit `afaaa2a8e` (#2249, "leave a test
  the change deletes out of the run") added an `existsSync` filter in `select()`, so the base plans no run for a deleted
  test and ends with `PASS affected: ... 1 passed`; `affected.test.mjs` passes on the base. I checked the other routes a
  deleted test could take (uncommitted deletion, a committed one, the deleted path given as an argument, `--list`,
  `--wide`): the base handles each. The merge base the criterion means ("throws ENOENT, naming the file") is the
  program before that filter, so it is planted as the twin `twins/reads-deleted-test/scripts/affected.mjs`: the base's
  `affected.mjs` with only that filter removed. On it the test fails at its first assertion, and stderr shows
  `Error: ENOENT: no such file or directory, open '<tmp>/tree/tests/one.test.mjs'` thrown from `plan` (BASE-FAILURE.txt).
- **#1838.737ec09d**: the merge base is the wrong program. Its `frames()` reads the message's `at /tmp/x.js:1:1` as the
  innermost frame, outside the test paths, so the message test reads `FAIL ... failed on the base before its assertion`,
  and the parent, whose own failure there is node's `ERR_TEST_FAILURE: 2 subtests failed`, reads FAIL too, though both
  its subtests read `PASS ... failed on the merge base at its assertion`.

## Fit machines and the load (#1838.25e8bbd8)

568's suite plants the fingerprint, so the real machine's model, power and thermal state don't matter once the plant
reaches `judgeTask`. What the plant can't stand in for is the load `judgeLimit` reads at each timed run's start and end:
above the core count, a planted reference Mac's budgets read INCONCLUSIVE and 568's suite fails. So the criterion's
"fit reference Mac" is read as macOS with a one-minute load at or below the cores. `lane568.test.mjs` skips with an
`INCONCLUSIVE:` note, never passes, when the machine isn't fit before the run, or when 568's suite failed and its
output carries #568's own reason for a loaded run (`load N at a run's start or end is above the C cores`, or the load
can't be read). The suite's other failures fail the test.

The test runs a file `scripts/lanes.mjs` lists as timed (`tests/acceptance/568/`), so `lane568.test.mjs` belongs in the
`timed` list too; I can't edit `lanes.mjs` from here, so the implementing change should add it there.

## The base

`BASE-FAILURE.txt` holds the run on the base, the load it ran at, and the run of `affected.test.mjs` on the twin.
Both `before.test.mjs` tests fail on the base at their assertions. `affected.test.mjs` passes there, as described above,
and fails on the twin. `lane568.test.mjs` skipped INCONCLUSIVE on the base, because the load stayed above the cores
through 40 tries. The 568 suite it runs, run directly on the base below the cores, fails 3 of its 5 tests with the real
fingerprint in place of the planted one. A rerun at a fit load is still owed.
