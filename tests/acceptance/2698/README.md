# Acceptance tests for #2698: one reader for a live process, and the idle, memory and start tasks report it

Written first and blind from issue #2698 (its six acceptance criteria as given to this job on November 16, 2026),
`AGENTS.md` and `docs/technical-design.md` (Numbers version 0 has to hold; How we know version 0 works: Dogfooding,
Wrong programs, Criteria in a checked shape; Built to be hard to get wrong), at base commit
`9ae04c6cd980f3c37fc64bcf5938b5169e1e7c52`, which has no reader. Also read at that commit: `benchmarks/hub.mjs`,
`hub-churn.mjs`, `mcp.mjs`, `status.mjs`, `read-instructions.c` and `budgets.json`, `scripts/count-children.c`,
`scripts/benchmark.mjs`, how `scripts/lanes.mjs` reads a failure that names its own state, the two reports the issue
links, and `tests/acceptance/1404`, `1405`, `1421` and `2634` as models. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Run

```sh
node --test --test-concurrency=1 'tests/acceptance/2698/*.test.mjs'
node --test tests/acceptance/2698/ac1-wakeups-cpu-instructions.test.mjs   # one criterion
node tests/acceptance/2698/selfcheck.mjs                                  # the suite against itself, no reader needed
```

One file at a time: every file reads real processes on the machine the others would load. They need macOS and `cc`;
AC4's two `hub-idle` tests, AC5 and AC6 also need a built checkout (`npm ci`, `npm run build`). At a load of 46 to 59
on 18 cores AC1 took 59 s, AC2 35 s (it waits up to 3 minutes for the machine to compress), AC3 6 s and AC4's two
reader tests 3 s. AC4 and AC5 run `hub-idle` twice each, and AC6 runs `deep-status-30` and `deep-mcp-30d` once each.
The folder is in no list of `scripts/lanes.mjs` (alone, slow, timed): this job writes new files in this folder only.
The suite adds no dependency: Node's own modules, `cc`, `ps` and `/usr/bin/time`. Its scratch files go under the
system's temp folder and are removed when each file's process ends.

## Criterion, test and pass rule

| Criterion | Test | Passes when |
|---|---|---|
| AC1 | `ac1-…test.mjs`, `#2698 AC1 the reader gives …` | Over five runs of `fixtures/spin-wake.c`, each read from before its work to after it: the reader's wakeups are within 10% of the 100 timed sleeps the fixture woke from (90 to 110); its CPU time is within 10% of the fixture's own, by `getrusage` over the same work; its instructions over the five runs are within 2% of each other, `(max − min) ÷ min`; the span it states lies between the shortest and the longest the test's clock allows; and the 1-minute load average was above the core count at the start and end of every run. |
| AC1, wrong program | `#2698 AC1 a planted reader backed by ps fails, naming the wakeups` | `planted/ps-backed.mjs`, read over the same five runs, fails the same assertions with `AC1 run 1 of 5: wakeups: … gives none (missing) …`. |
| AC2 | `ac2-…test.mjs`, `#2698 AC2 the reader gives a footprint …` | For `fixtures/hold.c`, which holds 200,000,000 bytes rounded up to whole pages: the reader's footprint while it holds, less its footprint at its start, is within 5% of the bytes held; and the kernel reports 45% to 55% of those bytes compressed just before the readings and just after. |
| AC2, wrong program | `#2698 AC2 a planted reader that gives resident memory fails, naming the bytes` | `planted/resident-memory.mjs`, read at the same two moments, fails with `AC2: footprint: … gives <n> bytes above its start (…), with <n> of the fixture's bytes compressed by the machine; expected within 5.0% of the <n> bytes the fixture holds (<n> to <n> bytes)`. |
| AC3 | `ac3-…test.mjs`, `#2698 AC3 a child the fixture starts and keeps …` | For `fixtures/family.c`: the kept child is in `processes` by its PID, with wakeups and CPU time within 10%, footprint within 5% and instructions within 2% of the child's own; and for each of those four, `total` is no less than the parent's plus the kept child's, and no more than those plus the ended child's once (for the footprint: plus nothing), each within the same share. |
| AC3, wrong program | `#2698 AC3 a planted reader that reads only the parent fails, naming the child` | `planted/parent-only.mjs`, over the same span, fails with `AC3: the kept child <pid> is not read beside its parent <pid>`. |
| AC4, the reading | `ac4-…test.mjs`, `#2698 AC4 with the reader's call failing, the reading is missing` | Asked for PID 1, which the kernel refuses to read for this user, the reader throws nothing, and every reading in `total` and in PID 1's own entry, if it gives one, is null: none is 0 and none is a number. |
| AC4, wrong program | `#2698 AC4 a planted reader that returns 0 fails, naming the field` | `planted/returns-zero.mjs`, asked the same, fails with `AC4: total.instructions, total.cpuMs, total.wakeups, total.footprintBytes, …: … gives 0 where the kernel refused …`. |
| AC4, the task | `#2698 AC4 with the reader's call failing, hub-idle reads INCONCLUSIVE, naming the reading` | `hub-idle`, run in a copy of the checkout where its benchmark's `startReading` asks the real reader for PID 1 in place of the hub: its last line gives no number for any of the hub's four readings, has `status: "INCONCLUSIVE"`, and its `reason` names each of them (wakeups, instructions, CPU, footprint). |
| AC4, the task's wrong program | `#2698 AC4 hub-idle on a planted reader that returns 0 fails, naming the field` | The same run on the planted reader fails the same assertions with `AC4: hub.<field>…: hub-idle reports 0 where the kernel refused the reader's call`. |
| AC5 | `ac5-…test.mjs`, `#2698 AC5 hub-idle reports …` | Two runs of `hub-idle`, each exiting 0 with a last line that still holds `bench`, `mode`, `idleCpuPercent` and `rssBytes`, a `spanMs`, the four readings as numbers for `hub`, whose PID the process table showed as the task's child, and the four readings for each child the table showed under the hub from before the span to its end; the hub lived at least 15 s plus the span; and the two runs' `hub.instructionsPerSecond` are within 10% of each other, `(max − min) ÷ min`. |
| AC6 | `ac6-…test.mjs`, one test for `deep-status-30` and one for `deep-mcp-30d` | The task exits 0 and its last line still holds what it reports today, and: `instructions` and `emptyInstructions`, one positive count per round, the same number of rounds; each empty count within half to twice the test's own `/usr/bin/time -l` reading of an empty Node program; for `deep-status-30`, the command's count above the empty program's in every round; `peakFootprintBytes` at least 1 MB; and `modules`, names that include the command's entry, `packages/cli/dist/main.js`, and not the benchmark's own file. |

