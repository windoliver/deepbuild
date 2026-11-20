# Acceptance tests for #2665: ceilings only move down, a count can be one, and slack is seen

I drafted these tests blind from these sources:

- issue #2665, as saved verbatim for this job (`gh issue view 2665` showed the same body)
- `docs/technical-design.md`: Later, as extensions (the R4 line); Numbers version 0 has to hold (Every task carries its own
  budgets; The reference Macs); How we know version 0 works (Wrong programs; The edit guard; Dogfooding; Tests written
  first, by a job that never sees the code)
- `docs/parallel-proof.md`, sections 6 (the throttle's timed grant and the window) and 12a (Budget windows)
- AGENTS.md
- the base commit `8df3e47e2`, which has no implementation

At the base I also read `scripts/benchmark.mjs`, `budget-window.mjs`, `perf.mjs`, `release-budgets.mjs`, `throttle.mjs`,
`affected.mjs`, `lanes.mjs`, `proof-change.mjs`, `proof-guard.mjs`, `proof-runs.mjs` and `count-children.c`,
`tests/fixtures/approver.mjs`, and `tests/acceptance/1116/`, `1874/` and `1981/` for their shape. The helpers are written
here; the only module imported from outside this folder is `tests/fixtures/approver.mjs`, the repo's shared stand-in for
a person's security key. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind
redraft by this job.

Run them with:

```sh
npm ci --ignore-scripts                   # once: scripts/proof-change.mjs and affected.mjs import typescript
node --test 'tests/acceptance/2665/*.test.mjs'
```

Three files, six tests, three scenes, each a fixture repository measured by a real window through
`node scripts/throttle.mjs window` in the fixture's checkout, as `tests/acceptance/1116/` runs one. Each scene runs once,
on its file's first test's turn. On a Mac17,10 (18 cores) at 1-minute loads of 13 to 311 from other sessions, the
lowering, refusals and count scenes took 33 to 75 s, 19 to 46 s and 7 to 31 s against my throwaway window, and the whole
suite 4 s against the base, which refuses every measured commit before running anything.

**Lanes.** By `scripts/lanes.mjs`'s own reasons the suite belongs on neither list: no file builds with cargo, holds a
resource another suite uses (each sandbox has its own `HOME`, so its own throttle table, caches and records), or gates on
the machine's load or fingerprint (both are stand-ins), and each file's run took under two minutes here (the longest,
86 s). It runs in the
parallel `node --test` block, as 1116, 1874 and 1981 do. If `lowering.test.mjs`'s fastest recorded run on the
implementation passes two minutes, it goes on `slow`. `node scripts/affected.mjs --list scripts/budget-window.mjs`
selects all three files.

## The sandbox and the stand-ins

All at boundaries the repo doesn't own, as 1116's are:

- **`HOME`** is a temporary folder per scene, and so are `XDG_CACHE_HOME`, `TMPDIR`, `RUSTUP_HOME` and `CARGO_HOME`.
  A window started under `node --test` keeps its throttle table under that `HOME` (section 6, tables of a test's own),
  so it never drains the machine's. The sandbox unsets `DEEP_THROTTLE`, `DEEP_THROTTLE_TABLE`, `DEEP_PERF_LOCK`,
  `NODE_TEST_CONTEXT`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`, `CARGO_TARGET_DIR`, `DEEP_PROOF_ISSUES`, `DEEP_APPROVERS`,
  `DEEP_GATES`, `DEEP_BIN_DIR`, `DEEP_PROOF_VITEST_REPORT`, `GIT_DIR` and `GIT_WORK_TREE`. This checkout's
  `node_modules` is linked into the sandbox folder, above every tree a window reads, so `typescript` resolves.
- **`gh`**, first on `PATH`: it records every call and answers only `issue create` (the follow-up a miss files). The
  fixture's commits name no issue. Nothing touches GitHub.
- **The machine.** `sysctl`, `pmset`, `osascript` and `sw_vers`, first on `PATH`, are what `fingerprint()` reads. Two
  scenes stand in a Mac15,7 (Apple M3 Pro, 36 GB) on mains, Low Power Mode off, thermal state nominal; the count scene a
  Mac14,2 (Apple M2, 8 GB), which isn't a reference Mac. Any other `sysctl` goes to the real one.
- **The load.** Each node process starts with `--import` of a module that pins `os.loadavg()`: `scripts/throttle.mjs`
  reads 2, so a window's grant starts; the window and everything else read the scene's load, 2, or 999 in the count
  scene. `sysctl -n vm.loadavg` answers the scene's load. The cores stay the machine's.
- **`npm` and `cargo`**, first on `PATH`, exit 0: a fixture has nothing to warm, and `cargo metadata` printing nothing
  leaves `affected.mjs` unable to place any task, so every task runs on every commit (the base's #1981 fallback). Every
  fixture command is `/bin/sh -c '…'` and names no file of the tree, so it would run on every commit under a selection
  that worked too.
- **`/usr/bin/time -l`** is the test's own reading of a fixture command, taken before the fixture is written, to set
  its ceilings: its peak resident bytes, and its instructions retired.

Every process a scene starts has its own process group, which the scene stops by its PID when it ends. Nothing is
killed by name or port.

## The surface (my choice where the issue leaves it open)

Everything 1116, 1874 and 1981 chose stays: how a window opens, the mark, which commits it measures and against which
merge base, the record's place (`~/.deepbuild/lanes/`, a JSON file with a `tests` list) and its `commit`, `base`,
`unmeasured` and `notReached`. The tests find a commit's record by its `commit` field and never read its file name or
`lane`. The time and memory limits stay as the base judges them: `judgeLimit` on five runs after one warm-up, counting
only on a reference Mac on mains, with Low Power Mode off and the thermal state nominal, at a load below the cores.

### A ceiling on a count

A count ceiling is a key of a task's `limits` in `benchmarks/budgets.json`, beside `p50Ms`, `p95Ms` and `peakBytes`:

```json
{ "id": "counted", "command": ["/bin/sh", "-c", "…"], "margin": 0.5,
  "limits": { "instructions": 986356055, "p50Ms": 60000 }, "initialReason": "…" }
```

- **`instructions`**: instructions retired, as the perf lane already counts them: `measure`'s rounds, each counting the
  command and every child it waits for through `scripts/count-children.c`. Its readings are the change side's counts
  from the window's rounds (20 here). The tests need at least five.
- **`report.<name>`**, for a number a task's own report names, such as `report.objects_made`: the number `<name>` in the
  report, its command's last stdout line that is a JSON object, as `judgeTargets` reads one. No test holds it: no
  criterion names a report's number.

**How a count ceiling is judged.** On any machine: no fingerprint, power, thermal or load condition reaches it. FAIL when
every reading is over the ceiling, PASS when every reading is at or under it, INCONCLUSIVE otherwise. A count that can't
be read is `null` among the readings, never 0, and any `null` makes the ceiling INCONCLUSIVE.

### Which ceiling a commit is judged against

A task its merge base holds is judged against the ceilings of the merge base's `benchmarks/budgets.json`, whatever the
commit's own tree holds: a change never moves its own budget. A task new in the commit is judged against its own. So a
commit that lowers a ceiling is judged against the old value, and a commit whose merge base holds the lowered one
against the new.

### What a change may do to a ceiling

- **Lowering** a limit's value is accepted with no approval.
- **Refused**: raising a limit, removing a limit (its key leaves `limits`, the task stays), widening `margin`, or changing
  `command`, unless an approved proposal (below) names it. A refused commit's record has a state other than PASS and a
  row whose state is FAIL or BLOCKED and whose `note` names the task's `id` and the field, each as a whole word:
  `peakBytes` (the limit's key) for a raise or a removal, `margin`, `command`. The base's own place for a refusal,
  `{ "id": "benchmarks/budgets.json", "state": "BLOCKED", "note": "…" }`, is one such row, and a row of the task's own
  is another.
- **An approved proposal** is an approval as the guard reads one (#1326): an annotated tag under
  `refs/tags/deep/approved/` on a commit of the change, between its merge base and its change side, SSH-signed with a
  touch by a key the merge base's `.deepbuild/approvers` lists, as `readApprovals` in `scripts/proof-change.mjs` reads
  it. It is pushed to `origin` beside main. Its item names the manifest, the task, the field and both numbers:

  ```
  Approves: benchmarks/budgets.json › epsilon › peakBytes 100000000 → 150000000
  ```

  `›` is U+203A, as in the guard's items, and `→` U+2192, each with a space either side. The first number is the
  merge base's value and the second the change's, each as JavaScript prints the number. Only an item that names that
  task, that field and both numbers lets the change through. The tests use it only for a raise.

### What the record holds

On each commit's record, beside the fields above:

- **`tests[].limits`**, on each task's row: one entry per ceiling the task was judged against, by its key,
  `{ "status", "limit", "runs", "reason"? }`. `limit` is the ceiling's value, `runs` the readings: five peaks for
  `peakBytes`, the counts for `instructions`, with `null` for a count that can't be read. A time or memory ceiling's
  entry is `judgeLimit`'s result as it is.
- **`lowered`**: one entry for each ceiling the commit lowers, `{ "id", "metric", "old", "new", "runs" }`: the merge
  base's value, the change's, and the readings the commit was judged on for it.
- **`noCeiling`**: `{ "count", "tasks" }`, the ids of the tasks of the commit's `benchmarks/budgets.json` whose `limits`
  is empty, and how many there are.
- **`slack`**: one entry for each ceiling a task was judged against whose reading is more than 20% under it,
  `{ "id", "metric", "limit", "reading" }`, where `reading` is the highest of its readings and is under `0.8 × limit`.

```json
{ "lane": "budget-window <sha>", "state": "FAIL", "commit": "<sha>", "base": "<sha>", "unmeasured": [], "notReached": [],
  "tests": [{ "id": "tight", "state": "FAIL", "note": "…",
              "limits": { "peakBytes": { "status": "FAIL", "limit": 2010764, "runs": [2654208, …], "reason": "…" } } }, …],
  "lowered": [], "noCeiling": { "count": 2, "tasks": ["open-a", "open-b"] },
  "slack": [{ "id": "roomy", "metric": "peakBytes", "limit": 10616832, "reading": 2670592 }] }
```

## Criteria to tests

Each criterion's ID is `#2665.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of its
name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#2665.54342405` A fixture change that lowers an established task's `peakBytes` limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings. On the merge base it is refused as a changed definition, and the test fails, naming the message | `lowering.test.mjs` | The lowering commit's record has `held`'s row (it wasn't refused) and the row is PASS. `lowered` holds one entry for `held`'s `peakBytes` with the old limit, the new one and five readings, each within 10% of the command's peak by the test's own reading and within the new limit |
| AC2 `#2665.d2a7b8af` A fixture change that raises a limit, one that removes it, one that widens the task's margin and one that changes its command are each refused, naming the task and the field. With an approved proposal that names the task and holds both numbers, the raise passes. A planted validator that takes an approval naming another task fails, naming both tasks | `refusals.test.mjs` | Each of the four unapproved commits is refused naming its task and field. The approved raise's record has no refusal of `epsilon`, and `epsilon`'s row and its `peakBytes` verdict are PASS. The raise of `zeta` under an approval naming `eta`, with the same numbers, is refused naming `zeta` and `peakBytes`; its assertions name both tasks |
| AC3 `#2665.9583c77c` The commit that lowers a ceiling is judged against the old one, and the next commit against the new one. A planted window that judges the lowering commit by its own new number fails, naming the commit | `lowering.test.mjs` | `tight`'s `peakBytes` verdict on the lowering commit has the old value as `limit` and is PASS; on the next commit it has the new value and is FAIL. Each message names its commit |
| AC4 `#2665.f5e661f9` A task with a ceiling on instructions retired reads FAIL on a fixture command that retires 5% more than the ceiling, at a load above the core count and off the reference Macs, where the same command's time limit reads INCONCLUSIVE. A planted judge that reads the time and not the count passes it and fails this test | `counts.test.mjs` | On a Mac14,2, the window reading load 999: `counted`'s `instructions` verdict is FAIL against the ceiling, with at least five readings, each a count over the ceiling and under 1.2 times it; its `p50Ms` verdict is INCONCLUSIVE; its row is FAIL |
| AC5 `#2665.5222fad8` A count that can't be read is missing, never 0, and its ceiling reads INCONCLUSIVE. A planted counter that returns 0 fails, naming the task | `lowering.test.mjs` | On the next commit, `uncountable`'s `instructions` verdict has at least five readings, every one `null`, and is INCONCLUSIVE; its row isn't PASS. Each message names `uncountable` |
| AC6 `#2665.9afb008a` A window's record lists each task with no ceiling by name with their count, and each task more than 20% under its ceiling with both numbers. A planted record that leaves out a task with no ceiling fails, naming it | `lowering.test.mjs` | The next commit's `noCeiling` lists `open-a` and `open-b`, each checked by name, exactly those, with `count` 2. `slack` lists exactly `roomy`, with `peakBytes`, its ceiling and its reading; `held` (12% under its ceiling) and `tight` (over its ceiling) aren't listed |

## The scenes

Every ceiling below is set from the test's own `/usr/bin/time -l` reading of the fixture command, so the scenes hold on
any Mac: `peak` is the highest of five peaks of `/bin/sh` counting to 20,000 (2.64 to 2.67 MB here), `count` the median of
five of its instructions retired (1.033 to 1.039 billion here, within 0.4% in a run). A count of builtins in one `/bin/sh` process
holds its peak and its count steady from run to run.

**`lowering.test.mjs`**, a Mac15,7 at load 2. Its fixture commit holds six tasks, then a first window marks main:

| Task | Command | Ceiling at the mark | After the lowering commit | For |
|---|---|---|---|---|
| `held` | count to 20,000 | `peakBytes` 4 × peak | `peakBytes` peak / 0.88 (its runs within; 12% under) | AC1, AC6 |
| `tight` | count to 20,000 | `peakBytes` peak / 0.83 (17% under) | `peakBytes` peak / 1.32 (its runs 32% over) | AC3, AC6 |
| `roomy` | count to 20,000 | `peakBytes` 4 × peak (75% under) | the same | AC6 |
| `open-a` | count to 2,000 | none | none | AC6 |
| `open-b` | count to 2,000 | none; names the criterion `#9665.0badc0de` | none | AC6 |
| `uncountable` | `/usr/bin/true`, then count to 2,000 | `instructions` 5,000,000,000 | the same | AC5 |

Then two commits on main, and one window measures both: the **lowering commit**, which lowers `held`'s and `tight`'s
`peakBytes`, and the **next commit**, which changes only `notes.txt` and whose merge base is the lowering commit.
`uncountable`'s `/bin/sh` is a platform binary, which the counter's library can't enter, so the child it waits for has
no count and the command's count is missing: on the base, `measureOnce` returns `instructions: null` with
`uncounted: ['a child of /bin/sh']`. Its ceiling is far above the 140 million instructions `/usr/bin/time -l` reads for
`/bin/sh` alone, so a judge that reads 0 or that partial count passes it.

**`refusals.test.mjs`**, a Mac15,7 at load 2. Seven tasks, each `peakBytes` 100,000,000 and margin 0.5 at the mark
(`epsilon` counts to 20,000 since its row is read; the others to 2,000), then six commits on main, each changing one
more task, measured by one window. A refused change stays on main, so each commit's merge base holds the ones before.

| Commit | Change | Approval on it | Required |
|---|---|---|---|
| 1 | `alpha`'s `peakBytes` to 150,000,000 | none | refused naming `alpha` and `peakBytes` |
| 2 | `beta`'s `peakBytes` removed (`limits` `{}`) | none | refused naming `beta` and `peakBytes` |
| 3 | `gamma`'s `margin` to 0.75 | none | refused naming `gamma` and `margin` |
| 4 | `delta`'s command to count to 3,000 | none | refused naming `delta` and `command` |
| 5 | `epsilon`'s `peakBytes` to 150,000,000 | `Approves: benchmarks/budgets.json › epsilon › peakBytes 100000000 → 150000000` | passes |
| 6 | `zeta`'s `peakBytes` to 150,000,000 | `Approves: benchmarks/budgets.json › eta › peakBytes 100000000 → 150000000` | refused naming `zeta` and `peakBytes` |

The fixture's first commit lists the maintainer's key in `.deepbuild/approvers`; both tags are signed by it with a touch
(`tests/fixtures/approver.mjs`), checked by the real `ssh-keygen`, and pushed to `origin`.

**`counts.test.mjs`**, a Mac14,2, the window reading load 999 and the grant 2. One task, `counted`: count to 20,000, with
`instructions` at `round(count / 1.05)`, so the command retires 5% more than its ceiling, and `p50Ms` 60,000. One commit
after the mark changes only `notes.txt`. The test first checks the stand-in: the window reads a load above the cores and
the grant one below.

## Wrong programs

AC1's is the merge base: it refuses the lowering as `Budget held changed or disappeared; restore its frozen definition`,
and the test fails at its first assertion, naming that message. Every test fails on the base at an assertion
(`BASE-FAILURE.txt`). The planted programs the other criteria name are in `twins/` (`twins/README.md`), mapped in
`twins.json`: `any-approval` (AC2), `own-number` (AC3), `reads-time` (AC4), `zero-count` (AC5) and `drops-uncapped`
(AC6). Each is my throwaway window with one line changed; each fails its criterion's test at an assertion naming what
the criterion says, and the throwaway passes all six.

## Readings where the issue leaves a choice

- **What "passes" reads (AC1, AC2).** The window's record: the task has a row, so the commit wasn't refused, and the row
  is PASS. The tests don't call `validateBudgets` or run `perf.mjs`. Other tasks' rows on the same commit don't count, so
  an unrelated row can't fail them.
- **"Established"** is a task its merge base's `benchmarks/budgets.json` holds.
- **"Removes it"** removes the limit's key from the task's `limits` and keeps the task. Removing the whole task stays
  refused, as at the base; no test has one.
- **AC2's "both numbers"** are the field's value at the merge base and in the change, which the approval's item holds.
  The design's "before-and-after numbers" could also be read as measured readings before and after; an item of the
  values themselves is what a validator can check against the change.
- **"The next commit"** (AC3) is a commit whose merge base is the lowering commit: here its child on main. A branch that
  forked before the lowering and merged after it would be judged against its own merge base's old value under this
  surface; no test has one.
- **"5% more than the ceiling"** (AC4) is the test's own `/usr/bin/time -l` count of the same command: the ceiling is
  the median of five counts divided by 1.05. In one run on the throwaway, the window's 20 readings, counted through
  `count-children.c`, came 4.96% to 5.54% over it. The rule FAILs when every reading is over the ceiling; a rule with a
  5% margin, as `judgeLimit`'s, would sit on the line and read INCONCLUSIVE.
- **"At a load above the core count"** (AC4) is the load the window reads, 999, while the throttle reads 2 at its
  grant, as on a machine whose load rises once the window is open. A window can't open at a load above the cores.
- **"A count that can't be read"** (AC5) is instructions retired with a child no count covers, the base's own
  `uncounted` case. A report that leaves out the number a `report.<name>` ceiling names is the other kind; no test has
  one. **"A planted counter that returns 0"** is a window that reads such a count as 0.
- **"With their count"** (AC6) is how many tasks have no ceiling, beside their names, as the issue counts tasks ("8
  carry an absolute limit"). It could also be read as each such task's own count; that would need a field per task.
- **"More than 20% under"** is a reading under 0.8 × the ceiling, the reading being the highest of the task's readings
  for it.
- **"A window's record"** is each commit's record. The lists are read from the next commit's record, which lowers
  nothing, so its ceilings are its merge base's and its tree's alike.
- **A task with `targets` and no `limits`** has a judge of its own, a ceiling in the issue's count ("23 a target judge
  of their own"), so it isn't listed as having none. No fixture task has `targets`.
- **A refusal's state** may be FAIL or BLOCKED.

## Known limits

- `held`'s and `epsilon`'s rows include the merge-base comparison on p50 (50%) and on instructions retired (2%). Both
  sides run the same command in alternated rounds, so neither should move, but the p50 is real time on a shared Mac.
- The window's copy step at the base (`git archive` fed to `tar -mxf -` through execFileSync's input) can end in
  `spawnSync tar EPIPE` on a loaded Mac, as 1981's README records near 400. It met one of my throwaway runs at a
  1-minute load near 300, on the lowering commit: that record was BLOCKED and AC1 and AC3 failed at their first
  assertion, naming `spawnSync tar EPIPE`; the rerun near 250 passed (`BASE-FAILURE.txt`). It is the base's, and a
  follow-up, not this issue's.
- No test runs `perf.mjs`, which calls the same validation on a PR, or `release-budgets.mjs`, whose missing release tag
  the issue describes. No criterion names either.
- No test holds an approval for a removal, a wider margin or a new command, a `report.<name>` ceiling, or the signed
  approval tag the change itself carries (the guard already requires it for `budget-window.mjs` and `benchmark.mjs`).
- The twins call the base's exports named in `twins/README.md`; one goes stale if those change shape.

## What the implementer meets outside this folder

- `tests/acceptance/12/perf-regression.test.ts` lets an estimated limit move up once with a `changeReason` and no
  approval (#12, the base's `movedOnce`). The issue refuses a raise without an approved proposal. These tests don't
  decide whether that exception stays: no fixture change carries a `changeReason`. Dropping it needs a blind redraft of
  #12's test by an approved proposal.
- `tests/benchmark.test.mjs` checks only refusals the issue keeps: a wider margin, a removed limit, a new command, a new
  `initialReason`.
- At the base the window runs `git fetch -q origin main`, which fetches no tag (git 2.56 here), so an approval pushed
  to `origin` reaches its checkout only once it fetches `refs/tags/deep/approved/*` too.
- `budget-window.mjs` and `benchmark.mjs` are on the guard's list, so the change carries a signed approval tag.

## Files

- `helpers.mjs`: the sandbox, the stand-ins, the fixture repository and its approvals, the window, the test's own
  `/usr/bin/time -l` readings, and the record readers.
- `lowering.test.mjs`: the lowering scene, AC1, AC3, AC5 and AC6.
- `refusals.test.mjs`: the refusals scene, AC2.
- `counts.test.mjs`: the count scene, AC4.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, and the throwaway's and each twin's runs.

No fixture holds a secret or personal data. The criterion `#9665.0badc0de` is made up.
