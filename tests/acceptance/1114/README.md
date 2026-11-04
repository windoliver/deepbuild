# Acceptance tests for #1114: timed tests run only under the timed grant (T9a)

I drafted these tests blind from these sources:

- issue #1114, its text on 2026-11-03
- `docs/parallel-proof.md`, sections 6, 7, 10 and 12
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `34fe4930`, which holds `d2623d97` and has no implementation

At the base I also read `scripts/lanes.mjs`, `affected.mjs`, `proof-runs.mjs`, `throttle.mjs`, `proof-guard.mjs`,
`proof-change.mjs` and `proof.mjs`, and `tests/acceptance/1113/` for its conventions. The helpers are written here,
never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes
to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (affected.mjs and the grep import typescript)
node --test 'tests/acceptance/1114/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. There are 7 tests. All are
offline and run on real processes: the real `throttle.mjs`, `affected.mjs` and `proof.mjs`, and probe test files
that note when they ran and under which grant. Two things are stubbed, both at boundaries #1114 doesn't own:

- `cargo`, in the affected.mjs tree. Its `metadata` reports no crates.
- the lint lane's own scripts.

The suite takes about 13 s on the Spark. On the base, 6 fail at their assertions, as `BASE-FAILURE.txt` shows. AC5's
test passes there, as it must: on the base, its "before" and "after" are the same scripts. Its wrong program is the
twin `timed-fail-inconclusive`. `BASE-FAILURE.txt` also lists the planted wrong programs and which tests caught each.

**Every test points `HOME` at a temporary folder**, so the lock table and log are the sandbox HOME's
`.deepbuild/throttle/`, never the real one. The sandbox also unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`,
`NODE_TEST_CONTEXT`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`, `CARGO_TARGET_DIR`, `DEEP_PROOF_ISSUES` and
`DEEP_APPROVERS`. Each process a test starts gets its own process group, and the test stops that group by its PID
when it ends. A test that needs a top-level timed grant (AC2, AC4) is skipped when the one-minute load is already
at or above the cores, since no such grant can start then. The skip message starts `INCONCLUSIVE`, and a skip is
never a pass.

## Criteria to tests

Each criterion's ID is `#1114.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of
its name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1114.9fc6be33` With no flag, timed files … are not run and the summary is INCONCLUSIVE, listing them; with no timed file …, PASS remains possible | `affected.test.mjs` | `--list` selects both probes. Then `affected.mjs <timed> <plain>` never starts the timed probe, runs the plain one once, and exits non-zero. Its summary line starts `INCONCLUSIVE affected: `, and some line starting `INCONCLUSIVE` names the timed file. Then `affected.mjs <plain>` runs the plain probe, ends `PASS affected: ` and exits 0 |
| AC2 `#1114.dc4376fb` With `--timed`, the throttle log shows the timed grant around the timed files | `affected.test.mjs` | `affected.mjs --timed <timed> <plain>` runs the timed probe once. Its `DEEP_THROTTLE` is `timed:<id>`. The log shows that grant `granted` at or before the probe started and `released` at or after it ended. The plain probe runs, and the summary is `PASS affected: ` |
| AC3 `#1114.f3e38214` Every file calling `environmentProblem(`, … is in the `timed` list, checked by a test that greps the tree; a planted list missing one fails, naming the file | `timed-list.test.mjs`, two tests | (a) `lanes.mjs` exports `timed`, an array of strings, and every file the grep finds is covered by it. (b) For the grep's first and last file, a planted list (the real one without the entries covering that file) fails the same check at its assertion, with a message naming the file |
| AC4 `#1114.52a78dd9` In the before and trace lanes the timed set's spawn starts only after its grant, and a 14-minute grant wait leaves its full 20-minute `TIMEOUT` | `lanes.test.mjs`, two tests (one runs `proof.mjs before`, one `proof.mjs trace`) | A build holder from another chain holds for 3 s while the lane runs. The timed probe runs on both the merge base and the change. Each of those runs is inside a timed grant the log shows (`DEEP_THROTTLE=timed:<id>`, granted before it started, released after it ended) and starts no earlier than the holder's end. No process between the proof lane and the probe is a `throttle.mjs`. The grant's logged `wait` is at least 14 min. The untimed probe runs on both, outside the timed set (its `DEEP_THROTTLE` is no `timed:` value). The output has no `INCONCLUSIVE no grant` and no `was stopped after` |
| AC5 `#1114.f626edec` Failures on main equal today's: a run on main before and after the change lists the same FAIL ids | `failures.test.mjs` | One set of tests (a failing timed file, a failing untimed file main already knows, and a passing file) runs as `affected.mjs --timed <the three paths>` twice: in a tree with the merge base's `scripts/` ("before") and in one with this checkout's ("after"). The before run lists both failures, and the after run lists the same sorted `FAIL`, `NEW FAIL` and `KNOWN` ids (below) |

