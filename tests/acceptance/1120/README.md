# Acceptance tests for #1120: Stryker builds only the mutated package and its dependents, with the same kills (T6)

Drafted blind from issue #1120 (its text as handed to this job on 2026-11-19), `docs/parallel-proof.md` (sections 4, 5
with the T6 bullet, 10, 11 and 12), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit
`b4a2049e8` (origin/main), which holds no scoped build. At the base I also read `scripts/proof.mjs`,
`scripts/proof-runs.mjs` (`mutation`, `strykerRun`, `undoBuild`, `build`, `changeCopy`, `prepareRuns`, `executed`),
`scripts/bays.mjs` (`claimPair`, `refusal`), `scripts/proof-change.mjs` (`criterionId`) and the suites
`tests/acceptance/1118/`, `1114/` and `1123/`, whose sandbox and fixture these follow. The helpers are written here and
import nothing under test. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind
redraft by this job.

Run with:

```sh
npm ci                                       # once, if node_modules is missing (typescript, StrykerJS)
node --test 'tests/acceptance/1120/*.test.mjs'
```

They need `git`, `npm` and `node` 24. They are offline: the fixture's only installed package besides its own workspaces
is `vendor/typescript`, a folder whose `tsc` runs this checkout's `node_modules/typescript`, and npm runs with
`npm_config_offline=true`. **Cost**: one proof run of the fixture, 12-25 s on an 8-core Mac. At the base the one test
fails at its assertion (`BASE-FAILURE.txt`).

**The test points `HOME` at a temporary folder**, so the bays are `<HOME>/deepbuild-bays/<k>/` and the throttle table is
under `<HOME>/.deepbuild/`, never the real ones. The sandbox unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `DEEP_BIN_DIR`,
`DEEP_APPROVERS`, `NODE_TEST_CONTEXT`, `NODE_V8_COVERAGE`, `__STRYKER_ACTIVE_MUTANT__` and the `npm_*` variables an npm
parent sets. The proof runs in its own process group; one that outlasts 10 minutes is stopped by that group's PID, and
the sandbox stops the group when the test ends.

## The surface (my choice where the issue leaves it open)

The issue names no new command, option or output line ("no new option"), so the test reaches the code only as the CLI
the mutation lane already is, run from the fixture's worktree with that worktree's own `scripts/` (a copy of this
checkout's):

```sh
node scripts/proof.mjs mutation         # cwd: a worktree of the machine's repository
```

- **The killed and survived sets** are read from the lane's own output, as it prints them at the base: the state line
  `PASS mutation: <N> mutants of the added lines, <M> surviving on a line a tagged test executes`, and each survivor's
  `SURVIVED <path>:<line> (<mutator>)` line with the `-`/`+` diff lines under it. With the same mutants counted and the
  same survivors (diffs included), the killed set is the same too. Every mutant of the fixture lies on a line the tagged
  tests execute (below), so every survivor is printed.
- **Which packages are built per mutant** is not printed by the lane, and the issue names no record of it. I chose the
  two least-guessing observations, both of what the fixture itself sees, never a line the proof would add:
  1. **A build log.** Each fixture package's `build` script is the repository's (`tsc -p tsconfig.json`) after
     `node ../../tools/mark.mjs`, which appends `{package, mutant}` to `$FX_BUILDS` when it runs with
     `__STRYKER_ACTIVE_MUTANT__` set, as StrykerJS sets it for each mutant's command.
  2. **Dist stamps.** Each run of a tagged test writes, to `$FX_RUNS`, the active mutant and the `mtimeNs` of each
     package's dist entry file in its copy.
  The test asserts only absences: the unrelated package `c` has no log line under any mutant, and its dist stamp is
  one value across every mutant's test runs. So an implementation that builds the scope some other way than npm
  scripts (`tsc -b packages/<p>`, say) still passes, and neither reading can fail a scope that is right. (At high
  StrykerJS concurrency all mutants' test runs can see the same last stamp, so on many cores the log is the observation
  that catches an unscoped build; at the base on 8 cores both do.)
- **"Dependents" are proven by the kills**, not by a stamp: the tests read only b's and d's dist, which compile a's
  source into themselves, so a scope that leaves a dependent out leaves its dist holding the change's code without the
  mutants, and the survivors change.

### The fixture

As in #1118's suite: the machine's repository is `<HOME>/deepbuild`, holding a copy of this checkout's `scripts/`, with
`origin` at `https://github.com/windoliver/deepbuild.git` (set, never fetched) and `refs/remotes/origin/main` pinned at
the merge base by `update-ref`; the proof's root is the linked worktree `<HOME>/deepbuild/.claude/worktrees/w`, so the
proof gets a bay pair. `node_modules` in both links to this checkout's (for typescript and
`<root>/node_modules/.bin/stryker`) and is ignored by git (`node_modules` with no slash, so the link isn't an untracked
file).

The merge base: an npm workspace (`packages/*`) with a lock made offline by npm, and four packages:

- `a`: `grade(n)`, always `'small'`.
- `b` and `d`: each depends on `@fx/a` in its `package.json` and compiles `../a/src/f.ts` into its own dist
  (`rootDir: ".."`), exporting `label(n)` = `'b:' + grade(n)` and `tag(n)` = `'d:' + grade(n)`.
- `c`: `export const c = 1`; it depends on nothing and nothing depends on it.

