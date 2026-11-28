# Acceptance tests for #3537: a budget's gain is judged on the same work

A blind job wrote these tests before any work on #3537 existed, from these inputs only:

- issue #3537, which has no comments: its opening paragraph and four bullets, its `Runs on:` line, its Scope, its seven
  acceptance criteria and its Proof line;
- the issues it names, for the words it cites: #2665, #243 and #1513 (Beside) and #1116 (the suite its Proof names);
- the design sections it links: `docs/technical-design.md`, Numbers version 0 has to hold and Later, as extensions;
  `docs/parallel-proof.md`, section 12a. Beside them, How we know version 0 works (Criteria to tests, both ways;
  Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding; Tests written first; Repo guards),
  `docs/parallel-proof.md` sections 6, 7 and 7a, `docs/adr/0001`, `AGENTS.md`, `CONTRIBUTING.md` and `GLOSSARY.md`;
- the base commit `7997a6637`, which has no work on #3537. There I read `scripts/benchmark.mjs`,
  `scripts/budget-window.mjs`, `scripts/throttle.mjs` (how a window is asked and when it opens), `scripts/perf.mjs` (the
  preflight workload's "so their workloads are unlike"), `scripts/proof-approvals.mjs`, `scripts/affected.mjs` (which
  tasks a commit runs), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs` (a record, a lane file),
  `scripts/proof-runs.mjs` (a failure at its assertion, the lane's 20-minute limit), the wait, comment and size
  ratchets and the secrets patterns of `scripts/repo-rules.mjs`; `benchmarks/budgets.json`, `benchmarks/evidence.mjs`
  and `packages/evidence/src/index.ts`; `tests/fixtures/approver.mjs`; and the suites `2665`, `1116`, `2674` and
  `3551`, with `1832`'s README for the line form of a twin.

The helpers are written here. The one module imported from outside this folder is `tests/fixtures/approver.mjs`, the
repo's stand-in for a person's security key, as #2665's suite imports it. No test imports the code under test: a
window is reached by running `node scripts/throttle.mjs window` in a fixture's checkout, and a task's report by running
the task's own command. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind
redraft by this job.

## Run

```sh
node --test tests/acceptance/3537/judged.test.mjs      # criteria 1, 2, 4, 5 and 6: one window, one commit, nine tasks
node --test tests/acceptance/3537/lowering.test.mjs    # criterion 3: one window, three commits, three tasks
node --test tests/acceptance/3537/evidence.test.mjs    # criterion 7: the two evidence tasks, run and windowed
```

They run only under `node --test`: only inside a test run does a window keep a throttle table of its own
(`docs/parallel-proof.md`, section 6), and a scene refuses to start otherwise, as `BLOCKED (runner)`. On a shared
machine each goes through the throttle, as the lanes run it: `node scripts/throttle.mjs test -- node --test <file>`.
macOS only: elsewhere each test is skipped as `INCONCLUSIVE (platform)`. There are 8 tests in 3 files, one for each
criterion and two for criterion 7.

| File | Needs | Took here |
|---|---|---|
| `judged.test.mjs` | `npm ci` | 64 s to 3 min 21 s, at loads of 23 to 113 |
| `lowering.test.mjs` | `npm ci` | 37 to 46 s, at loads of 25 to 41 |
| `evidence.test.mjs` | `npm ci`, and the evidence store built: `npm run build -w @deepbuild/evidence` (`benchmarks/evidence.mjs` imports `packages/evidence/dist/index.js`) | 5 min 32 s to 7 min 29 s, at loads of 20 to 58 |

"Here" is a Mac17,10 (18 cores) shared with other sessions, at the 1-minute loads named, on the base and on a
throwaway guess at the change (below). The whole suite took 7 to 12 minutes, one file after another. Each scene is
played once, on the turn of the first test that reads it, so a file's time is on its first test. Each test has its
own limit (30, 20, 15 and 45 minutes), and each window its own (25, 15 and 40 minutes): a window still running then
is stopped by its process group's PID and the test fails as `INCONCLUSIVE (window)`.

**Why `evidence.test.mjs` is long.** Its window measures the real `evidence-retain-30d` against a planted store, as
criterion 7 asks, so the merge-base side runs the base's retention benchmark 21 times, the rounds `measure` takes. At
the base one run of `node benchmarks/evidence.mjs retain-30d` took 13 to 19 s here and retired 329 billion
instructions, about half of it opening the store on the benchmark's 18,000 journal lines. No test can make that
shorter. The planted store is chosen so that its own side costs a tenth of a second a run (below).

**`lane.json`.** The folder runs alone, and `evidence.test.mjs` is on the slow list, since its fastest run is over two
minutes (`docs/parallel-proof.md`, section 7a). The reason is timing: `judged.test.mjs` reads a 99% fall in a task's
p50 from a window's alternated rounds, and `evidence.test.mjs` times those 21 rounds, so a sibling suite's builds
beside them stretch both.

No message, and no line of `BASE-FAILURE.txt`, holds a path of this machine: the checkout reads `<checkout>`, a
scene's temporary folder `<sandbox>`, and every home folder, a scene's own too, `~`.

## The sandbox and the stand-ins

All at boundaries the repo doesn't own, as #2665's and #2674's are (`helpers.mjs`):

- **A sandbox per scene**, removed when the file's tests end: a `HOME` (its folder is named `user`),
  `XDG_CACHE_HOME`, `TMPDIR`, `RUSTUP_HOME` and `CARGO_HOME` in a temporary folder, and `DEEP_THROTTLE_TABLE` named
  outright as `$HOME/.deepbuild/throttle`, which the throttle refuses outside a test run. So no window here reads or
  drains the machine's table, and its records, its mark, its copies of both sides and the instruction counter's build
  are the sandbox's. Every `GIT_*` variable is unset, and so are `DEEP_THROTTLE`, `DEEP_PERF_LOCK`,
  `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT`, `DEEP_THROTTLE_READINGS`, `DEEP_THROTTLE_RUN`, `DEEP_WINDOW`,
  `DEEP_WINDOW_DRAIN`, `DEEP_WINDOW_APART_MIN`, `DEEP_WINDOW_OVERDUE_MIN`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`,
  `DEEP_PROOF_ISSUES`, `DEEP_APPROVERS`, `DEEP_GATES`, `DEEP_BIN_DIR`, `DEEP_COUNT_LOG`, `CARGO_TARGET_DIR`,
  `CARGO_MAKEFLAGS`, `MAKEFLAGS` and `MFLAGS`. With neither span set, a window on a test's own table opens whenever no
  grant is held (#3551), so a scene's two windows open seconds apart. This checkout's `node_modules` is linked above
  every tree a window reads, and the folder of the `node` that runs the tests is on `PATH` after the stand-ins, so a
  task's `node` is that one.
- **The fixture repository**: `origin.git`, a bare repository on disk; a clone the scene commits in; and `mac`, the
  checkout a window runs in. Its first commit holds a copy of this checkout's `scripts/`, the scene's
  `benchmarks/budgets.json` and benchmarks, `notes.txt`, and `.deepbuild/approvers` listing the maintainer's key. Each
  later commit goes straight onto `main`, as a squash merge leaves it, so its merge base is the commit before it.
- **`gh`**, first on `PATH`: every call is recorded, and only `issue create` is answered (the follow-up a FAIL files).
  The fixture's commits name no issue. Nothing touches GitHub.
- **The machine**: `sysctl`, `pmset`, `osascript` and `sw_vers`, first on `PATH`, report a Mac15,7 (Apple M3 Pro,
  36 GB) on mains, Low Power Mode off, thermal state nominal, macOS build `25A3537`. Any other `sysctl` goes to the
  real one.
- **The load**: every node process of a sandbox `--import`s a module that pins `os.loadavg()` at 2, so a window's
  grant starts and no row reads INCONCLUSIVE by this machine's load. `sysctl -n vm.loadavg` answers the same. The
  cores stay the machine's.
- **`npm` and `cargo`**, first on `PATH`, exit 0 and print nothing: a fixture has nothing to warm, and with no
  `cargo metadata` the base's selection places no task, so every task of a fixture runs on every measured commit.
  Each fixture command is `/bin/sh -c '. ./bench/<id>.sh'`, which names no file as a path of its own, so a selection
  that worked would run it on every commit too.
- **An approval** is a real one: an annotated tag under `refs/tags/deep/approved/` on the commit, SSH-signed with a
  touch by the key the fixture's first commit lists, checked by the real `ssh-keygen`, pushed to `origin`.

Every process a scene starts runs in a process group of its own, stopped by that group's PID when the file's tests
end. Nothing is stopped by name or port.

**A fixture benchmark** is a file of the tree, `bench/<id>.sh`: `/bin/sh` counting to `rounds` in shell builtins,
then one `echo` of its report. One process does all its work, so its instructions retired hold steady from run to
run (a 20,000-round count within half a percent here), and a commit changes what a task does and reports by changing
that file, never the task's `command`, which #2665 refuses.

```sh
rounds=750000
i=0
while [ $i -lt $rounds ]; do i=$((i+1)); done
echo '{"work":{"records":3000}}'
```

## The surface (mine where the issue leaves it open)

Everything #1116, #2665, #2674 and #3551 chose stays: how a window is asked, its mark, which commits it measures and
against which merge base, a commit's record under `~/.deepbuild/lanes/` (found here by its `commit`, never by its file
name), its rows (`tests[]`, each `id`, `state`, `note`, `limits`, `sides`, `loads`), and `lowered`, `noCeiling` and
`slack` beside them. What #3537 adds, exactly as the tests spell and read it:

