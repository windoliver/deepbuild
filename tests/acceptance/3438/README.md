# #3438 acceptance tests: the installed hub's definition names its process type, and its budgets are read on a hub launchd started

Written first and blind at base `2a689d81f`, from issue #3438, the design sections it links and the base, before any
change. The drafting job saw no implementation: it read no other branch, worktree or pull request. Per AGENTS.md the
implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job.

**Read:** #3438 (body and title), and for the words it cites #1, #16, #2143, #568 and #2203. `man launchd.plist` and
`man launchctl` on macOS 27.2 (26B8119). The design's One hub per user, How it installs and Numbers version 0 has to
hold (Every task carries its own budgets; The reference Macs); `docs/parallel-proof.md` sections 6, 7, 7a, 10a, 11 and
12a; AGENTS.md. At the base: `packages/hub/src/service.ts`, `paths.ts`, `plant.ts`, `children.ts` (head),
`hub-command.ts`, `packages/cli/src/main.ts` (its dispatch), `packages/hub/test/onboarding.test.ts`;
`benchmarks/budgets.json`, `hub.mjs`, `hub-lifecycle.mjs`, `hub-sessions.mjs` (head), `deep-hook.mjs`, `record.mjs`,
`command-check.mjs`, `canvas-world.mjs`; `scripts/benchmark.mjs`, `perf.mjs`, `budget-window.mjs`, `proof.mjs`,
`proof-runs.mjs` (twins, `before`, failing at an assertion), `proof-change.mjs` (`criterionId`), `proof-reporter.mjs`,
`lanes.mjs` and `lanes-lists.mjs` (test paths, `alone`, lane files, skips), `wait-ratchet.mjs`, `repo-rules.mjs`,
`known-failures.json` (its `skips`). For their shape: `tests/acceptance/2203/`, `2975/`, `1358/`, `16/` (service,
budgets, launcher), `568/`, `1874/`, `2330-redraft/`, `2011/` (README), `3220/` (ac9), `19/status/README.md`,
`1832/README.md`.

## Run

On macOS, from the checkout's root (`<checkout>`), with Node 24.22:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # definition, judge and runs tests run packages/cli/dist/main.js
cargo build --locked -p deep-hook        # runs.test.mjs's planted run starts a hub, which runs target/debug/deep-hook
node --test --test-concurrency=1 tests/acceptance/3438/definition.test.mjs tests/acceptance/3438/tasks.test.mjs tests/acceptance/3438/judge.test.mjs tests/acceptance/3438/runs.test.mjs
```

On the base only `definition.test.mjs` reads a build (the CLI); the other twelve tests fail at the manifest before
anything is started, so the base run needs no `cargo build`. On a machine with the throttle each line runs as
`node scripts/throttle.mjs test --wait 600 -- scripts/lease <the line>`, as #2203's README gives it. The files are
`*.test.mjs` under `tests/acceptance/`, so the unit lane's own commands don't list them; `affected.mjs` and the proof
lanes run them with `node --test`. `lane.json` makes the folder run alone (reason `binary`: the planted run starts a
hub, which runs deep-hook from this checkout's `target/`). Nothing outside this folder was edited.

Thirteen tests in four files. No network, no agent, no model, no real service manager. Nothing is timed: no test
reads a clock or waits on a timer, and every child is run to its end.

## A budget criterion is never proven by a test

Criteria 2, 3 and 4 name a reference Mac in a budget window. The window runs only the tasks of
`benchmarks/budgets.json` and proves a criterion through a task that names it (`docs/parallel-proof.md`, section
12a). The trace lane counts a criterion proven as soon as one tagged test passes, and the window then ticks it from
the trace record. So a test tagged with criterion 2, 3 or 4 that passed would close the criterion with no reading
taken. These tests therefore never pass:

- they **fail** at an assertion when something the window's reading rests on is false (on the base, and on each wrong
  program below);
- when every assertion holds they end **INCONCLUSIVE**, by `t.skip`, with a note that starts
  `INCONCLUSIVE: the budget window reads this criterion, never a test:` and names the tasks of
  `benchmarks/budgets.json` that take the reading.

What follows from that, for the implementer to report rather than fix: the trace lane reads
`Part of #3438; open: #3438.e9cc07fb, #3438.65e37fd0, #3438.ac71a3bd` (the pull request says `Part of #3438` and the
window proves the rest); the before lane prints `INCONCLUSIVE before: … skipped on the change, though it ran on the
merge base` for those ten tests; an `affected.mjs` run that takes this suite reads INCONCLUSIVE. That is the state
invariant 2 asks for until a window has measured the commit. The owner may list the ten skips under `skips` in
`scripts/known-failures.json` by their IDs and the note's fixed start, which needs a signed approval; this suite
doesn't ask for it.

