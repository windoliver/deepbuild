# Acceptance tests for #2674: a budget window runs on a reference Mac, and every row of the numbers table has a dated reading

I drafted these tests blind from these sources:

- issue #2674, as saved verbatim for this job, and the bodies of #1830 and #1009, which it names
- `docs/technical-design.md`: Numbers version 0 has to hold (its table, Every task carries its own budgets, The reference
  Macs), How we know version 0 works (Criteria to tests, both ways; Wrong programs; Dogfooding)
- `docs/parallel-proof.md`, sections 6 (the throttle), 10a and 11 (records, invariants) and 12a (Budget windows)
- AGENTS.md
- the base commit `86b99ac36`, which has no implementation: its window writes one record per commit with each task's
  state, note and limits, no window record of its own, no loads, no per-side numbers; the repo holds no window's records
  and no table

At the base I also read `scripts/budget-window.mjs`, `throttle.mjs`, `benchmark.mjs` (`measureOnce`, `measure`,
`judgeTask`, `judgeLimit`, `fingerprint`, `references`), `lanes.mjs` (`writeRecord`, `worst`, `redrafted`),
`affected.mjs` (`select`), `loads-lint.mjs` and `benchmarks/budgets.json`, and `tests/acceptance/1116/`, `1981/`,
`2665/` and `1830/` for their shape. Nothing from them is imported. Per AGENTS.md, the implementing agent doesn't edit
these tests; a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci --ignore-scripts      # once: the window's selection (scripts/affected.mjs) imports typescript
node --test tests/acceptance/2674/window.test.mjs tests/acceptance/2674/evidence.test.mjs
```

- `window.test.mjs` (AC1, AC2, AC4, AC7) plays one scene: two real windows through `node scripts/throttle.mjs window`
  in a sandbox (below). On a Mac17,10 (18 cores) at one-minute loads of 165 to 250 from other sessions it took 2 to 4 min.
  Each of its tests then reads the repo's committed windows, so it fails until they are there. macOS only; elsewhere
  each test is skipped as `INCONCLUSIVE (platform)`.
- `evidence.test.mjs` (AC3, AC5, AC6) reads only the repo: under a second. AC6 reads #1009 with `gh issue view` once a
  window's record settles its criterion.

Neither file gates on this machine's load or fingerprint (both are stand-ins in the scene), so neither is a timed file.
Run them only under `node --test`: the scene refuses to start otherwise, and names its throttle table outright
(`DEEP_THROTTLE_TABLE`), which the throttle refuses outside a test run, so no window here ever drains the machine.

## What a test can judge, and what only the owner's windows can

Most of the criteria are met only by real scheduled windows on a reference Mac, which no agent runs (12a). I judge
those from what the repo holds: the windows' records and throttle log lines committed under `benchmarks/windows/`,
beside the table. Each such check fails, naming what is missing, until the records are there, and never passes on an
empty folder. The window's own behaviour that those records need (a record of its own, the loads, the per-side
numbers, no PASS at a load at the cores) is judged first, on a real window in the sandbox, so a planted window fails at
that point, naming the task.

## The scene (`scene.mjs`)

All stand-ins are at boundaries the repo doesn't own:

- **`HOME`**, `XDG_CACHE_HOME`, `TMPDIR`, `RUSTUP_HOME` and `CARGO_HOME` are in a temporary folder; `DEEP_THROTTLE_TABLE`
  is `$HOME/.deepbuild/throttle`. Every `GIT_*` variable and the DeepBuild variables 2665's sandbox unsets are unset.
  This checkout's `node_modules` is linked above every tree the window reads.
- **The machine**: `sysctl`, `pmset`, `osascript` and `sw_vers`, first on `PATH`, report a Mac15,7 (Apple M3 Pro, 36 GB)
  on mains, Low Power Mode off, thermal state nominal, macOS build `25A2674`.
- **The load**: every node process `--import`s a module that pins `os.loadavg()`. `scripts/throttle.mjs` reads 2, so
  the window's grant starts; the window and everything else read **this machine's core count**
  (`os.availableParallelism()`), a load *at* the cores. `sysctl -n vm.loadavg` answers the same.
- **`npm`** exits 0; **`cargo`** exits 0 and answers `metadata` with an empty workspace, so `affected.mjs`'s selection
  places each task by the files its command names.
- **`gh`** records each call and answers only `issue create`. The fixture's commits name no issue.

The fixture repository (a bare origin, a clone the scene commits in, and the checkout the window runs in) starts with
this checkout's `scripts/`, `notes.txt`, `benchmarks/apart.mjs` and three tasks in `benchmarks/budgets.json`:

| Task | Command | Limits | On the measured commits |
|---|---|---|---|
| `limited` | `/bin/sh -c '<count to 20000>'` | `p50Ms: 60000` | runs: it names no file, so the selection can't place it |
| `plain` | `/bin/sh -c '<count to 15000>'` | none | runs, likewise |
| `apart` | `node benchmarks/apart.mjs` | `p50Ms: 60000` | not reached: neither commit changes `benchmarks/apart.mjs` |

A first window marks main. Two commits then change only `notes.txt`, and one window measures both. At a load at the
cores, a right window measures `limited` and `plain` on both commits and reads neither PASS.

## The surface (my choice where the issue leaves it open)

Everything 1116, 1874, 1981 and 2665 chose stays: how a window opens (`throttle.mjs window`), the throttle log's
`window-open` and `window-close` lines, the mark, which commits a window measures, each commit's record in
`~/.deepbuild/lanes/` (an object with `commit`, `base`, `tests`, `notReached`), found by its `commit` field. #2674 adds:

**On each row of a commit's record** (`tests[]`):

- `loads`: the one-minute load at the start and end of each run the task's verdict rests on, `[{ "start": 7.1,
  "end": 7.4 }, …]`, at least one, each a finite number ≥ 0. Every row whose state is PASS holds it, and so does every
  row, of any state but BLOCKED, of a task that carries a limit or a target. (Load is the issue's word; `loadStart` and
  `loadEnd` are what `measureOnce` reads.)
- `sides`: `{ "change": {…}, "base": {…} }`, each `{ "p50Ms", "p95Ms", "peakBytes", "instructions" }` as `measure`
  summarizes a side: p50 and p95 in ms (p95 ≥ p50 > 0), the peak in bytes (a positive integer), and `instructions`, one
  entry per round of the design's 20 samples a side, each a positive integer or `null` for a count that can't be read,
  never 0. `base` is required where the merge base's `benchmarks/budgets.json` holds the task. Every row but a BLOCKED
  one holds `sides`.

**A window's own record**: one JSON object per window, written beside the commits' records in `~/.deepbuild/lanes/`,
holding:

- `start`, `end`: ISO 8601 times, start first, within the window's own run;
- `commits`: the full SHAs it measured, in order;
- `ran`: the IDs of the tasks it ran on any commit; `notReached`: those it reached on no commit;
- `machine`: what `fingerprint()` returns (`model` and `macosBuild` are read);
- `longest`: `{ "task", … }`, the task that took longest, which the repo's check requires only of a window that ran
  over two hours. The tests find a window's record by its shape (`start`, `end` and a `commits` list), never by its
  file name. A window that measured no commit may leave one or not.

**The committed evidence**, under `benchmarks/windows/` in the repo:

```
benchmarks/windows/
  numbers.md                the table
  <window>/                 one folder per window, any name
    <any>.json              the window's own record (exactly one per folder)
    <any>.json              one record per commit it measured, as the window wrote it
    throttle.log            the throttle log's lines for it, one JSON object a line: a window-open and a
                            window-close of one grant id, the open at or before the window's start and the
                            close at or after its end
