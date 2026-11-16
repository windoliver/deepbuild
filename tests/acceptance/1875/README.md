# Acceptance tests for #1875: affected.mjs reads PASS only when it ran what the change reaches

I drafted these tests blind from these sources:

- issue #1875, its text on 2026-11-14
- `docs/parallel-proof.md`, sections 6, 7 and 7a
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `c740dede7`, which has no implementation

At the base I also read `scripts/affected.mjs`, `lanes.mjs`, `proof-guard.mjs` (its `namedByConfig`) and
`proof-change.mjs`, `vitest.config.ts`, `tests/vitest-setup.ts`, `tests/affected.test.mjs`, and `tests/acceptance/1114/`
and `1115/` for their conventions. The helpers are written here and imported from no other suite. Per AGENTS.md, the
implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (affected.mjs imports typescript)
node --test 'tests/acceptance/1875/*.test.mjs'
sh tests/acceptance/1875/twins/run.sh <twin>   # one planted wrong program, e.g. skip-passes
```

There are 4 tests. They're offline and take about 8 s on an idle Spark, or about 45 s at load 300. On the base, 3 fail
at their assertions, as `BASE-FAILURE.txt` shows. AC4's test passes there, as it must, since the base already reads
PASS for a plain change. Its wrong program is the twin `all-inconclusive`. `BASE-FAILURE.txt` also lists each twin's
run and which tests caught it.

**Every test points `HOME` at a temporary folder** and unsets every `DEEP_*` variable (`DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `DEEP_PREFLIGHT` and the rest), `NODE_TEST_CONTEXT` and `CARGO_TARGET_DIR`. Each process a test
starts gets its own process group, and the test stops that group by its PID when it ends.

## Criteria to tests

Each criterion's ID is `#1875.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag. All
four tests are in `affected.test.mjs`.