### 1. A run's report holds `work`

A task's report is its command's last stdout line that is a JSON object, as at the base. It may hold **`work`**, an
object of counts by name, each a number:

```json
{"work":{"records":3000}}
```

- A task **reports `work`** when its report holds the key. It **reports none** when its run prints no such line
  (`plain-a`) or its report has no `work` key (`plain-b`, `silent`: `{"held":512}`). Whether it reports is read from its
  runs; `benchmarks/budgets.json` declares nothing, and no fixture task carries a new field.
- A count **can't be read** when the report holds it under `work` and its value is no number (`{"work":{"records":"many"}}`).

### 2. What a task reads (its row in the commit's record)

- **Both sides report `work` and a count differs**: the row's `state` is `INCONCLUSIVE`, and its `note` names the
  count and both values, each as a whole word: `records`, `3000` and `3`, the numbers as JavaScript prints them. The
  row keeps `sides`, as #2674 has every measured row keep them.
- **Both sides report equal `work`**: the task is judged as at the base, where a fall reads `PASS` (`steady` and
  `matched`, each 30% down).
- **A count can't be read on one side**, either side: `INCONCLUSIVE`, and the `note` says `work` or names the count
  (`records`), each as a whole word.
- **An approved proposal that names the task, the count and both values**: the unlike comparison is judged as if the
  work were equal. The proposal is an approval as #2665's is (a signed tag on a commit of the change), with one item
  for each count that differs:

  ```
  Approves: benchmarks/budgets.json › meant › work.records 7000 → 7
  ```

  the manifest, the task's `id`, `work.<count>`, the merge base's value, then the change's, each as JavaScript prints
  the number; `›` is U+203A and `→` U+2192, each with a space either side. An item naming another task, with the same
  count and values, approves nothing for this one.