```

Every folder there is read as a window of the proof. Hostnames may be redacted; no test reads `host`.

**The table**, `benchmarks/windows/numbers.md`: the first markdown table in the file with these columns, by header
text, in any order: `Budget`, `Measured by`, `Result`, `Reading`, `Date`, `Machine`, `macOS build`, `Load`, `Method`,
`Record`. One line for each of the thirteen rows, its `Budget` cell the design's Budget text exactly: `Hook overhead`,
`Fail-open time`, `Event intake`, `The app`, `Chrome frames`, `Concurrent runs`, `Stop holds`, `Record size`,
`Release gates`, `Hot path`, `Memory`, `The app's footprint`, `The canvas`. The `Result` cell starts with one word:

- `PASS`, `FAIL`, `INCONCLUSIVE` or `BLOCKED`: a result. `Record` cites one or more committed commit records by their
  path under `benchmarks/windows/` (`<window>/<file>.json`); `Measured by` names the tasks in backticks; the cited
  records hold rows of those tasks, and the worst of their states (FAIL, BLOCKED, INCONCLUSIVE, else PASS) is the
  Result. `Date` holds the day (UTC, `YYYY-MM-DD`) of a cited window's start or end, `Machine` its model, `macOS build`
  its build, `Load` a number; `Reading` and `Method` are filled. A task whose command runs a `debug/` build can't give
  a result.