The three tests of criteria 1 and 5 need no reading and pass when they hold.

## Criterion to tests

IDs are `criterionId` of `scripts/proof-change.mjs`, computed from `issue-3438-body.md` by a probe. Every test's name
starts with its ID. "Base" is what the test does on `2a689d81f`; every one fails there at an assertion.

| Criterion | Test | What it holds | Base |
|---|---|---|---|
| 1 `#3438.690db93b` | `definition.test.mjs` | The definition `deep hub start` writes and hands the service manager holds `ProcessType`, a string, `Interactive` or `Standard`; no `Nice`, `LowPriorityIO` or `HardResourceLimits`; `SoftResourceLimits` holds `NumberOfFiles` alone | Fails at `the definition deep writes on macOS holds no ProcessType: its keys are …` (line 28) |
| 2 `#3438.e9cc07fb` | `tasks.test.mjs` (1st) | Tasks name the criterion; each of `hook_overhead_p95_ms` 10, `idle_cpu_percent` 0.5, `round_trip_p50_ratio` 1.5, `record_append_p50_ratio` 1.5 is a target of exactly one; each judge reads no PASS where nothing was read | Fails at `benchmarks/budgets.json holds no task whose criteria name #3438.e9cc07fb` (`helpers.mjs`, `launchdTasks`) |
| 2 | `judge.test.mjs` (1st) | Five readings a limit: PASS within, never PASS over, FAIL a fifth over, INCONCLUSIVE when mixed, never PASS with four or a missing one; a reading counts only on a reference Mac, on mains, at rest, at a load below the cores | Same assertion |
| 2 | `judge.test.mjs` (2nd) | The p50 of 20 samples a side, never the mean: PASS at 49% above the child-started side, never PASS at 51%, FAIL at 60% and at twice; never PASS with 19 a side, an empty child side, or rounds not alternated | Same assertion |
| 2 | `judge.test.mjs` (3rd) | A hub that is a child reported as launchd's is FAIL, the reason naming its parent process, with or without readings; no hub, an unread parent, the installed hub's label or another process type never pass | Same assertion |
| 2 | `runs.test.mjs` (2nd) | Each task's run loads with `launchctl bootstrap` into the domain `deep hub start` loads into, under a label that isn't `com.deepbuild.hub`, the build's own definition (same keys; same `ProcessType`, `RunAtLoad`, `KeepAlive`, `SoftResourceLimits`; the same program); no call but a read names the installed label; the label is removed when the hub never answers; no PASS | Same assertion |
| 2 | `runs.test.mjs` (4th) | The planted run (`DEEP_HUB_PLANT=child-as-launchd`) reports a hub whose parent is the run itself, and reads FAIL, the reason naming that parent | Same assertion. A planted test can't pass on the base, where the name does nothing |
| 3 `#3438.65e37fd0` | `tasks.test.mjs` (2nd) | As criterion 2's, for `spin_ratio` 1.2 and `write_sync_ratio` 1.2 | Fails at `… no task whose criteria name #3438.65e37fd0` |
| 3 | `judge.test.mjs` (4th) | Ten alternated pairs a command: PASS at 1.19 times the terminal's, never PASS at 1.21, FAIL at 1.5; INCONCLUSIVE when the `Background` pairs stay within 1.2 times as well; never PASS with nine pairs, pairs not alternated, no `Background` pairs, a control hub that isn't `Background` or isn't launchd's, a spin under 5 s; counts only on a reference Mac | Same assertion |
| 3 | `runs.test.mjs` (3rd) | As criterion 2's second, for criterion 3's tasks | Same assertion |
| 4 `#3438.ac71a3bd` | `tasks.test.mjs` (3rd) | Every task of `benchmarks/hub.mjs` that doesn't read a launchd-started hub names the criterion, `hub-round-trip` among them with its command unchanged, each with a margin | Fails at `each task of benchmarks/hub.mjs that starts the hub as a child names #3438.ac71a3bd … hub-start-to-ready, …` (line 39) |
| 5 `#3438.3ead8ec8` | `judge.test.mjs` (5th) | A report with no hub and one ask reads BLOCKED, its verdict carrying that ask alone and its reason the ask's words, whatever readings it carries; a passing verdict asks nothing | Fails at `… no task whose criteria name #3438.e9cc07fb`: on the base nothing reads a launchd-started hub, so nothing reads BLOCKED |
| 5 | `runs.test.mjs` (1st) | In a home under a temp folder with `launchctl` outside every temp folder, each task of criteria 2 and 3 makes no call that changes launchd, exits 0, and reads BLOCKED with exactly one ask, `{kind: "unblock", what}`; all the tasks ask the same ask | Same assertion |