### 3. What a change may do to a ceiling

Lowering a ceiling stays as #2665 left it for a task whose runs report `work`, the same on both sides: the row is
`PASS` and `lowered` holds `{ "id", "metric", "old", "new", "runs" }` with the five readings. It is **refused**:

- on a task that reports no `work`, naming the task;
- when the change's runs report other work than the merge base's, naming the task and both values (`thinned`, `4000`
  and `40`).

A refusal is what #2665's suite reads as one: the commit's record has a `state` other than `PASS` and holds a row
whose `state` is `FAIL` or `BLOCKED` and whose `note` names what is named above, each as a whole word. The base's own
place for one, `{ "id": "benchmarks/budgets.json", "state": "BLOCKED", "note": "…" }`, is such a row, and a row of the
task's own is another. An `INCONCLUSIVE` row alone is no refusal: a lowering whose runs did less is `INCONCLUSIVE` by
rule 2 whether or not it was taken, so only a refusal tells a validator that took it from one that didn't.

### 4. What a commit's record lists

Beside `noCeiling` and `slack`, on each commit's record:

- **`noWork`**: `{ "count", "tasks" }`, the `id`s of the tasks the window ran on the commit whose runs report no
  `work`, and how many they are (`count` is the length of `tasks`, each `id` once).
- **`falls`**: one entry for each reading of a row that fell by more than half against its merge base,
  `{ "id", "metric", "base", "change" }`: the task, the reading's key in `sides` and its two values, the change's
  under half the merge base's (`change < 0.5 × base`). The readings are the three the merge base is compared on:
  `p50Ms`, `peakBytes` and `instructions`. For `p50Ms` and `peakBytes` the values are the row's own `sides.base` and
  `sides.change` values. For `instructions` each is one count for its side, such as its rounds' median: the test holds
  it between that side's lowest and highest round, and reads the fall from the two medians. Where those two medians
  stand between 0.4 and 0.6 of each other the test asks for nothing either way, since the issue doesn't say which one
  number stands for a side's rounds. An entry for another key of `sides`, such as `p95Ms`, may be listed, and is held
  only to its own two values. A listed fall changes no row's `state`.