## What fails on the base, and why

The base has no reader and its tasks report none of the readings. Run at the base, built, on macOS:

- The four tests of the real reader (AC1, AC2, AC3, and AC4's reading) fail at once with `no reader:
  benchmarks/process-reader.mjs does not exist …`. An assertion says so; no import fails.
- AC4's two `hub-idle` tests fail the same way: there is no reader to make fail under the task.
- AC5 fails with `hub-idle's last line reports no reading for the hub (\`hub\`): {"bench":"hub","mode":"idle",…}`.
- AC6 fails twice with `<task>'s last line reports no \`instructions\`, one count for each round: {…}`.
- The four reader-level planted tests don't fail on the base: they need no reader. Each shows its criterion's
  assertions failing a wrong program, which is the proof the design asks of a test for code the merge base doesn't
  have (Wrong programs). AC2's reads INCONCLUSIVE on a run in which the machine compressed nothing: resident memory
  is then the footprint, and nothing tells the two readers apart.

`BASE-FAILURE.txt` is this job's own run at the base, which was not built: the reader tests as above, and AC5 and AC6
`BLOCKED: an unbuilt checkout`. Their failures on a built base are read from the base's code, not run.

## The planted programs

Each is a module with the reader's own exports, read through the same code as the real reader (`surface.mjs`).

| File | Wrong in | Fails |
|---|---|---|
| `planted/ps-backed.mjs` | Reads `ps`'s CPU time and resident memory, as `benchmarks/hub.mjs idle` does today. `ps` has no wakeups and no instructions | AC1, naming the wakeups |
| `planted/resident-memory.mjs` | The clean twin, with resident memory given as the footprint | AC2, naming the bytes: it read 99,287,040 and 100,106,240 bytes for 200,015,872 held |
| `planted/parent-only.mjs` | The clean twin, reading no child | AC3, naming the child |
| `planted/returns-zero.mjs` | The clean twin, giving 0 where the kernel refuses | AC4, naming the fields, as a reader and under `hub-idle` |

`planted/twin.mjs` is the clean twin: a reader this job wrote from the issue alone, on `fixtures/probe.c`. Three planted
readers are it with one fault each, and `selfcheck.mjs` holds the assertions against it. No test compares the real
reader with it: every expected value comes from the issue or from the fixture's own account of what it did.

## Assumptions

The issue names the four tasks and their last lines, and nothing about the reader's place or call. Everything
assumed is in `surface.mjs`, and the implementing job can meet it without touching this folder:

- **A1. Where.** The reader is `benchmarks/process-reader.mjs`, and the benchmarks call it by importing
  `startReading` from that module, in their own process. AC4's task tests put another `startReading` in its place in
  a copy of the checkout: one that asks the real reader for PID 1 and hands its reading back under the PID the task
  named. The module's other exports stay the reader's own there.
- **A2. How.** `startReading(pid)` gives, or resolves to, `{ stop() }`. The span runs from one to the other.
- **A3. A reading.** `stop()` gives, or resolves to, `{ spanMs, processes: [{ pid, instructions, cpuMs, wakeups,
  footprintBytes }], total: { instructions, cpuMs, wakeups, footprintBytes } }`. `processes` holds the process asked
  for and each child it keeps; `total` is their sum. `instructions`, `cpuMs` (user and system CPU, in ms) and
  `wakeups` are over the span; `footprintBytes` is the physical footprint at the span's end.
- **A4. Missing.** A reading that can't be taken is `null` or left out, never 0, and neither call throws for it.
  Where the process asked for can't be read, `total` is missing too.
- **A5. A task that can't take a reading** says so in its last line as `benchmarks/hub.mjs start-to-ready` does
  today: `status: "INCONCLUSIVE"` and a `reason`.
- **A6. `hub-idle`'s last line** gains `spanMs`, `hub: { pid, wakeups, instructionsPerSecond, cpuMsPerSecond,
  footprintBytes }` and `children`, a list of the same for each child the hub keeps. A reason names a missing
  reading by its word: wakeups, instructions, CPU, footprint.
- **A7. `deep-status-30`'s and `deep-mcp-30d`'s last lines** gain `instructions` and `emptyInstructions`, lists
  with one count per round in the same order; `peakFootprintBytes`, one number or one per round; and `modules`, a
  list with a name for each module the command loaded.

## How each criterion is reached

Each reader test drives its fixture once and has the real reader and the planted one read the same process over the
same span (`criteria.mjs`: `collect`, then `judge` per reader). A fixture prints one JSON line per step and waits
for a line before the next, so a span opens while it is idle and closes when it is idle again.

- **AC1.** `spin-wake` spins a fixed number of loops, then sleeps 100 ms and wakes, 100 times. The loops are sized
  once per file to 100 ms of CPU (`spin-wake calibrate`), so all five runs do the same work. Its "done" line is the
  oracle: the sleeps it woke from and its own CPU time. It also says what the kernel counted for it, which the test
  uses only to tell a wrong reader from a host that can't show the criterion.
- **AC2.** `hold` writes every page, then keeps the first half in use and tells the machine it doesn't need the
  second half now (`madvise` DONTNEED, which on macOS keeps the bytes). Only the machine compresses. Each status
  line counts the held pages no longer in core, by `mincore`. The test waits up to 3 minutes for 45% to 55%, reads,
  and looks again.
- **AC3.** `family` starts both children before the span opens, one it keeps and one that will end; all three then
  work at once, and the parent reaps the one that ends inside the span. The ended child does twice the kept pair's
  CPU work and 1.5 times their sleeps, so counting any real share of it again lands outside the limit.
- **AC4.** PID 1 is a live process whose reading the kernel refuses to a user who is not root: the test's own probe
  confirms `Operation not permitted` first. The task test runs the budget's own command in a copy of the checkout
  (`benchmarks/` copied, the rest linked) whose reader module re-exports the real one and replaces `startReading`.
- **AC5.** While `hub-idle` runs, the test lists the process table twice a second: which PID was the task's child,
  how long it lived, and which children it had. That is the oracle for `hub.pid`, the 15 s and "each child".
- **AC6.** The test reads an empty Node program itself: the median of three `/usr/bin/time -l node <empty file>`.

## BLOCKED and INCONCLUSIVE

A test that can't prove its criterion fails with a message that starts with its state, which `scripts/lanes.mjs`
reads as that state. A wrong reading fails first: only a reader whose readings are right can read unproven.

| State | When |
|---|---|
| BLOCKED | Not macOS. `cc` can't build a fixture. The checkout is not built (AC4's task tests, AC5, AC6). The kernel gives this user PID 1's reading, as it does root (AC4). The host's kernel keeps no instruction count, or counts other than one wakeup per timed sleep (AC1, AC3). `/usr/bin/time -l` reports no instructions (AC6). `ps` gave no look at the process table (AC5). |
| INCONCLUSIVE | The load was not above the core count at the start and end of all five runs (AC1). The kernel's own counts of the fixture's instructions were more than 2% apart (AC1). The machine did not compress 45% to 55% of the fixture's memory within 3 minutes (AC2). The task's own last line reads INCONCLUSIVE (AC5, AC6). The hub kept no child in either run (AC5). |

## Readings where the issue leaves a choice

1. **"Spins for 100 ms"** is a fixed spin sized to 100 ms, not a spin that watches a clock: a timed spin retires
   different instructions on a fast and a slow core, and the criterion asks for equal counts.
2. **"Its CPU time within 10%"** is against the fixture's own CPU time over the same work, about 100 ms.
3. **"Wakeups"** are the timed sleeps the process woke from. On this Mac the kernel's interrupt wakeups read exactly
   100 for them, and its package idle wakeups read 0 at every load tried.
4. **"200 MB"** is 200 × 10⁶ bytes, as `benchmarks/hub-churn.mjs` counts a MB; 200,015,872 on 16 KB pages.
   **"Above its start"** is the difference of two readings, one before the fixture holds anything.
5. **"Half"** is 45% to 55% of the bytes held.
6. **AC3 states no limits.** It takes AC1's and AC2's for the same readings. "Not counted twice" is a sum of no more
   than once: a reader may count the ended child's work once or not at all.
7. **"The reader's call failing"** is a live process the kernel refuses, not a PID that isn't there.
8. **"Agree within 10%"** is on the hub's own instructions a second. A child such as the hub's `log stream` does
   the machine's work, not the build's.
9. **"After 15 s to settle"** is checked as what it needs: the hub lived at least 15 s plus the stated span.
10. **"From the same rounds"** is one count per round for the command and for the empty program.
11. **`deep-mcp-30d`'s own instructions** are held only to being counts: `deep mcp` stays up across rounds, and the
    issue doesn't say whether a round's count is the round's or the process's so far.

## Limits

- **Not run against the real tasks.** The base was not built here, so AC4's task tests, AC5 and AC6 ran only against
  throwaway stand-ins for `benchmarks/hub.mjs`, `status.mjs`, `mcp.mjs` and `deep`, shaped as A5 to A7 say and kept
  out of the repo. Against them each passed (AC5 with the stand-in's rate fixed), and each failed on a line wrong in
  one way: no children, a 2 s settle, rates 17% apart, no INCONCLUSIVE, a reason naming nothing, an empty count
  copied from the command's, one empty count for five rounds, the benchmark's own modules, a peak in MB.
- **AC2 depends on the machine.** In three runs here it compressed exactly the unused half 21 s, 32 s and 51 s after
  the fixture wrote it (14,000 pages free at the first). In three others it compressed nothing in 180 s (340,000
  pages free at one), and both AC2 tests read INCONCLUSIVE. Nothing a process may do makes the machine compress.
- **AC1's 2% has little room on a slow spin.** A first spin that retired 0.27 G instructions read 2.3% apart by the
  kernel's own counts at a load of 170 to 200. The spin now retires 1.5 to 1.7 G in the same 100 ms and read 0.15%
  to 0.5% apart over five runs, at loads of 15 to 200.
- **AC5 can fail on two honest runs.** The Nov 13 report's own idle rounds on one build read 6.3 to 7.1 M
  instructions a second with one of 10.4, and on the other 11.0 to 11.7 with one of 15.4.
- **`hub-cold-start`** is in the issue's scope and in no criterion: no test.
- **"No new dependency, and no change to a budget's value or a criterion's text"** is a diff review.
- **Off macOS** every test reads BLOCKED: "each is missing until that platform has a reader" is not tested there.
- **The trace lane** refuses an acceptance test that imports the code under test by its path where the issue names
  a surface. This issue names none for the reader, so `surface.mjs` imports `benchmarks/process-reader.mjs` by path,
  in that one place.

## The suite against itself

`selfcheck.mjs` runs AC1 to AC4's fixtures read by the clean twin and by each planted reader. At writing the twin
passed all four and each planted reader failed as the table above says, AC2 on the runs in which the machine
compressed. With the twin put where A1 says, in a stand-in checkout, all ten reader and planted tests passed.
Hand-made readings wrong in one way each failed the judges by name: idle wakeups, wakeups counted twice, CPU time
in kernel ticks, instructions 3% apart, a wrong span, a footprint 6% off, a child listed and not summed, an ended
child counted 1.5 and 2 times, an ended child's memory still counted, one zero, a sum of other processes, a throw.
