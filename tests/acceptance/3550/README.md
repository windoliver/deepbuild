# Acceptance tests for #3550: the threads under each grant

Drafted blind from issue #3550, the design it links (`docs/parallel-proof.md` sections 6 and 13, as
`node scripts/design-section.mjs --issue 3550` prints them, with the one bullet this issue adds to section 6, "Threads
by grant (#3550)", which lands with the change: the base's doc doesn't hold it yet), the issues #3550 names (#2673,
#3067, #3240, #3221 and #3238, for the words it cites), AGENTS.md, CONTRIBUTING.md and the base commit `2edb19ff4`.
For call shapes, sandbox technique and the lint lane's rules I also read the base's `scripts/throttle.mjs`,
`scripts/wait-ratchet.mjs` and `tests/acceptance/3067/`, `3240/` and `3567/`. The helpers are this suite's own; no
test imports the code under test: `scripts/throttle.mjs` is run as a process. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft.

## Run

```sh
node --test tests/acceptance/3550/report.test.mjs
node --test tests/acceptance/3550/unread.test.mjs
node --test tests/acceptance/3550/sample.test.mjs
node --test tests/acceptance/3550/cost.test.mjs
```

On the Mac (the issue's "Runs on"), from the checkout. They must run under `node --test`: only inside a test run
does a table of a test's own exist (section 6). Each test carries its own limit.

| File | Takes | Load it makes |
|---|---|---|
| `report.test.mjs` | about 1 s | none |
| `unread.test.mjs` | 4 to 8 s | none: its stub grant idles |
| `sample.test.mjs` | about 7 s | 12 threads spinning for about 3 s, then 6 for about 3 s, at the lowest priority |
| `cost.test.mjs` | 10 min 6 s (the criterion's 10 minutes), in a file of its own to be scheduled apart, as #3067's and #3240's are | none: the sampler itself, a sample a minute |

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox and a temporary `HOME` there, with
`DEEP_THROTTLE`, `DEEP_THROTTLE_RUN`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and
`DEEP_THROTTLE_READINGS` unset. Each process starts in its own process group and is stopped by that group's PID:
the stubs of `sample.test.mjs` as soon as the sample is in the log, the rest after their test. `load` is stopped by its
own PID (SIGTERM). Nothing is stopped by name or port. **A stub that spins ends by itself 45 s after its start**,
whatever became of the test that started it.

No `lane.json`: the suite needn't run alone, since what it asserts doesn't move with the machine's load: a stub's
runnable threads are a count, the listing `load` was given is kept, and the cost is the sampler's own CPU time. It
needs no line anywhere else.

## The surface

- `node scripts/throttle.mjs load`, stopped by its PID, and `load.log` in the table's folder: one JSON line a sample,
  the first at its start. The fields read are the bullet's: `procs`, `threads` and `runnable` on each `grants` entry
  and on `outside`, `runTop` (`command`, `runnable`, `grant`) and `threadsUnread` (a short reason), beside #3067's and
  #3240's.
- `node scripts/throttle.mjs load --report` over a `load.log` in the table's folder, by the lines the bullet states:
  `threads read in <n> of <m> samples`, `runnable <name> <t>, <p>%`, `held <what>: <n> of <m> minutes, <p>%, median
  load <l>, cores busy <b>, idle <i>, under grants <c>, runnable threads under grants <g>, outside <o>` and `top
  commands under no grant, mean runnable threads: <command> <t>, ...`. Only standard output is read.
- `node scripts/throttle.mjs <class> --wait 1 -- node spin.mjs <name> <threads>` holds a stub grant. The stub notes
  its pid and the `DEEP_THROTTLE` it sees (`<class>:<id>`, the grant's ID). For two nested grants the command is itself
  `throttle.mjs timed --wait 1 -- node spin.mjs ...` under a `test` grant, as in #3067's suite: timed never passes
  through, so it is a second grant, nested in the first; the outer grant's ID is read from the table's `log`
  (`granted`, by the holder's pid).
- **A stub that "spins N threads"** is one `node` process with N worker threads in a loop that never waits, at the
  lowest priority (`os.setPriority(19)`). A thread that spins is runnable for as long as it spins, running or waiting
  for a core, so its count doesn't move with the machine's load: the test's own listing read exactly 8, 4 and 6
  runnable threads in every reading, at a 1-minute load of 10 and of 60.
- **The thread listing is the one the bullet names**, `ps -A -M -o pid=,state=`, run by name from the `PATH`: a line a
  thread, ending with its process's pid and the thread's state, runnable when the state starts with `R`; its first
  line names no thread. A process ps lists as a zombie has no line in it.
- **Two references, both the test's own.**
  1. *The test's own listings*: `/bin/ps -A -o pid=,ppid=,ucomm=` and `/bin/ps -A -M -o pid=,state=`, read a few times
     a second from before `load` starts until its first sample is in the log. "Within 1" is: no more than 1 below the
     least and no more than 1 above the most that the stub's tree read in those listings.
  2. *The listing `load` itself was given.* `load` runs with a ps of the sandbox's first on its `PATH` that hands every
     call to `/bin/ps` and, for a thread listing (a call with `-M` among its options), keeps what `/bin/ps` printed,
     byte for byte. The test asserts `load` asked for exactly one and that it reads as the bullet's does (it names
     the stubs' processes, each line ending with a pid and a state), and then holds the sample to it exactly: the
     grant's `procs`, `threads` and `runnable` are that listing's for the grant's processes, and `outside`'s are that
     listing's for every other process, the listing's own ps among them (the bullet: a process the process listing
     didn't name goes to `outside`). This is what holds `outside`, which is the whole machine, on both sides.
- **A thread listing that can't be made** is arranged by the same ps on the `PATH`: every other call is handed to
  `/bin/ps`; a thread listing either exits 1 with a marked error naming a path under the sandbox's `HOME`, or exits 0
  with the listing's first line alone, which names no thread.
- **Names.** The grant's holder, its child and the ungranted process are all named `node`: this Mac's `node` is a small
  launcher that finds its library beside itself, so a link or a copy of it in the sandbox, under a name of the test's
  own, doesn't start. `runTop` therefore tells the test's stubs apart by their grant: `node` under the grant's ID is
  the grant's processes alone, and `node` under no grant is the ungranted process and every other session's `node`.

## The tests

| Criterion | File, test | What it holds | Wrong program, and where it fails |
|---|---|---|---|
| #3550.20462570 | `sample.test.mjs`, "one stub grant whose child spins 8 threads and one ungranted process spinning 4" | One `test` stub grant whose child spins 8 threads, one ungranted process spinning 4. The sample isn't failed and holds no `threadsUnread`; `grants` is exactly the one grant, by its ID, with class `test` and the holder's pid; the entry and `outside` each hold whole numbers `procs`, `threads` and `runnable`. The grant's `runnable` is within 1 of the 8 the test's own listings read under its holder; `outside.runnable` is at least the ungranted process's 4 less 1. Then, against the one listing `load` was given: the grant's three numbers are exactly its holder's and child's, and `outside`'s exactly every other process's. `runTop` has five entries at most, none at 0, one for a name under one grant or under none, a `grant` only when it is this table's ID, and no more runnable threads under a grant or under none than that grant or `outside` has; `node` under the grant's ID reads exactly the grant's processes' runnable threads, and `node` under no grant at least the ungranted process's, each listed unless five entries have as many. Last, the Change's "Unchanged": both stubs still ran when the sample was in the log, and the table's log holds no line of `load`'s. | **counts-processes**: the work, but each process the thread listing names counts as one thread, runnable when any of its threads is. Fails at `the grant <id>'s runnable is 1; the test's own thread listing read 8 runnable threads under its holder around the sample, so it must be within 1 of that`: the message names the grant by its ID. |
| #3550.106a37e8 | `sample.test.mjs`, "a process under two nested grants has its threads counted once, under the outer one" | A stub spinning 6 threads under a `timed` grant nested in a `test` grant. `grants` is exactly the two, with their classes and holders' pids. The outer grant's `runnable` is within 1 of the 6 the test's own listings read under the outer holder, and so are the two grants' together; the inner grant's `procs`, `threads` and `runnable` are 0. Against the listing `load` was given: the outer grant's three numbers are exactly the two holders' and the spinner's, and `outside`'s exactly every other process's. `runTop` has no entry under the inner grant's ID, and `node` under the outer's reads exactly the tree's runnable threads. | **counts-twice**: the work, but a process's threads are added to every grant above it, not to the outermost alone. Fails at `the two grants' runnable together (6 under the outer <id> and 6 under the inner <id>; a process counted under both makes it twice the tree's) is 12; the test's own thread listing read 6 runnable threads under the outer holder around the sample`. |
| #3550.02fff002 | `unread.test.mjs`, "with the thread listing made to fail" and "with a thread listing that names no thread" | One idle stub grant; the sandbox's ps fails the thread listing (first test) or answers it with no thread (second). The first sample isn't `failed`, lists the grant and holds `outside`'s CPU; it holds a non-empty `threadsUnread`, no `procs`, `threads` or `runnable` in the grant's entry or `outside`, and no `runTop`; the log holds neither the failing ps's error text nor a path under a home. Then `load --report` over that log prints `threads read in 0 of 1 samples` and no `runnable`, `held` or top-commands line. | **zeros-on-failure**: the work, but a sample whose thread listing couldn't be made holds `procs`, `threads` and `runnable` of 0 and an empty `runTop`, with no `threadsUnread`. Fails both at `the sample taken while the thread listing was made to fail [named no thread] doesn't say the threads weren't read, in threadsUnread, a short reason`. |
| #3550.02fff002 | `unread.test.mjs`, "load --report over a fixture log counts a sample whose threads weren't read in no share" | `fixtures/unread.jsonl` (below). Prints `threads read in 1 of 3 samples`; exactly `runnable build 10.00, 25.0%` and `runnable outside 30.00, 75.0%`; exactly one `held` line, `held build: 1 of 1 minutes, 100.0%, median load 40.00, cores busy 13.00, idle 5.00, under grants 4.00, runnable threads under grants 10.00, outside 30.00`; top commands `rustc` 12 and `node` 8. | The report half of the criterion: a report that counts a sample without the three numbers as zeros fails at `the report counts the samples whose threads were read, 1 of 3`. |
| #3550.31d7907e | `report.test.mjs`, five tests | `fixtures/threads.jsonl` (below). (1) `threads read in 11 of 13 samples`; exactly the lines `runnable build 7.20`, `runnable bay-pair 0.00`, `runnable test 7.00` and `runnable outside 20.00`, with shares each within 0.1 of 21.053%, 0%, 20.468% and 58.480% that add up to 100.0. (2) Exactly six `held` lines, each with its minutes of 11, its median load and its five means to two decimals, in the order `build and test`, `test`, `nothing`, `build`, `timed`, `build and bay-pair and test`, with shares each within 0.1 of its exact value that add up to 100.0. (3) One top-commands line naming exactly `rustc` 6.4, `node` 5, `clang` 2.6, `swiftc` 1.6 and `ld` 1.4. (4) The lines by kind, in order: those the report printed before, the samples read, the runnable threads, the minutes held, the commands; the share of minutes above the cores (7 of 13) and `GPU read in 12 of 13 samples, 0.000 s in all` are still printed. (5) `fixtures/before.jsonl`, a log from before the threads were read: `threads read in 0 of 3 samples` and no more of these lines. | **every-minute**: the work, but the report's `runnable` lines and its top commands are taken over every sample whose threads were read, not over those above the cores. Fails test 1 at `one line a class that held a grant in the samples above the cores whose threads were read and one for outside, ...` (it prints `runnable build 9.82` and a `runnable timed` line) and test 3 at `the five commands runTop named under no grant with the most runnable threads`. |
| #3550.397ab2ea | `cost.test.mjs` | `load` runs 10 minutes and 5 s beside one idle stub grant, with the machine's own ps, as the child of a shell that then prints `times`. The first sample already holds its threads (no `threadsUnread`, the three numbers for `outside` and every grant, and `runTop`); at the end `load` is still running, ends on a SIGTERM to its PID, wrote 10 or 11 samples, each with its threads read, and its user and system CPU with the listings it waited for is under 1% of the elapsed time. | **every-second**: the work, but the thread listing is made every second, not once a sample. Fails at `the sampler used <s> s of CPU in 605 s, <p>% of one core; the bound is 1%` (about 10% here). |
| #3550.712a690c | `sample.test.mjs`, "the log still holds PIDs, grant IDs, classes and command names only" | The sample of criterion 1, whose stubs were each started with a marked argument, a marked environment value (the sampler has it too) and a script under the sandbox's `HOME`. Precondition: the sample holds a non-empty `runTop` and the three numbers on every entry. `load.log`'s text holds none of the argument, the environment value, the sandbox's `HOME`, the sandbox, the user's home, `.mjs`. Every text in the sample is `at`, a `class` of the four, an `id` or `grant` that is this table's, #3240's `gpuUnread`, or a `command` with no `/` and 16 characters at most, which for an entry with a `pid` equals what the test's own ps printed as that pid's `ucomm`; `runTop`'s entries under the grant are named as ps names its processes. | **run-arguments**: the work, but `runTop` names each command by its whole command line (ps's `args` in place of `ucomm`). Fails at `load.log holds a stub's argument (argument-3550-9c4e17)`; were neither stub among the five, at `a command that isn't a name as ps prints ucomm`. |

**#3550.8a169e11** ("The 24-hour table from the reference Mac, with the threads, is on this issue, and the follow-up
it names is filed") is a step by hand: no test here covers it.

### The fixtures

Named `.jsonl` since the repository ignores `*.log`. Every sample is on 18 cores and has the base's fields.

`fixtures/threads.jsonl`, 13 samples:

| # | Load | Threads | Grants, in the table's order, with their runnable threads | `outside` runnable | Held | Above the cores |
|---|---|---|---|---|---|---|
| 1 | 44.5 | read | test 6 | 20 | test | yes |
| 2 | 9.25 | read | none | 3 | nothing | no |
| 3 | 61 | read | test 9, build 14 | 22 | build and test | yes |
| 4 | 80 | the sample failed | | | | |
| 5 | 12.5 | read | timed 2 | 1 | timed | no |
| 6 | 18 | read | build 30 | 4 | build | no: equal to the cores |
| 7 | 95.5 | `threadsUnread` | build, with no numbers | | | |
| 8 | 70.25 | read | build 12, bay-pair 0, test 5 | 18 | build and bay-pair and test | yes |
| 9 | 5.25 | read | none | 2 | nothing | no |
| 10 | 72 | read | build 10, test 8 | 25 | build and test | yes |
| 11 | 33 | read | test 3, test 4 | 15 | test | yes |
| 12 | 17.5 | read | build 26 | 6 | build | no |
| 13 | 16.75 | read | build 16, test 12 | 10 | build and test | no |

Each read sample's `runTop` holds five entries at most, under grants (`rustc`, `node`, `deep-app`) and under none
(`rustc`, `node`, `clang`, `swiftc`, `ld`, `cargo`, `mdworker`). Wrong reports it tells apart: the runnable threads
or the commands over every read minute, not those above the cores (build 9.82, a `runnable timed` line, `cargo`
among the five); a sample whose listing failed counted as a zero (build 6.00, `held build` with 3 minutes, 12 minutes
in all); each share rounded alone (21.1, 0.0, 20.5 and 58.5 add up to 100.1; 27.3, 18.2 three times and 9.1 twice
add up to 100.1); a class with a line only when it has runnable threads (no `runnable bay-pair 0.00`); the mean load
for the median (49.92 for `build and test`), or the middle of the loads as the log holds them (72); the classes in
the order a sample lists them (`test and build`); equal counts ordered by name or by class rather than as the log
first holds them; the commands under a grant counted with those under none (`rustc` 12.8, `deep-app` among the five);
a command's mean over the samples that name it rather than over all five (`rustc` 8.0).

`fixtures/unread.jsonl`, 3 samples above the cores: the first holds its threads (a build grant's 10 runnable threads,
`outside`'s 30; `runTop` names `rustc` 12 and `node` 8 under no grant and `rustc` 9 under the grant); the thread
listing of the other two failed, one beside a build and a test grant, one with nothing held.

`fixtures/before.jsonl`, 3 samples as the base's sampler writes them, with no `procs`, `threads`, `runnable`, `runTop`
or `threadsUnread`.

## How each criterion is read

- **#3550.20462570, "gives each its runnable threads within 1, to the grant's ID and to `outside`".** The grant's are
  held to the test's own listings within 1, which is where a sampler that asks ps the wrong question (processes for
  threads) fails, naming the grant. `outside` is every other process on a shared machine, 5 to 57 runnable threads in
  the runs here and never the same twice, so the ungranted process's 4 can't be read off it within 1 against a
  listing made at another moment: it is held from below against the test's own listings, and on both sides, exactly,
  against the listing `load` itself was given.
- **#3550.106a37e8, "counted once, under the outer one".** Once: the two grants' `runnable` together are the tree's,
  not twice it, and `outside` holds none of them (exactly the rest of the listing). Under the outer one: the outer
  grant's count is the tree's and the inner grant's three numbers are 0, as the bullet has it ("once, in the
  outermost") and as #3067's CPU reads.
- **#3550.02fff002.** "Made to fail" is read as both of the bullet's cases a test can arrange: a ps that fails, and a
  listing that names no thread. "The report counts it in no share" is read twice: on the report over the log that
  sample is in (`0 of 1`, and no more lines), and on a fixture where a read sample stands beside two unread ones, so
  a share exists to be wrong.
- **#3550.31d7907e** is read on the bullet's lines, with the fixture's expected numbers. A log from before the change
  holds samples whose threads weren't read, so the report over it says `0 of <m>` and no more: the machine's own log
  holds thousands of them.
- **#3550.397ab2ea, "with the thread listing"**: every sample, the first one too, holds its threads.
- **#3550.712a690c, "still holds ... only"**: #3067's and #3240's check of the first sample, over the new fields, with
  stubs that carry the marks spinning while it is read. Threads that were read leave no reason text. The reason of a
  listing that failed is held to the sampler's own words in `unread.test.mjs` (no ps error text, no path under a
  home), under #3550.02fff002.

## Where the issue and the design differ

Neither is picked over the other: where they say different things, the fixtures hold only cases both read the same
way; where the design says more than the issue, the tests hold what it says.

- **What a timed minute is.** The issue's table has a row "A timed grant", with no "only", beside "A build only" and
  "A test only"; the bullet has one line for each set of classes, so a minute with a test grant and a timed grant
  nested in it is `held test and timed`, not a timed minute. The fixture's timed grant is held alone.
- **The design says more than the issue, and nothing against it.** The bullet puts `threads read in <n> of <m>
  samples` before the lines the issue's Change lists; its `held` line carries the runnable threads under grants and
  outside, which the issue's table (drawn from a log without threads) doesn't; and its shares of minutes are of the
  samples whose threads were read, where the issue's table is of every minute of a log in which none was unread
  (the issue's third criterion, "counts it in no share", reads the same way).

## Gaps and assumptions

- **The suite has passed on one program only**, a throwaway guess of this job's (below), never on the work.
- **`ps` by PATH, and the listing's form.** `load` must ask the `PATH`'s ps for its thread listing, once a sample, as
  the bullet states. Only a call with `-M` among its options is taken for one, and its lines must end with a pid and
  a state; its other words aren't held. A sampler that runs `/bin/ps` by its path, lists threads twice, or lists them
  in another form fails criteria 1 and 2 where the test names the listings it was asked for, and criterion 3 at
  "doesn't say the threads weren't read".
- **`runTop` under no grant is held from below.** `node` under no grant is every session's, so its count is held to at
  least the ungranted process's runnable threads, and to no more than `outside`'s. Which commands are the five is
  held only for the test's own: one that isn't listed must have no more runnable threads than each of the five.
  `runTop`'s order isn't asserted.
- **Not tested:** a ps that can't be run at all (the process listing runs the same name); a machine other than macOS
  (every live test skips there as `INCONCLUSIVE`; the report tests run anywhere); that a process the process listing
  didn't name is in no `runTop` (it is held in `outside`'s numbers); the form of `threadsUnread` beyond a non-empty
  text without ps's words; "adds no cap", which nothing here can see; the Change's "Design" line, which is the doc's
  own change; a report over read samples of which none is above the cores, or whose runnable threads are all 0.
- **A stub that stops spinning reads INCONCLUSIVE**, by a skip that says so, never a pass: when the test's own
  listings, or the listing `load` was given, show a stub's tree with 2 or more of its threads not runnable. It didn't
  happen in any run. On the base every test fails before that, at its first assertion on the new fields.
- **The report's open forms.** The numbers on the last line are compared by value (`6.4` and `6.40` both pass), and
  its commands in any order; the `runnable` lines may come in any order among themselves; shares are held to within
  0.1 of the exact share and to a sum of 100.0, not to one rounding rule; "threads read in" counts every sample as
  `<m>`, the failed one too ("over every sample"). The thread lines must follow every line the report printed before
  ("goes on with"), and the commands come last.
- **Cost.** As #3067's and #3240's: the shell's `times` for its children, the sampler and the listings it waited
  for, with one idle grant held. About 6,600 threads in 1,150 processes were listed on this Mac.
- **Paths under a home folder** are the user's home (from the password database) and the sandbox's `HOME`.
- **Fixed waits**, each marked `// deadline:`: the limits that turn a hang into a failure, and the cost test's ten
  minutes, which are the criterion's own.
- **darwin only**: `/bin/ps`, its `-M` listing and `ucomm`, and `/bin/sh`'s `times`, as macOS has them.

## On the base

`BASE-FAILURE.txt` (base `2edb19ff4`, macOS, 18 cores, 1-minute load 61 to 69): 12 fail, 0 pass, 0 skipped, in 12 s,
each file run once. Every failure is at an assertion of the suite's and for the expected reason: the base's sampler
makes no thread listing, so its samples hold none of the new fields and its report none of the new lines.
`cost.test.mjs` fails at its first sample, in 2 s. The test of #3550.712a690c fails there only at its precondition
(the sample holds no `runTop`), so its criterion is shown failing by a wrong program.

## What ran, and what didn't

- **On the base:** every file, three times as the suite was drafted (at 1-minute loads of 10 to 15 and of 61 to 69),
  the last time with the files as they are here, always with the same verdicts.
- **On a throwaway guess at the change** (a copy of the base's `throttle.mjs` with the bullet's fields and lines, kept
  outside the checkout with a copy of this folder beside it, never committed, and deleted when this job ended;
  `scripts/` here is the base's, byte for byte): all 12 pass with the files as they are here, at a 1-minute load of
  53 to 55. `sample.test.mjs` passed three times as it was drafted, at loads of 10 to 15, 60 and 53. The cost test
  read 1.93 s of CPU in 605 s, 0.319% of one core, over 11 samples each with its threads (2.14 s and 0.353% in an
  earlier run).
- **The guess with one rule planted wrong**, each seen failing where the table above says: counts-processes,
  counts-twice, zeros-on-failure, run-arguments, and, on the report, every-minute, shares rounded alone, unread
  samples counted as zeros, the mean or the unsorted middle for the median, equal counts ordered by name, and granted
  commands counted with the ungranted. A sampler that lists the threads twice, and one that lists them in another
  form, fail criteria 1 and 2 where the test names the listings it was asked for. every-second was run for one
  minute, not ten, with the test's `MINUTES` set to 1 in the copy: 6.62 s of CPU in 66 s, 10.1%, failing at the
  bound. counts-processes, counts-twice and run-arguments were run before the test learned to name a listing in
  another form; the assertions they fail at come before it and didn't change.
- **Spinning**, in all: ten runs of a few seconds each, one of them a probe of the stub.
- **Not run:** `scripts/affected.mjs`, the proof lanes and the preflight (the machine's lines are hours long);
  anything on Linux. `scripts/wait-ratchet.mjs` and `scripts/studied-names.mjs` find nothing in this folder. The twins
  (`twins/`, `twins.json`) are the implementer's to add, from the wrong programs named above.