The change, one commit naming the planted issue #9120 (its text in `DEEP_PROOF_ISSUES`): adds `if (n > 10) return
'big';` to `grade`, and the tagged tests `tests/acceptance/9120/b.test.mjs` (`label(11)` is `'b:big'`) and `d.test.mjs`
(`tag(11)` is `'d:big'`, `tag(3)` is `'d:small'`), with their helper `tests/helpers/runs.mjs`. Both tests fail on the
merge base, so they run as the grouped StrykerJS run. The helper also imports `packages/a/src/f.ts` itself (Node's type
stripping) and calls `grade`, in a `try`, asserting nothing, so the lane's coverage counts the added line as executed and
prints its survivors; every assertion reads a dependent's dist.

StrykerJS makes 5 mutants of the added line. The unscoped reference run (the base's lane, `BASE-FAILURE.txt`) kills 4
and keeps `n >= 10`, which no test checks. `if (true)` is killed only through d's dist, so a scope missing d keeps two;
a scope with neither dependent keeps all five (the twin).

## Criteria to tests

Each criterion's ID is `#1120.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out on the issue's text.

| Criterion | Test | What it asserts |
|---|---|---|
| AC1 `#1120.04bc4a3c` every Stryker run on the fixed input finishes under its 80-minute cap | none: **hand check** | below |
| AC2 `#1120.1f2e20de` the killed and survived sets equal those of an unscoped reference run | `scope.test.mjs` | On the fixture: the tagged tests ran under at least two mutants; `c` was built under no mutant (build log) and its dist wasn't rewritten between mutants' test runs (stamps), so the run is the scoped one; the lane's line is `PASS mutation: 5 mutants of the added lines, 1 surviving …` and its survivors are exactly the reference's one (`EqualityOperator`, `n >= 10`, with its diff) |
| | **hand check** on the fixed input | below; the fixture test doesn't replace it |
| AC3 `#1120.04a52cab` mutants hitting the 60 s timeout are listed and excluded from the comparison | none: **hand check** | below |

The test fails at the base at its first scope assertion (`c` built under mutants 0-4), at its assertion
(`ERR_ASSERTION`). A planted correct scope passes it and the twin `without-dependents` fails it at the kill-set
assertion (`BASE-FAILURE.txt`, `twins/README.md`).

## Hand checks on the fixed input (not automated)

AC1, AC3 and AC2 itself are measurements on the issue's fixed input that take hours (the reference run is the unscoped
lane with its cap lifted), on a pinned commit pair and CPU limit no test here can stand up. The procedure, from the
issue's Scope and Proof, on Spark and on the Mac (`Runs on: Spark + Mac`):

1. **The input.** A measurement worktree at PR #881's head `713bc483`, its merge base `f41a5b3e` (`Closes #881`, tagged
   tests and twins under `tests/acceptance/881/`, changes `packages/extension-host/src/{host,trust}.ts`; two packages
   depend on `extension-host`). Set `refs/remotes/origin/main` to `f41a5b3e` (`git update-ref`) and delete the
   timing-gated `latency.test.ts` in a commit of its own. Pin `availableParallelism()` to 2 by an environment-level CPU
   limit (a cgroup or container CPU limit on the Spark; what the Mac uses), and name that limit in the record.
2. **The scoped run.** With the implementation, `node scripts/proof.mjs mutation` in that worktree, below the load gate
   (load under the core count, as in section 11), using only 881's untimed tagged tests. Save its output and each
   StrykerJS run's JSON report.
   - **AC1**: each StrykerJS run of the lane (one per unproven test, plus the grouped run) ends with a report and no
     `StrykerJS was killed by … (ETIMEDOUT)` line; record each run's wall time against its cap `4 * TIMEOUT` (80 min).
3. **The reference run.** The same input and conditions with the base's unscoped build (every workspace package per
   mutant) and only the StrykerJS cap (`4 * TIMEOUT` in `strykerRun`) lifted, nothing else changed. Save its reports.
4. **The comparison.** Diff the two reports' mutants by `path:line:column:mutator:replacement` (the lane's own ID).
   - **AC3**: list every mutant whose status is `Timeout` (the 60 s `timeoutMS`) in either run, and leave those out of
     both sides.
   - **AC2**: the remaining `Killed` sets are equal and the `Survived` (and `NoCoverage`) sets are equal.
5. **The Proof.** Save the two reports and their diff, and first the twin `without-dependents` (or the implementation
   with its dependents left out) run on the same input, shown changing the kill set.

## Readings where the issue leaves a choice

- **"Dependents"** is read as the packages whose `package.json` `dependencies` name the mutated package (the reverse
  workspace graph, as in the repository's packages). The fixture has only direct dependents, as #881's input has, so
  the test doesn't decide whether transitive dependents are built.
- **The mutated package itself** being rebuilt per mutant isn't asserted: no test reads its dist, and with a `tsc -b`
  build an unchanged output may legitimately not be rewritten. Its dependencies' builds aren't asserted either way.
- **The bay branch.** T6 is measured in a worktree of the machine's repository, so the fixture is one, and the proof
  runs the mutants in the change bay. The temporary-copy path (a scene repository) isn't tested.
- **The reference values** in `scope.test.mjs` are the base lane's on this fixture with StrykerJS 10.0.0 from the lock.
  A StrykerJS upgrade that changes its mutators changes them; that is a redraft, not an edit.
- **Not tested** (scope, not criteria): the signed approval tag the guard requires for `proof-runs.mjs`, `undoBuild`
  still restoring every touched source file (unchanged code at the base, exercised by every mutant's command here), and
  wall-time readings.

## Files

- `helpers.mjs`: the sandbox, the fixture (the machine's repository, its worktree and change, the build log and the
  tagged tests' helper), running the proof, and the readers of the lane's output.
- `scope.test.mjs`: AC2 on the fixture.
- `twins.json`, `twins/README.md`, `twins/without-dependents/scripts/proof-runs.mjs`: the Proof's planted scope without
  dependents.
- `BASE-FAILURE.txt`: the run at the base, and the planted correct scope and the twin checked against the test.

No fixture holds a secret or personal data.