## The surface (my choice where the issue leaves it open)

- **The flag is `--timed`**, spelled as the issue spells it, given to `node scripts/affected.mjs` among its paths.
- **The `timed` list** is a named export `timed` of `scripts/lanes.mjs`. It's an array of strings, each a file or a
  folder ending in `/`, matched the way `alone` matches: a folder covers every file under it, and anything else
  covers only itself.
- **"Listing them" (AC1)** means that each unrun timed file appears on a line of the output that starts
  `INCONCLUSIVE`, as `INCONCLUSIVE <file> › (file): …`. The last line containing ` affected: ` is the summary, and
  it starts with its state, as at the base.
- **"Not run"** means the file's test never started, and **"PASS remains possible"** means the summary's state is
  `PASS` with exit status 0. Without `--timed`, AC1's mixed run must exit non-zero, since nothing unrun passes.
- **"The timed grant around the timed files" (AC2)** is read from the base's throttle log (T5's, unchanged by T9a).
  It's JSON lines under `~/.deepbuild/throttle/log`, with `at`, `event` (`granted`, `released`), `class` and `id`.
  The timed file's own `DEEP_THROTTLE` names the grant. I also require the summary to be `PASS` with `--timed`, since
  nothing is left unrun.
- **The affected.mjs tree.** `affected.mjs` runs in a scratch git repository. It holds a copy of this checkout's
  `scripts/`, with an empty `known-failures.json` and with the lint lane's own scripts (`lanes.mjs` `checks`, `lint`,
  each `scripts/*.mjs` it names) replaced by stubs that pass. `node_modules` is linked from this checkout, and a
  `cargo` stub on `PATH` reports no crates. The tree also holds two probes:
  - The timed probe sits at the path of a real `.test.mjs` file the grep says must be timed, the first in sorted order
    (at the base, `tests/acceptance/568/judge.test.mjs`). So a correct `timed` list covers it whether it names the
    file or a folder. Its content is the probe's own.
  - The plain probe sits at `tests/fixture-1114/plain.test.mjs`, which no timed list names.
  So AC1, AC2 and AC4 also rely on AC3's list covering that one file.
- **The before and trace lanes** run this checkout's `node scripts/proof.mjs before`, and `... trace`, in a scratch
  repository. Its base commit holds a copy of this checkout's `scripts/`, so its `lanes.mjs` is the change's own,
  with the change's `timed` list. Its change commit, `Part of #9114` (a planted issue given through
  `DEEP_PROOF_ISSUES`), makes `src/value.mjs` return 2. It adds two tagged probes: the timed one at the path above, and
  `tests/acceptance/9114/plain.test.mjs`. Each probe asserts the value is 2, so each fails on the merge base at its
  assertion and passes on the change. The tags are worked out at runtime, so no file here carries them.

## The grep (AC3)

- **Which files.** It reads the test files git lists in this checkout, tracked or untracked but not ignored, as
  `lanes.mjs` `testPaths` and `proof-change.mjs` `isTestFile` declare them: `*.test.{mjs,js,ts}` under `tests/`,
  `packages/**/test/`, `packages/**/*.test.ts` or `crates/*/tests/`, outside `node_modules`. Live and by-hand files
  count too, since the criterion says every file. Helpers and scripts aren't test files, so a file that only defines a
  helper (`tests/acceptance/*/helpers.ts`, `scripts/benchmark.mjs`) is left out.
- **What a call is.** A file calls a helper when its own code, parsed by TypeScript, holds a call expression whose
  callee is one of `environmentProblem`, `judgeTiming`, `judgeLimit`, `referenceMacProblem` or `notReference`, or a
  property of that name (`helpers.judgeTiming(...)`). A function's declaration isn't a call. Neither is a name in a
  comment or inside a string, such as a fixture's code a test writes out (`tests/acceptance/1113/before.test.mjs`)
  or a search string (`tests/preflight.test.mjs`). That is my reading of the issue's "at their own call site". At
  the base the grep finds 90 files.