- `reading`, then why: `another machine`, `before the window` or `debug build` in the cell. Every column but `Record`
  filled.
- `unmeasured`, then what is missing (in the cell, or in `Measured by`). Never a result.

**The suites #1830 lists** (103, 124, 148, 149, 166, 262, 311/redraft-ac12, 365, 417, 465, 568/judge.test.mjs, 761,
1018/redraft-ac6, 1098, 1425, 1427) read in a window through tasks of `benchmarks/budgets.json`: a task runs a suite
when one argument of its `command` is the suite's path as #1830 names it (`tests/acceptance/<name>`) or its blind
redraft's folder (`tests/acceptance/<n>-redraft-1830`), or a path under either. The suite reads as its tasks' rows do.

**#1009's criterion**, `#1009.542330be`, is named in a task's `criteria`, as #1874's rule names criteria. A row of that
task reading PASS or FAIL settles it. #1009 "says which" when its body or a comment names the record's commit (its first
seven hex digits or more) and its verdict: `pass`, `passed` for PASS; `fail`, `failed` or `missed` for FAIL (any case),
so the window's own close and miss comments count.

The tests reach a window only by running `throttle.mjs window`, and read only the files above, the sandbox's throttle
log, `git` in this checkout (to place the committed commits on main's first-parent line and read
`benchmarks/budgets.json` at them) and `gh issue view 1009`. They import no script.

## Criteria to tests