No test passes on a program that does nothing: every test first requires the tasks; a judge must pass the planted
report that is right before a wrong one counts; a run must have handed `launchctl` a definition.

## The surface

### Merged surfaces, used as the base has them

- **`deep hub start`** for the installed hub: writes `~/Library/LaunchAgents/com.deepbuild.hub.plist` and hands it to
  `$DEEP_HUB_LAUNCHER <file>` when that names a launcher, else to `launchctl bootstrap gui/<uid> <file>`, found on
  PATH. A home under a temp folder loads only through a `launchctl` that is itself under a temp folder (#2203).
- **`benchmarks/budgets.json`**: a task's `criteria` names what it proves (#1874), free to change on a task main holds;
  a task with `targets` is judged by `node <its script> judge`, with `{"current": <its report>, "base": null}` on
  stdin, where the report is the last stdout line of its command and the verdict the judge's last stdout line
  (`judgeTargets` in `scripts/benchmark.mjs`, as `benchmarks/hub-lifecycle.mjs` is judged).
- **The five-run rule and the reference Macs**: `judgeLimit` and `fingerprint` of `scripts/benchmark.mjs`.

### Defined here, where the issue is silent

The issue gives no task name, command, report or ask. Each choice below is the nearest to what the base does for its
kind, and no wider than the criteria need. **The implementation builds exactly these.**

**The tasks.** Found by their `criteria`, never by ID: their IDs, their number, their script and their modes are the
implementer's. A task that names `#3438.e9cc07fb` or `#3438.65e37fd0`:

- has `command: ["node", "<script in the checkout>", …]`, so the window's judge call works;
- has `targets`, each key one of the six below, on a task that names that key's criterion; each key on exactly one
  task, with this value:

| Target | Criterion | Value | Reading |
|---|---|---|---|
| `hook_overhead_p95_ms` | 2 | 10 | Limit: hook overhead at p95, in ms, on the launchd-started hub |
| `idle_cpu_percent` | 2 | 0.5 | Limit: the hub's idle CPU, in percent of one core |
| `round_trip_p50_ratio` | 2 | 1.5 | Sides: `hub-round-trip`'s work on both hubs |
| `record_append_p50_ratio` | 2 | 1.5 | Sides: `record-append-20k`'s work on both hubs |
| `spin_ratio` | 3 | 1.2 | Pairs: a command that spins one core for 5 s |
| `write_sync_ratio` | 3 | 1.2 | Pairs: a command that writes and syncs 256 MiB |

**The report**, the last stdout line of a run:

```text
Report = {"task": <the task's id>, "machine": <fingerprint() at the run>, "hub": Hub | null,
          "background_hub": Hub | null,            (only on a task with a Pairs reading)
          "readings": {<target>: Limit | Sides | Pairs}, "asks": [Ask]}
Hub    = {"label": string, "process_type": string | null, "pid": n, "ppid": n, "parent": string}
Limit  = {"runs": [n × 5], "loads": [{"start": n, "end": n} × 5]}
Sides  = {"launchd": [ms × 20], "child": [ms × 20], "first": ["launchd" | "child" × 20], "loads": [… × 20]}
Pairs  = {"chosen": Ten, "background": Ten}
Ten    = {"hub": [ms × 10], "terminal": [ms × 10], "first": ["hub" | "terminal" × 10], "loads": [… × 10]}
Ask    = {"kind": "unblock", "what": string}
```

- `hub` is the hub launchd started from the build's definition, on which every judged reading was taken: the label
  it was loaded under, the `ProcessType` of the definition it was loaded from, its PID, and its parent's PID and
  command as the OS gives them (`ps -o ppid=,comm=`). launchd is process 1 (`man launchctl`, `managerpid`), so a hub
  launchd started has `ppid` 1. `background_hub` is the same for the hub loaded from the definition with the type
  planted as `Background`, on which the `background` pairs were read.
- `Limit`: five readings after one warm-up, with the one-minute load at each one's start and end.
- `Sides`: round k ran the task once on each hub; `first[k]` says which ran first, and it alternates round to round.
  A sample is the task's time in ms, the same measure on both sides.
- `Pairs`: pair k ran the command once started by the hub and once from the run itself, a terminal's child;
  `first[k]` alternates. By which of its surfaces the hub is asked to start the command is the implementer's.
- A report may hold more (the Proof's key-absent column, the bench's own fields). The judge reads only the above.

**The judge**, `node <script> judge`: exits 0 and prints
`{"status": "PASS" | "FAIL" | "INCONCLUSIVE" | "BLOCKED", "reason": string, "targets": {…}, "asks": [Ask]}`.
It reads the machine and the loads from the report, never from the machine it runs on (as
`benchmarks/hub-lifecycle.mjs`'s does), so a report judges the same anywhere. The tests hold it to this much:

- A report with `hub` null is **BLOCKED**, whatever readings it carries; its verdict's `asks` are the report's, each
  once, and its `reason` holds each ask's `what` (the window's record keeps a verdict's status and reason only).
- A `hub` whose `ppid` isn't 1 is **FAIL**, with or without readings, the `reason` naming the parent by its PID or its
  command. A hub with no `ppid` or `parent`, a `label` of `com.deepbuild.hub`, or a `process_type` other than the one
  the build's definition names is never PASS. Any other label passes: the judge names none.
- A budget counts only on a reference Mac, on mains, Low Power Mode off, thermal state nominal, every load below the
  cores: anywhere else the verdict is INCONCLUSIVE, and with no machine or no loads never PASS.
- `Limit`, by the five-run rule: PASS when all five are within the value, FAIL when all five are over it by more
  than the margin, INCONCLUSIVE between; fewer than five, or one missing, never PASS.
- `Sides`: the p50 of the 20 `launchd` samples no more than 1.5 times the p50 of the 20 `child` samples is PASS; a
  p50 60% above is FAIL. Other counts, an empty side, or a `first` that doesn't alternate, never PASS.
- `Pairs`: PASS when the `chosen` pairs are within 1.2 times and the `background` pairs are over it; FAIL when the
  `chosen` pairs are well over; **INCONCLUSIVE, never PASS,** when the `background` pairs are within 1.2 times as
  well. Fewer than ten pairs on either, a `first` that doesn't alternate, no `background`, a `background_hub` that is
  null, not launchd's or not `Background`, or a `spin_ratio` pair whose terminal time is under 5,000 ms, never PASS.
- A missing reading of a target, an empty report or no report: never PASS.

**The run**, a task's own command, started from the checkout as the window starts it. In this order:

1. **Whether a login service can load here**, by #2203's rule: a home under a temp folder whose `launchctl` on PATH
   is outside every temp folder loads none. The run then makes no call that changes launchd, prints a report with
   `hub` null, no readings and exactly one ask, and exits 0, before it builds, starts or loads anything. The ask is
   the same object from every task: it names no task.
2. **The load**: `launchctl bootstrap <domain> <file>`, with `launchctl` found on PATH, never by a path of its own;
   the domain the one `deep hub start` uses; the file the build's own definition under a label of the run's own. The
   first definition a run loads is the one its judged readings are taken on. It holds the keys of the installed
   hub's definition and no others, with the same `ProcessType`, `RunAtLoad`, `KeepAlive` and `SoftResourceLimits`,
   and `ProgramArguments` that start with the installed hub's (more may follow, such as a root). The label, the
   environment's values and the log paths are the run's. A key-absent or `Background` definition is loaded after.
3. **The hub's parent**: read as soon as the hub answers, before any sample. When it isn't launchd the run takes no
   sample and reports the hub as it found it.
4. The readings.
5. **Removal**: the run removes every label it loaded, when its hub never answers too, and ends by itself. It
   never names `com.deepbuild.hub` or its definition in a call that changes launchd, and never rewrites that file.

A run that prints a report exits 0. One that ends in an error is BLOCKED to the window, with no ask.

**The plant**, selected as the base's hub benches select theirs (`benchmarks/hub-sessions.mjs`):
`DEEP_HUB_PLANT=child-as-launchd` on a task's run. The planted run starts `deep hub run` as a child of the process
the command starts, in place of loading it, and reports that hub as launchd's: `label` and `process_type` as a loaded
hub's would be, `pid`, `ppid` and `parent` as the OS gives them. Steps 3 and 5 hold: it takes no sample and stops
its hub. The hub refuses a plant name it doesn't know (`packages/hub/src/plant.ts`), so the name joins that list
or the run drops the variable from its hub's environment.

### Additions the implementation must make

| Addition | Where | Read by |
|---|---|---|
| `ProcessType`, `Interactive` or `Standard`, in the macOS definition, and nothing else new in it | `packages/hub/src/service.ts` | `definition.test.mjs`; `judge.test.mjs` and `runs.test.mjs` read the type from it |
| Tasks naming `#3438.e9cc07fb` that hold the four targets of criterion 2, each once | `benchmarks/budgets.json` | `tasks`, `judge`, `runs` |
| Tasks naming `#3438.65e37fd0` that hold `spin_ratio` and `write_sync_ratio`, each once | `benchmarks/budgets.json` | `tasks`, `judge`, `runs` |
| `#3438.ac71a3bd` in the `criteria` of every task whose command runs `benchmarks/hub.mjs` | `benchmarks/budgets.json` | `tasks.test.mjs` |
| The run, its report, and `judge`, as above | the tasks' script | `judge`, `runs` |
| `DEEP_HUB_PLANT=child-as-launchd` | the tasks' script; `plant.ts`'s list if the hub sees the variable | `runs.test.mjs` (4th) |

Nothing is asked of `scripts/lanes.mjs`: the folder's own `lane.json` makes it run alone.

## Wrong programs

Every test fails on the base at an assertion, so the lanes need no twin, and this job wrote none: a twin's lines are
written against the change (`tests/acceptance/1832/README.md`). One wrong program a criterion, the work with one
fault, for the implementer to plant once the work exists. Criterion 2's is a name the test selects; the others are
line twins, `twins/<name>/lines.json` with `twins.json`, or run by hand.

| Criterion | Wrong program | Test that fails, and what its message names |
|---|---|---|
| 1 | `no-process-type`: `service.ts` writes the definition without the `ProcessType` key and its value, as the merge base does | `definition.test.mjs`: `holds no ProcessType`, with the keys it does hold |
| 2 | `DEEP_HUB_PLANT=child-as-launchd`, the criterion's own planted run. And as a twin, `judge-trusts-report`: the judge takes the report's word that launchd started the hub and never reads `ppid` | `runs.test.mjs` (4th) asserts the planted run reads FAIL naming the parent; on the twin it and `judge.test.mjs` (3rd) fail: `reported as launchd's … reads FAIL; the judge said PASS`, naming process 48211 |
| 3 | `background-not-read`: the judge reads a command's ratio from the `chosen` pairs alone | `judge.test.mjs` (4th): `nine pairs with the type planted as Background never reads PASS`, then `… reads INCONCLUSIVE; the judge said PASS` |
| 4 | `names-one-task`: only `hub-round-trip` names `#3438.ac71a3bd` | `tasks.test.mjs` (3rd), naming the seven tasks of `benchmarks/hub.mjs` that don't |
| 5 | `loads-on-temp-home`: the run skips step 1 and loads whatever the home | `runs.test.mjs` (1st): `reached the service manager, where a temp home gets no login service`, naming the `launchctl bootstrap` call |

The drafting job saw each of these fail its test on a throwaway guess at the change, which is deleted (below).

## Readings where the issue leaves a choice

- **"The chosen value."** The issue names no value. It says the value is chosen on two readings, the key absent and
  `Interactive`, and the manual page says `Standard` is "equivalent to no ProcessType being set". So the test takes
  `Interactive` or `Standard`, spelled as launchd spells them, and no other: `Background` is criterion 3's control,
  and `Adaptive` is read by nothing in the issue. The judge and each run are held to the same value by reading it
  from the definition `deep hub start` writes, so the three can't differ.
- **"The definition `deep` writes."** The one `deep hub start` writes for the installed hub, which `deep setup`
  writes through the same code. Read back by `/usr/bin/plutil`, as launchd would read it.
- **"Not in this task: `Nice`, `LowPriorityIO` and the resource-limit keys."** Held in criterion 1's test: none is
  added, and `SoftResourceLimits` keeps `NumberOfFiles` alone. A later issue that adds one redrafts this.
- **"Hub launchd started."** Its parent is process 1. A stand-in can't start one, so no test reads a real one.
- **"The user's launchd domain."** The domain `deep hub start` itself bootstraps into in the same sandbox,
  `gui/<uid>` at the base. Read from the stand-in's log, not written in a test.
- **"A label of its own … the installed hub's label is never touched."** Any label but `com.deepbuild.hub`. A
  `print` or `list` of the installed label is a read and passes; any other call that names it fails.
- **"Holds 10 ms at p95", "holds 0.5%".** Limits, judged by the design's five-run rule. The planted readings sit 2%
  under, 2% over and 20% over, so `<` and `<=` both pass.
- **"A p50 no more than 50% above … 20 samples a side in alternated rounds."** The design's regression rule with the
  child-started hub in the merge base's place. Planted sides are constant, or mixed so the p50 and the mean part.
- **"Over 10 alternated pairs."** The issue names no statistic. Each planted set gives every pair one ratio, so the
  median of ratios, the ratio of medians, the ratio of sums and every pair agree.
- **"If they stay within 1.2 times as well."** Asserted only where every command of a task stays within under
  `Background`. A task where one command does and the other doesn't is asserted neither way.
- **"Spins one core for 5 s."** The one size a judge can see: a terminal time under 5,000 ms is no 5 s spin. That the
  file is 256 MiB and synced is the run's own; no test reads it.
- **"Each criterion above that needs launchd."** Criteria 2 and 3. Criterion 1 needs no launchd, and criterion 4's
  tasks start the hub as a child.
- **"BLOCKED with one ask."** One ask a verdict, and the same ask from every task one cause blocks, so a person is
  asked once (invariant 4). The ask's shape is #2011's unblock ask without its host. Its words are free.
- **"Every hub task … that starts the hub as a child."** The tasks whose command runs `benchmarks/hub.mjs`, the file
  the issue names first, each of whose modes spawns `deep hub run`; `hub-sessions.mjs` and `hub-soak.mjs` are no
  tasks of the manifest. A change may name the criterion on more tasks (`deep-hook.mjs`'s, say); the test asks for
  these at least. "Reads within its margin of the merge base" is the window's own judgement of each task; the test
  holds that the window counts the criterion measured only on tasks that name it.
- **A run whose hub never answers.** The issue says only that where no login service can load the readings are
  BLOCKED. The test asks that such a run removes its label and never reads PASS; BLOCKED or INCONCLUSIVE both pass.

## Stand-ins and machine safety

- **`launchctl`** (`fixtures/launchctl.mjs`), first on every child's PATH: it logs each call, keeps a copy of each
  definition it is handed, holds a loaded job as a line of its state and **starts nothing**. It refuses every load
  until a test tells it to accept. For criterion 5 it sits in `/Users/Shared/dh3438-*`, outside every temp folder,
  as #2203's does. **`systemctl`** and the **launcher** log and exit 1.
- **A child's environment** is built from nothing: `HOME` (`/private/tmp/dh3438-*/h`), `TMPDIR` and `XDG_*` inside
  the sandbox, `PATH` (the stand-ins, a `node` link, `/usr/bin:/bin:/usr/sbin:/sbin`), `SHELL`, `TZ`, `LC_ALL`, the
  cancelled OS confirmation, and what the test adds (`DEEP_HUB_LAUNCHER`, `DEEP_HUB_PLANT`).
- **The real launchd is never reached** while a run finds `launchctl` on PATH. Before any task is run, the helpers
  read the sources under `benchmarks/`, `scripts/` and `packages/` and stop BLOCKED if one names `launchctl` by its
  path, since no stand-in can come before that.
- Each child is run to its end in a process group of its own, and that group is stopped by its PID afterwards. A
  hub the planted run named and left outside its group is stopped by its PID, only while `ps` still shows it as
  `hub run`. Nothing is stopped by name or port. Each sandbox is removed when its test ends; a run killed midway can
  leave `/private/tmp/dh3438-*` and `/Users/Shared/dh3438-*`, which hold scripts, logs and plists no launchd reads.
- Messages write the test's HOME and yours as `~`, the sandbox as `<sandbox>` and the checkout as `<checkout>`.
- **BLOCKED**, by a thrown error, never a pass: no built CLI or deep-hook where a test needs one; a half-built
  checkout; `/Users/Shared` not writable; `plutil` not runnable, or this suite's own reader disagreeing with it; a
  source naming `launchctl` by path; `deep hub start` logging no bootstrap in the load scene.

## Criterion 1 on another system

The issue has the definition's text tested on any machine, and the base picks the definition by `process.platform`
alone. So off macOS the `deep` child is preloaded with `fixtures/as-macos.mjs`, which answers `darwin` for the
platform, and the definition is read by this suite's own reader in `plutil`'s place. If the child still writes no
macOS definition there, the test is skipped INCONCLUSIVE, naming the platform: never a pass. This path was not run by
the drafting job, which had a Mac only. The tests that run a task are skipped the same way off macOS;
`tasks.test.mjs` runs anywhere.

## What each file costs

| File | On the change | On the base |
|---|---|---|
| `definition.test.mjs` | One `deep hub start` (no hub starts), one `plutil`; a sandbox of a few KB; about a second | The same |
| `tasks.test.mjs` | Reads the manifest; three judge processes a task; no sandbox; under a second | Reads the manifest; starts nothing |
| `judge.test.mjs` | One `deep hub start` for the type, then about 150 judge processes, one at a time; 8 to 13 s on the throwaway at a load of 23 | Reads the manifest; starts nothing |
| `runs.test.mjs` | Criterion 5: one run and one judge a task, each over at once, with a folder under `/Users/Shared`. The load scene: one `deep hub start` and one run a task, which lasts as long as the run's own wait for a hub (15 s if it keeps `deep hub start`'s), limit 15 minutes a run. The planted run: one hub, started and stopped by the run | Reads the manifest; starts nothing |

No test writes more than its sandbox. The window's readings (the 5 s spins, the 256 MiB files, the 20 rounds) are
never taken by a test. The window runs a task's command 22 times (20 rounds, a warm-up, one for the judge), which is
the implementer's to weigh when sizing a run.

## What the drafting job ran, and what it did not

The checkout had `node_modules` and no build, on a shared Mac at a load of 23 to 56. **No test was run on the base,
or on any build:** nothing was built, and no `deep`, hub, lane, benchmark or real `launchctl` was run. The base run is
the implementer's, with the commands above, once the machine grants a build; there is no `BASE-FAILURE.txt`. Expected
there: all thirteen fail, each at the assertion the table gives, and none in a helper.

What was run, each a node script under the job's scratch folder, a few seconds long:

- The criterion IDs, from the body.
- The four test files, with plain `node`, in a copy of this folder laid over a throwaway checkout: the base's
  manifest, a guess at `deep hub start` (the base's plist text, with and without the key) and a guess at one bench
  with a run and a judge. On the guess: 3 pass, 10 end INCONCLUSIVE. On the base's manifest and plist text: all 13
  fail at the assertions above. With one fault at a time, the test named here failed at its assertion: no key; `Nice`
  added; type `Background`; a limit of 11 in the manifest; a missing target; the criterion on one task; a judge that
  trusts the report, reads the mean, reads no `Background` pairs, holds 12 ms, or crashes; a run that loads on a temp
  home, asks twice, names its task in the ask, exits 3, loads the installed label, leaves its label, kickstarts the
  installed label, loads into `user/<uid>`, loads a key-absent or hand-written definition first, ignores the plant,
  or reports its child's parent as 1. Both task groupings passed: one task a target, and one task for criterion 2.
- This suite's plist reader against `plutil`; the platform preload; the scan for `launchctl` by path (996 files,
  0.2 s, none).
- `node scripts/repo-rules.mjs`: its secrets check passed with this folder in the tree; its `physics-build` and
  `deps` lines read FAIL and BLOCKED because the job's shell had no `cargo` on PATH, which no file here touches. Its
  size note counts this folder at about 1,250 handwritten lines, over the 400 guideline: a blind suite lands whole.
- The studied-names check over this folder, which printed nothing.

The throwaway checkout and every probe are deleted. Not run: the wait ratchet and the other lints (no file here has a
timer, a `sleep` or a clock), `tsc` (no TypeScript), the non-macOS path, and any twin.

## Not held

- That a reading is true: that hook overhead is a p95 over real hooks, that idle CPU is the hub's, that the commands
  were started by the hub, that the file is 256 MiB. The `Background` control guards the pairs; the rest is the run's.
- A run past its load: with a stand-in no hub ever answers, so removal after a full run, the second and third
  definitions a run loads, and the readings are never seen. The planted run is the one run that starts a hub.
- The Proof's key-absent column, the pull request's two columns and its reason, and the sentence the issue adds to
  How it installs: the window's report and the review hold them.
- #2143's reload of a hub loaded from an older definition, the systemd unit and the Windows logon task: the issue
  leaves them out.
- `benchmarks/windows/numbers.md` and `scripts/budget-table.mjs`: whether a new task joins a row is the implementer's.

## Files

- `definition.test.mjs` (criterion 1), `tasks.test.mjs` (2, 3, 4), `judge.test.mjs` (2, 3, 5), `runs.test.mjs`
  (5, 2, 3).
- `helpers.mjs`: the sandbox, `deep`, the definition and its reader, the tasks, the planted reports, the judge, a run.
- `fixtures/launchctl.mjs`: the service manager's stand-in. `fixtures/as-macos.mjs`: the platform preload.
- `lane.json`: the folder runs alone.

No fixture holds a secret or personal data.