```json
{ "commit": "<sha>", "base": "<sha>", "state": "INCONCLUSIVE",
  "tests": [{ "id": "shrunk", "state": "INCONCLUSIVE", "note": "… records 3 … 3000 …", "sides": { "change": { "p50Ms": 17.1, "instructions": [71012345, …] }, "base": { … } } }, …],
  "noWork": { "count": 2, "tasks": ["plain-a", "plain-b"] },
  "falls": [{ "id": "halved", "metric": "instructions", "base": 507000000, "change": 84000000 }, …] }
```

### 5. The two evidence tasks

`node benchmarks/evidence.mjs <task>` prints a report, and `benchmarks/budgets.json` keeps both tasks' `id`s:

| Task | Its report holds | The value, worked out at the base |
|---|---|---|
| `evidence-retain-30d` | `work.records`, the records its retention pass removed | 2,700: the benchmark stores 500 records a day for 36 days and runs the pass at day 36; the store removes what is more than 30 days old, the 6 oldest days, 3,000 records, and keeps the one in ten the benchmark cites |
| `evidence-put-5mb` | `work.bytes`, the bytes the store kept of its put | the length of the PNG the benchmark builds: an 8-byte signature, a 13-byte header chunk, the 1,400 rows of 3,601 bytes deflated at level 0, and an end chunk, each chunk framed by 12 bytes. The test deflates as many bytes itself: 5,042,228 with this node |

```json
{"work":{"records":2700}}
{"work":{"bytes":5042228}}
```

Each task's `work` is the same on every run of an unchanged store. Other keys of `work` are free.

## Criteria to tests

The ID is `#3537.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out. Each test's title starts `AC<n> #3537.<id>`.