- **The planted list.** `assertTimed(list)` in `helpers.mjs` is the check, and it takes the list, so a planted one runs
  through the same code. The test removes every entry covering a chosen file and requires the check to fail at an
  `AssertionError` whose message names that file.
- The issue's Scope also seeds files that gate on a helper's `status === 'INCONCLUSIVE'`, such as
  `tests/acceptance/365/budgets.test.ts`. No criterion names that rule, so no test checks it. That file calls
  `judgeLimit`, so the grep requires it anyway.

## What the long time scales became (AC4)

A 14-minute wait and a 20-minute `TIMEOUT` aren't waited out. The proof combines three readings:

1. **The spawn starts after the grant.** Every run of the timed probe starts no earlier than the outside holder's end,
   and inside a timed grant the log shows granted before it started. The holder holds for 3 s.
2. **The wait is outside the spawn.** The probe records its ancestors, from `ps`. No process between the proof lane
   (the PID the test started) and the probe is a `throttle.mjs`. Node's `spawnSync` timeout counts from the spawn.
   So a spawn that starts only once its grant is held keeps its whole `TIMEOUT`, however long the wait was. A spawn
   of `throttle.mjs timed -- node --test …` would wait inside its own timeout, and this reading catches it (twin
   `wraps-spawn`).
3. **A 14-minute wait ends in a grant.** The grant's logged `wait` is at least 14 minutes (section 6 says 15), so a
   14-minute wait ends in a grant, not in `INCONCLUSIVE no grant`.

**What the test can't see:** a spawn that starts after its grant but has a shortened `TIMEOUT`. A `TIMEOUT` below 20
minutes would show only in a run of 20 minutes, or by reading `proof-runs.mjs`.

## AC5, before and after

The test reads "a run on main before and after the change" as one fixed set of tests run under two programs:

- **Before** is the merge base's `scripts/`, from `git archive $(git merge-base HEAD origin/main) scripts` in this
  checkout.
- **After** is this checkout's `scripts/`.

Each set of scripts goes into its own affected.mjs tree, as above. Both trees hold the same three files:

- a failing timed probe, at the grep-required path the other tests use;
- a failing untimed probe, `tests/fixture-1114/fails.test.mjs`, which both trees' `known-failures.json` names, so it
  reads `KNOWN`;
- a passing one, `tests/fixture-1114/plain.test.mjs`.

Both runs are `affected.mjs --timed <the three paths>`. The merge base's `affected.mjs` has no `--timed` and ignores
it, running every file as it always has. An implemented one ignores it too after the change merges, so the test still
compares like with like. The ids are the `<file> › <test>` of every line starting `NEW FAIL `, `KNOWN ` or `FAIL `,
sorted. The `FAIL affected:` summary line is no id: there's no ` › `.

The test requires two things:

- The before list holds both planted failures, so it isn't vacuous.
- The after list equals the before list.

**On the base the test passes**, since before and after are then the same program. Its wrong program is the twin
`timed-fail-inconclusive`: an `affected.mjs` whose `--timed` run reads a timed file's failure as INCONCLUSIVE, so a
failure main has drops out of the list. The test skips as INCONCLUSIVE on a machine loaded past its cores, as AC2's
does.

**What the test can't see:** failures on the real main. It uses planted failures on a fixture, so a difference that
shows only with main's own suites (a real file that runs only under the grant, say) is out of its reach. A by-hand
run gives that reading: `node scripts/affected.mjs --timed <paths>` on main before and after the change, on the same
machine and paths, comparing the sorted ids the same way.

## Files

- `helpers.mjs`: the sandbox, launching, probe files, the throttle log reader, the grep (`mustBeTimed`,
  `assertTimed`), `lanes.mjs`'s lists read by a child process, and the affected.mjs tree.
- `affected.test.mjs`: AC1 and AC2.
- `timed-list.test.mjs`: AC3, two tests.
- `lanes.test.mjs`: AC4, the before lane and the trace lane.
- `failures.test.mjs`: AC5, the merge base's scripts against this checkout's.
- `twins.json`, `twins/`: the seven planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base and the runs on the planted programs, with paths redacted.

No fixture holds a secret or personal data. Issue 9114 is made up.