| Criterion | What the test requires | Twins it catches |
|---|---|---|
| AC1 `#1875.801bc708` A change that reaches only a file in `byHand`, such as one under `tests/acceptance/685/`, reads INCONCLUSIVE, naming the file … | `lanes.mjs` `byHand` holds `tests/acceptance/685/`. The tree holds a passing probe at `tests/acceptance/685/probe-1875.test.mjs`, and `--list` on that path selects it. Then `affected.mjs <that path>` ends on a line starting `INCONCLUSIVE affected: `, exits non-zero, and some other line starting `INCONCLUSIVE` names the file | `skip-passes` (the issue's: prints `SKIP`, reads PASS), `unnamed` |
| AC2 `#1875.f6c302f9` A change that reaches only a file in `ownLane` reads INCONCLUSIVE, naming it | The same, for `lanes.mjs` `ownLane`'s first entry (at the base, `tests/acceptance/684/lean.test.ts`), with the probe at that path | `own-lane-passes`, `unnamed` |
| AC3 `#1875.e267e730` A change to `tests/vitest-setup.ts` prints `INCONCLUSIVE tests/vitest-setup.ts feeds every suite`. On main … it selects one file | Before: in a tree with the merge base's `scripts/`, `--list tests/vitest-setup.ts` selects exactly one file, `tests/vitest-setup.test.mjs`. After: in a tree with this checkout's `scripts/`, `affected.mjs tests/vitest-setup.ts` prints a line starting `INCONCLUSIVE tests/vitest-setup.ts feeds every suite`, ends `INCONCLUSIVE affected: ` and exits non-zero | `global-only` |
| AC4 `#1875.aeda0f53` A change that reaches no by-hand, own-lane, timed or slow file can still read PASS | `affected.mjs tests/fixture-1875/plain.test.mjs` (a passing probe in no list) ends `PASS affected: … 1 passed`, exits 0 and prints no other `INCONCLUSIVE` line | `all-inconclusive` |

## The surface (my choice where the issue leaves it open)

- **"Reads INCONCLUSIVE"** means the summary, the last line containing ` affected: `, starts `INCONCLUSIVE`, and the
  exit status isn't 0. Nothing unrun passes.
- **"Naming the file"** means a line other than the summary starts `INCONCLUSIVE` and contains the file's path. The
  wording after the path is the implementer's. A `SKIP` line doesn't count.
- **"Reaches only"** is the path given to `affected.mjs` as the change, the way the base reads paths. `--list` must
  select it, so the test isn't vacuous.
- **The by-hand file** is a probe under the `tests/acceptance/685/` folder entry, as the issue names. **The own-lane
  file** is `ownLane`'s first entry at the base. The tests use the tree's real `lanes.mjs` lists. No list is planted,
  since the issue gives no reason to.
- **AC3's line** is matched as a prefix. The base prints `INCONCLUSIVE <path> feeds every suite; run npm run preflight`
  for every file in `EVERY`, and the criterion names only the part before the `;`.
- **AC3's "on main"** is the merge base's `scripts/`, from `git archive $(git merge-base HEAD origin/main) scripts`,
  as 1114 reads "before". On the base that's the base itself. The issue names `a9d2e682`, so a merge base that
  already holds a fix would fail the "before" half. That's intended: it's then no longer main as the issue describes it.
- **The setup file's own test.** In the tree, `tests/vitest-setup.test.mjs` is a passing probe that names
  `tests/vitest-setup.ts` by path, as the real one does, in its first comment. The real one runs vitest on fixtures,
  and its own result isn't what AC3 is about. `vitest.config.ts` and `tests/vitest-setup.ts` are this checkout's real
  files, so a fix that reads the setup files from the config as `namedByConfig` does finds the real `setupFiles` entry.
- **AC4's "can still read PASS"** also requires the plain file to have run (`1 passed`), so a run that runs nothing
  can't pass it.

## The affected.mjs tree

`affected.mjs` runs in a scratch git repository that holds a copy of `scripts/` (this checkout's, or the merge base's
for AC3's "before"). The copy has an empty `known-failures.json`, and the lint lane's own scripts (`lanes.mjs`
`checks`, `lint`, each `scripts/*.mjs` it names) are replaced by stubs that pass. `node_modules` is linked from this
checkout, and a `cargo` stub on `PATH` reports no crates from `metadata`. The tree also holds the test's probe files,
and everything is committed.

## What the tests can't see

- **A hard-coded setup path.** An `affected.mjs` that adds `tests/vitest-setup.ts` to `EVERY` by name passes AC3. The
  Scope wants the setup files read from the runner config the way `namedByConfig` reads them, but no criterion says
  so, so no test checks another config's setup file. The twin `global-only` reads the config but misses its
  `setupFiles` key, and AC3 catches that.
- **Whether a by-hand or own-lane file ran.** The criteria say how the run reads, not whether the file was run. The
  probes pass either way.

## Files

- `helpers.mjs`: the sandbox, launching in process groups, `lanes.mjs`'s lists read by a child process, the merge
  base's scripts, the affected.mjs tree, and the summary readers.
- `affected.test.mjs`: the four tests.
- `twins/*.patch`, `twins/run.sh`, `twins.json`: the planted wrong programs. Each patch applies to the base's
  `scripts/affected.mjs` and holds the blind job's own small implementation of #1875 with one fault. `run.sh` applies
  one in a throwaway copy whose own commit, its `origin/main`, holds the unpatched scripts, and runs the suite there.
  The patches are diffs, not the file copies 1114 keeps, so 5 twins don't add 2,600 lines of copied `affected.mjs`.
  - `skip-passes` (AC1): a by-hand file prints only its `SKIP` line and doesn't change the state, so it reads PASS.
    Own-lane files and the setup file are handled.
  - `unnamed` (AC1, AC2): the run reads INCONCLUSIVE, but its line gives only a count, `INCONCLUSIVE 1 selected file
    was left to a person or a lane of its own`, never the file.
  - `own-lane-passes` (AC2): an own-lane file prints only `SKIP`, so it reads PASS.
  - `global-only` (AC3): the setup files are read from the config's `globalSetup` only, not `setupFiles`.
  - `all-inconclusive` (AC4): it reads INCONCLUSIVE whenever any test file was selected.
- `BASE-FAILURE.txt`: the run on the base, each twin's run and the reference's run, with paths redacted.

No fixture holds a secret or personal data.