| Criterion | Test (file) | What it holds | Fails on |
|---|---|---|---|
| 1 `#3537.ac8dfced` | `judged.test.mjs` AC1 | `shrunk` reports `{"records":3000}` on the merge base and `{"records":3}` on the change, at a thousandth of the rounds. By the row's own `sides`, its p50 and its instructions retired (the median of the rounds' ratios) each fell by 99% or more. The row is `INCONCLUSIVE` and its `note` names `records`, `3000` and `3` | **the merge base**: the row is `PASS`. The message names `shrunk`, and what the three judges left: no miss from `compare` or `judgeInstructions` in the note, `judgeCount` `PASS` on the task's `instructions` ceiling |
| 2 `#3537.f37dbb33` | `judged.test.mjs` AC2 | `steady` reports `{"records":3000}` on both sides and counts 31% fewer rounds. Its row holds both sides' instructions retired per round, by which they fell by 25% to 35%, and reads `PASS` | `fall-inconclusive` (below). **It passes on the base**, which reads a fall as `PASS` and keeps `sides` |
| 3 `#3537.a2b0a773` | `lowering.test.mjs` AC3 | Three commits, each lowering one task's `peakBytes` ceiling from 100,000,000 to 50,000,000. `silent` (no `work`): refused, naming `silent`, and no `FAIL` or `BLOCKED` row names `silent` on the commit before it, which leaves `silent` alone. `matched` (the same `work` on both sides, in 30% fewer rounds): its row is `PASS`, no refusal names it, and `lowered` names 100,000,000, 50,000,000 and five readings, each within the new ceiling. `thinned` (the same commit makes its runs report `{"records":40}` for `{"records":4000}`): refused, naming `thinned`, `4000` and `40` | the merge base, which takes `silent`'s lowering; `takes-less` |
| 4 `#3537.fb27f5b5` | `judged.test.mjs` AC4 | The commit carries one approval with two items. `meant` (7000 to 7), named by its item: `PASS`. `stray` (5000 to 5), whose values an item naming `steady` holds: `INCONCLUSIVE`, naming `records`, `5000` and `5` | the merge base, which judges `stray`; `any-task` |
| 5 `#3537.b8c98e7f` | `judged.test.mjs` AC5 | `unread-change` and `unread-base` count the same rounds on both sides and report `{"records":3000}` on one side and `{"records":"many"}` on the other. Each row is `INCONCLUSIVE` and its `note` says `work` or `records` | the merge base, which reads both `PASS`; `missing-matches` |
| 6 `#3537.2e65de36` | `judged.test.mjs` AC6 | Every task has a row. `noWork.tasks` holds `plain-a` and `plain-b` and none of the five tasks that report `work` on both sides, and `count` is its length. `falls` holds an entry for each `p50Ms`, `peakBytes` and `instructions` reading of any row that fell by more than half by the row's own `sides`, with both values, and none for one that didn't: `halved` (87.5% fewer rounds) is listed and `steady` is not | the merge base, whose record has neither list; `leaves-one-out` |
| 7 `#3537.e8bf6db2` | `evidence.test.mjs`, first | Each task's own command, run twice in this checkout: its report holds `work.bytes` 5,042,228 (`evidence-put-5mb`) and `work.records` 2,700 (`evidence-retain-30d`), and the second run's `work` equals the first's | the merge base, whose benchmark prints no report |
| 7 `#3537.e8bf6db2` | `evidence.test.mjs`, second | A fixture holding the two tasks, `benchmarks/evidence.mjs` and the store as built. One commit plants a store whose retention pass removes nothing. `evidence-retain-30d` is `INCONCLUSIVE`, naming `records`, `2700` and `0`; `evidence-put-5mb`, whose store is as it was, isn't held for unlike work (no `INCONCLUSIVE` naming `bytes`), and `noWork` lists neither | **the merge base**, where the row reads `PASS` |

## The scenes

**`judged.test.mjs`**: nine tasks, a first window that marks `main`, then one commit that changes seven benchmarks
and carries the approval, and one window that measures it. Every task runs.

| Task | On the merge base | On the change | For |
|---|---|---|---|
| `shrunk` | 750,000 rounds, `{"records":3000}`; an `instructions` ceiling of 100,000,000,000 | 750 rounds, `{"records":3}` | 1, 6 |
| `steady` | 10,000 rounds, `{"records":3000}` | 6,880 rounds, the same report | 2, 6 |
| `halved` | 8,000 rounds, `{"records":3000}` | 1,000 rounds, the same report | 6 |
| `meant` | 4,000 rounds, `{"records":7000}` | 40 rounds, `{"records":7}`; approved by `… › meant › work.records 7000 → 7` | 4, 6 |
| `stray` | 4,000 rounds, `{"records":5000}` | 40 rounds, `{"records":5}`; the approval's other item is `… › steady › work.records 5000 → 5` | 4, 6 |
| `plain-a` | 2,000 rounds, no report | the same file | 6 |
| `plain-b` | 2,000 rounds, `{"held":512}` | the same file | 6 |
| `unread-change` | 20,000 rounds, `{"records":3000}` | 20,000 rounds, `{"records":"many"}` | 5 |
| `unread-base` | 20,000 rounds, `{"records":"many"}` | 20,000 rounds, `{"records":3000}` | 5 |

`shrunk`'s 750,000 rounds took 2.1 to 3.0 s a run here at loads near 25, and 8.0 s at a load of 64, against 11 to
22 ms for the change's 750: a run of anything through the window's counter takes 10 ms, so a 99% fall in time needs
seconds on the other side. Its ceiling is far
above both sides' counts (about 47 billion and 69 million here), so `judgeCount` reads it `PASS` at the base, the
third of the three judges. The two unread tasks count 20,000 rounds on both sides, so that the base reads them
`PASS`, as it did in each run here (Known limits, Two sides that do the same).

**`lowering.test.mjs`**: three tasks, each `/bin/sh` counting to 20,000 with a `peakBytes` ceiling of 100,000,000,
which its 2.5 MB peak is far within; a first window; then three commits and one window that measures all three.
Every task runs on every commit:

| Commit | Lowers to 50,000,000 | Its task reports | Read |
|---|---|---|---|
| 1 | `matched` | `{"records":3000}` on both sides; the commit also changes its benchmark to 14,000 rounds, the same work for less | passes, as #2665's first criterion has it |
| 2 | `silent` | `{"held":512}`: no `work` | refused, naming `silent` |
| 3 | `thinned` | `{"records":4000}` on the merge base; the commit also changes its benchmark to 200 rounds and `{"records":40}` | refused, naming `thinned`, `4000` and `40` |

A refused change stays on `main`, as in #2665's suite, so each commit's merge base holds the ones before it.

**`evidence.test.mjs`**. The first test needs no window. The second's fixture holds `benchmarks/evidence.mjs`,
`packages/evidence/package.json` and every `.js` and `.json` file of `packages/evidence/dist/`, all as this checkout
holds them, and the two tasks as this checkout's `benchmarks/budgets.json` defines them. So each side of a window is a
`git archive` of its commit with its own store in it, and nothing is built in a window. One commit plants the store:
it keeps the built entry as `dist/kept.js` and writes this `dist/index.js`, a store that opens its records one folder
below where the benchmark wrote them, where there are none, so its retention pass removes nothing and its put stores
what the real one does:

```js
import { join } from 'node:path';
import { openEvidenceStore as openKept } from './kept.js';
export * from './kept.js';
export const openEvidenceStore = (options = {}) => openKept(options.root === undefined ? options : { ...options, root: join(options.root, 'unseen') });
```

The test first holds the scene to the window's own readings: the change side's instructions retired are under half
the merge base's, or it fails as `INCONCLUSIVE (scene)`.

## Wrong programs

Criterion 1's is the merge base, and so is criterion 7's second test ("where it reads PASS on the merge base"); both
fail there at an assertion that names the task (`BASE-FAILURE.txt`). Criterion 7's planted store is the suite's own,
above. The others are the work with a single fault, the implementer's to plant once the work exists, each as
`tests/acceptance/3537/twins/<name>/lines.json` (`tests/acceptance/1832/README.md`, The line form), named under its
criterion's ID in `tests/acceptance/3537/twins.json`:

| Criterion | Twin | The work, with this one fault | The test's message on it |
|---|---|---|---|
| 2 | `fall-inconclusive` | a task whose instructions retired fell against its merge base reads `INCONCLUSIVE`, whatever `work` its sides report | AC2: "steady read INCONCLUSIVE on `<sha>`, not PASS: its work is equal on both sides, {"records":3000}, and its instructions retired fell by 30.83%, which is a gain". AC4 fails on it too, at `meant` |
| 3 | `takes-less` | a lowering is refused only on a task that reports no `work`; what the change's runs report is never compared with the merge base's | AC3: "the window took `<sha>`, which lowers thinned's peakBytes ceiling from 100000000 to 50000000 on five runs that reported less, records 40 where the merge base's runs report records 4000: the record isn't refused by a FAIL or BLOCKED row naming thinned, 4000 and 40" |
| 4 | `any-task` | an approved item is matched by its count and both values alone, its task never read | AC4: "the window took an approval naming steady, "Approves: benchmarks/budgets.json › steady › work.records 5000 → 5", for stray's unlike work, records 5000 on the merge base and 5 on the change, on `<sha>`: stray read PASS, not INCONCLUSIVE" |
| 5 | `missing-matches` | a count one side can't read is left out of the comparison, so the sides read as equal | AC5: "unread-change read PASS on `<sha>`: its run reports {"work":{"records":"many"}} on the change side, a count that can't be read, and {"work":{"records":3000}} on the merge base side, so the count missing on the change side was taken as a match" |
| 6 | `leaves-one-out` | the record's `noWork` leaves out the last task it found | AC6: "the record of `<sha>` leaves out plain-b, a task whose run reports no work". A record that leaves a fall out fails the same test: "it leaves out halved's instructions, which fell by more than half: 506682571 to 509174031 on the merge base and 83090571 to 102137317 on the change" |