| Criterion | Test | What it requires |
|---|---|---|
| AC1 `#2674.5cde9b0e` Three scheduled windows in a row … each end with one record per commit …, and the throttle log holds a `window-open` and a `window-close` for each. Every task … reads PASS, FAIL, INCONCLUSIVE, BLOCKED or not reached. A planted window that records PASS for a task measured at a load at or above the cores fails, naming the task | `window.test.mjs` `#2674.5cde9b0e …` | Scene: one record for each of the two commits; a `window-open` and `window-close` per window in the throttle log; each row in the four verdicts and every task a row or not reached; `limited` and `plain` measured, and no row PASS (the load was the cores). Repo: at least three windows, all on one reference Mac model; their commits one unbroken run of main's first parents; one record per commit and none for another; each `throttle.log` around its window; every row a verdict, every task of the commit's manifest a row or not reached; no PASS row without loads or at a load at or above the model's cores |
| AC2 `#2674.39a35288` … at least 90% of the tasks that carry a limit or a target read PASS or FAIL (drafted), with the load at each run's start and end in the record. A window in which every limit reads INCONCLUSIVE by load leaves this open, naming the load | `window.test.mjs` `#2674.39a35288 …` | Scene: each `limited` row holds `loads`, every reading the pinned load; read as a window, the scene's is left open, naming that load. Repo: rows of tasks carrying a limit or a target (by the commit's manifest) hold loads, at least 90% of them read PASS or FAIL, and no window has every such row INCONCLUSIVE at a load at or above the cores |
| AC3 `#2674.5e151201` The table is in the repo beside the windows' records, with one line for each of the thirteen rows. A line whose reading is from another machine, from before the window, or from a debug build says so … A planted table that gives a row PASS with no record behind it fails, naming the row | `evidence.test.mjs` `#2674.5e151201 …` | `benchmarks/windows/numbers.md` beside at least one window; the table rules above hold; then, for each of the thirteen rows, the same table with that line set to PASS and its Record emptied fails, with a problem starting `<row>: PASS with no record behind it` |
| AC4 `#2674.04047d99` Each commit's record holds, for each task and each side, its p50, its p95, its peak bytes and its instructions retired per round. A planted record that holds only states fails, naming the task | `window.test.mjs` `#2674.04047d99 …` | Scene: `limited` and `plain` hold both sides on both commits, with at least one count read (this Mac counts). Repo: every committed row but a BLOCKED one holds both sides (the base's where the merge base had the task) |
| AC5 `#2674.77d9eb79` The suites #1830 lists read PASS or FAIL in a window, and none reads INCONCLUSIVE for a missing load | `evidence.test.mjs` `#2674.77d9eb79 …` | For each of the sixteen suites, a task runs it, one of its rows in the committed windows reads PASS or FAIL, and none reads INCONCLUSIVE with a note saying the load can't be read, is missing or not given |
| AC6 `#2674.9d468621` #1009's criterion … is settled by a window's record, PASS or FAIL, and its issue says which | `evidence.test.mjs` `#2674.9d468621 …` | A task names `#1009.542330be`; one of its committed rows reads PASS or FAIL; #1009 names that record's commit and verdict. `gh` that can't read the issue fails the test as `BLOCKED` |
| AC7 `#2674.d1a3f7be` Each window's record gives its start, its end, the commits it measured, and the tasks it ran and did not reach. A window over one day's merges ends within two hours (drafted), or the record names the task that took longest | `window.test.mjs` `#2674.d1a3f7be …` | Scene: one window record over the two commits, `commits` exactly them in order, `ran` exactly `limited` and `plain`, `notReached` exactly `apart`, start and end inside the run. Repo: each window folder holds one record, its `commits` its commit records' commits, `ran` and `notReached` as its records' rows and not-reached lists say, and a window over two hours names in `longest.task` a task it ran |

Each test checks the scene (where it has one) before the repo, so a planted window fails at the scene, naming the task,
and a right window fails at the repo until the windows' records are committed.

## Wrong programs

| Criterion | Wrong program | Where it fails |
|---|---|---|
| AC1 | `twins/passes-at-load`: a window with no load guard of its own, so `judgeLimit`'s "above the cores" lets a task measured *at* the cores read PASS | the scene: `limited reads PASS on <sha>, measured at a load of 18 on 18 cores` |
| AC1 | the base: no committed windows | the repo |
| AC2 | the base: its rows hold no loads | the scene: `limited on <sha> holds no load …` |
| AC3 | the in-test planted table (each row in turn PASS with its Record emptied); the base: no table | the plant at its row; the base at `no table at benchmarks/windows/numbers.md` |
| AC4 | `twins/states-only`: a window whose commit records hold `{ id, state }` only; the base, whose rows hold no sides | the scene: `the record of <sha> holds no change side for limited` |
| AC5, AC6 | the base: no task runs a suite or names #1009's criterion, no committed records | the repo |
| AC7 | the base: no window record | the scene: `left 0 records of its own` |

Each twin is `twins/<name>/scripts/budget-window.mjs`, a whole window: my throwaway (the base's window plus about 15
lines: a window record, each row's `loads` around its task and `sides` from `judgeTask`'s `now` and `then`) with one
fault. The throwaway passed every scene check and isn't kept. `twins.json` maps each criterion to its twins. A twin goes
stale as the real file changes, and still holds its fault.