To tell a test's fault from a program's, I wrote a throwaway guess at the change in the inputs folder's `scratch/`,
outside the checkout: a mirror of `scripts/`, `benchmarks/evidence.mjs` and the store's build, with `work` read from
each round's report, the unlike and unread rules, the approval's item, a refusing `benchmarks/budgets.json` row for a
lowering, `noWork` and `falls`, and a report line in the two evidence benchmarks. It ran only through this folder's
files copied beside it. All 8 tests passed on it. With each fault of the table planted in it, and one more that
leaves `halved`'s fall out of `falls`, the test named beside it failed at its assertion with the message quoted,
commits apart, and the others passed, but for AC4 on `fall-inconclusive`. With a window that does nothing, the seven
tests that read a window failed as `BLOCKED (window): the window left no record for …`. The guess is deleted, and it
proves nothing about the real change.

## Readings where the issue leaves a choice

- **"A window's record"** is each commit's record, where the base keeps `noCeiling` and `slack`, which the Scope
  says the new lists sit beside ("as it lists slack"). The window's own record (#2674) isn't read.
- **"The same task"** (criterion 2) is a second task of the same shape, `steady`, on the same commit: one command
  form, the same report, its own benchmark file. One record holds one row for a task, and a second commit would run
  all nine tasks again.
- **"Fell by 99%"** is the change's p50 at or under 1% of the merge base's, and the median of the rounds'
  instruction ratios at or under 1%, both by the row's own `sides`. **"Down by 30%"** is 25% to 35% by the same
  readings: the benchmark counts 31.2% fewer rounds, and `/bin/sh`'s own start, which both sides pay, makes that 30%.
- **"Reads PASS"**, **"is judged"** (criterion 4): the row's `state` is `PASS`, the base's answer to a fall. Other
  rows on the commit don't count.
- **"Naming"** is the row's `note` holding the word, or the number as JavaScript prints it, as a whole word. For
  criterion 3 it is the refusing row's `note`. "Naming the side" (criterion 5), "naming both tasks" (4) and "naming
  it" (6) are what the test's own message does when the planted program fails it; no test reads a word for a side
  from a `note`.
- **"Refused"** (criterion 3) is #2665's refusal, above. **"Its five runs report what the merge base's runs
  report"**: the fixture makes every run of a side report the same, so the tests don't depend on which runs' reports
  the work reads: the five limit runs, the rounds, or both.
- **"Reports no `work`"** and **"can't be read"**: surface 1. Not decided here, since no criterion says: a report
  whose `work` is `{}`, `null` or no object; a report line cut short; a count that is `null`; and **a side that reports
  `work` beside one that reports none**. The change that first gives a benchmark its line has that last case on every
  window that measures it, #3537's own change among them, so the tests leave what it reads to the work. The two unread
  tasks may or may not be in `noWork`.
- **"By name with their count"** (criterion 6) is how many tasks are listed, beside their names, as #2665's
  `noCeiling` counts.
- **"Each reading that fell by more than half"**: every row of the record, `shrunk`, `meant` and `stray` too, whose
  work is unlike: the Scope excludes none, and "a listed fall is a reading and fails nothing". `p95Ms` is free, since
  the merge base isn't compared on it.
- **The approval's item** (criterion 4): surface 2. "Both values" are the count's value on the merge base and on the
  change, as #2665's item holds a limit's.
- **"Both sides of an unchanged store"** (criterion 7): two runs of the task's own command against one store, which
  is what a window's two sides are on a commit that leaves the store alone; and, in the window, `evidence-put-5mb` on
  the planted commit, where what a put stores is as it was. A window over a commit that changes nothing would run the
  retention benchmark 42 times, about 11 minutes here, for the same reading.
- **"The three judges' answers on the merge base"** (Proof) and **"judged as on the merge base it reads PASS"**:
  the run on the base, in `BASE-FAILURE.txt`. Criterion 1's message there says what `compare`, `judgeInstructions` and
  `judgeCount` left in `shrunk`'s row. No test calls the three judges on made-up readings: the issue did, and their
  signatures are the work's to keep or change.

## Where the issue and the base disagree