I also checked the repo judges against a private synthetic set of three windows (real first-parent commits of the base,
made-up rows), not committed, since a set that passes must not be in the repo to copy: every judge read it clean, and
each of twenty mutations failed its criterion's judge naming what it names (`BASE-FAILURE.txt`).

## Readings where the issue leaves a choice

- **"At or above the cores"**: the scene pins the load at exactly this machine's cores, where `judgeLimit` (which
  reads only *above*) would pass a run and the window must not. In the repo, the cores are the reference model's: 12
  for a Mac15,7, 8 for a Mac15,12, 18 for a Mac17,10.
- **"Three scheduled windows in a row"**: every window folder in `benchmarks/windows/` is read; there are at least three,
  and their commits together are one unbroken run of main's first parents, each window's after the one before. That a
  schedule opened them, rather than a hand, isn't in any record; see Known limits.
- **"On one reference Mac"**: one `machine.model` across the windows, one of the three. A run of three windows on two
  Macs of the same model can't be told apart.
- **"Every task in every record reads … or not reached"**: rows in the four verdicts, and every task of the
  commit's change side's `benchmarks/budgets.json` a row or in `notReached`, except on a record whose
  `benchmarks/budgets.json` row is BLOCKED (the window refused the manifest, which blocks every task).
- **"At least 90% of the tasks that carry a limit or a target"**: counted over rows, per commit, of tasks whose `limits`
  is non-empty or that have `targets`; a task not reached isn't counted.
- **"INCONCLUSIVE by load"**: an INCONCLUSIVE row whose loads reach the cores. Such a window leaves AC2 open even when
  the share over all windows reaches 90%.
- **"Its instructions retired per round"**: 20 entries, the design's samples a side. A single total is not per round.
- **"Says so and is a reading"**: a `reading` line's Result names one of the three reasons. A result line must come from
  a committed record, so a number from another machine or before the window can't be one unless the record says so;
  a debug build is caught only where the task's command names a `debug/` path.
- **"Its issue says which"** (AC6): read from #1009's body and comments at test time.
- **"A window over one day's merges ends within two hours … or names the task that took longest"**: judged on the
  committed windows by their start and end. A fixture window can't run two hours, so the scene doesn't require
  `longest`.

## Known limits

- The tests can't tell a record a real window wrote from one an agent wrote: the repo's checks hold the records to
  each other, to the throttle log lines, to the table and to main's history, not to their author. Their provenance is
  the owner's commit of them.
- Whether a schedule (the crontab line of 12a) opened a window isn't recorded anywhere a test reads.
- The scene runs two windows over straight commits at one pinned load. It doesn't run a merge commit, a load that
  changes during a run, a task with `targets`, a task new in its commit (no base side), or a window over two hours.
- The scene stands in a Mac15,7 whose cores (12) differ from this Mac's; the window judges against this Mac's, and the
  pinned load is this Mac's cores.
- AC6 reads GitHub through `gh` and fails as BLOCKED without it.

## What the implementer meets outside this folder

- `scripts/budget-window.mjs` is on the guard's list, so its change carries a signed approval tag.
- `judgeTask` (`scripts/benchmark.mjs`) reads each run's `loadStart` and `loadEnd` but doesn't return them; the window
  needs them for `loads`.
- The windows' records and the table land under `benchmarks/windows/` from the owner's reference Mac; the window
  writes its records under `~/.deepbuild/lanes/`.
- 1116, 1874, 1981 and 2665 read a commit's record by `commit` and its rows by `id`, `state`, `note` and `limits`;
  the new fields don't change those.

## Files

- `window.test.mjs`: the scene and AC1, AC2, AC4, AC7.
- `evidence.test.mjs`: AC3, AC5, AC6.
- `scene.mjs`: the sandbox, the stand-ins, the fixture and the two windows.
- `evidence.mjs`: the readers and judges of a commit's record, a window's record, the committed windows and the table.
- `twins.json`, `twins/`: the planted windows.
- `BASE-FAILURE.txt`: the base's run, the throwaway's, each twin's, and the synthetic set's checks.

No fixture holds a secret or personal data.