- **3,000 or 2,700.** Criterion 1's fixture reports `{"records": 3000}`, and `benchmarks/evidence.mjs` says its pass
  "removes the 6 oldest days", 3,000 records. The store keeps the 300 of them the benchmark cites, so the pass
  removes 2,700 (`retain` in `packages/evidence/src/index.ts`; a probe of the base's store gave 2,700). Criterion 7 is
  held to 2,700.
- **"The last JSON line its run already prints."** At the base `benchmarks/evidence.mjs` prints nothing, so the two
  evidence tasks gain their report line with their `work`.
- **The counts of tasks.** The issue counts 175 tasks at `5a81b58de`, 164 with no limit and 113 of those with no
  target judge. At the base there are 183, 171 and 112. No test holds a count of the real manifest.
- **"`judgeCount` passes five readings."** On an `instructions` ceiling the base judges the change side's 20 rounds;
  five readings are a `report.<name>` ceiling's. `shrunk` carries the first kind.

## Known limits

- **Time on a shared Mac.** `shrunk`'s p50 must fall by 99% in the window's own rounds. Its change side came to
  0.3% to 0.6% of its merge-base side here; a machine that stretches a 15 ms run past 1% of the seconds-long one
  beside it at the median fails the test as `INCONCLUSIVE (scene)`. `steady`'s, `meant`'s and `matched`'s rows
  include the merge-base comparison on p50 (50%) and on instructions retired (2%), as #2665's rows do.
- **Two sides that do the same.** On the base, one row whose two sides ran the same 20,000 rounds read
  `INCONCLUSIVE` once in these runs: "instructions retired changed 0.00% over the merge base (median of 20 pairs),
  and the pairs can't tell it from 2% at p under 0.01: p 0.62 that it's above 2%", one outlier pair of counts under
  load. So no row a test needs `PASS` from has two sides that do the same: `matched`'s lowering commit also makes its
  benchmark count 30% fewer rounds for the same `work`, as `steady` does. The two unread tasks do have such sides;
  on the base an outlier there fails AC5 at its `note`, which names neither `work` nor `records`, and not at
  "read PASS".
- **The window's copy step at the base** (`git archive` fed to `tar` through `execFileSync`'s input) can end in
  `spawnSync tar EPIPE` on a loaded Mac, as #2665's README records. The row is then missing and the test fails as
  `BLOCKED (window)`, naming it.
- **`evidence.test.mjs` and the before lane's 20 minutes.** `scripts/proof-runs.mjs` gives a run 20 minutes. The
  file took 5 min 32 s to 7 min 29 s here, the window alone 5 min 5 s to 7 min 28 s; at three times that load it
  may not fit.
- **Not played**: a merge commit; a task new in its commit; a task not reached; a task with `targets`; a count
  ceiling under `report.<name>`; a lowering of an `instructions` ceiling; `work` with two counts, or a count on one
  side only; an approval for one of two unlike counts; a run whose sides' own runs disagree with each other;
  `perf.mjs`, which calls the same validation on a pull request; Linux.
- **The signed approval tag** the change itself carries, for `scripts/benchmark.mjs` and
  `scripts/budget-window.mjs`, has no test: the guard already asks for it.
- **The Scope's last task line**, "every other task gains its line in the change that next touches its benchmark",
  has no test: nothing here can see a later change.
- **Not run by this job**: `scripts/affected.mjs`, the proof lanes, a preflight, and a window in this checkout.

## What the implementer adds: outside this folder, and the twins inside it

- The work itself: `scripts/benchmark.mjs`, `scripts/budget-window.mjs` and `benchmarks/evidence.mjs` at least, under
  a signed approval tag for the two guarded scripts.
- `tests/acceptance/3537/twins/<name>/lines.json` for the five twins above and `tests/acceptance/3537/twins.json`,
  inside this folder: their lines are the work's, so they can't be written before it. No other file here changes.
- Nothing in `scripts/lanes-lists.mjs`: the folder's `lane.json` says how it runs.
- `packages/evidence/dist/` must be built where `evidence.test.mjs` runs; the lanes' own builds do that.

## Files

- `helpers.mjs`: the sandbox, the stand-ins, the fixture repository and its approvals, a window, the record readers,
  and the readers of a row's `sides` and of a run's report.
- `judged.test.mjs`: criteria 1, 2, 4, 5 and 6.
- `lowering.test.mjs`: criterion 3.
- `evidence.test.mjs`: criterion 7.
- `lane.json`: the folder runs alone, and `evidence.test.mjs` is slow.
- `BASE-FAILURE.txt`: each file's run on the base.

No fixture holds a secret or personal data. The fixture's machine and its issue link are made up, and its commits
name no issue.
