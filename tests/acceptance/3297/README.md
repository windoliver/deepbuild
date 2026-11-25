# Acceptance tests for #3297: a preflight that fills its results, then finishes

Drafted blind, before any implementation was seen, from these inputs only:

- issue #3297 (`gh issue view 3297`): its six acceptance criteria and its scope text, which is the design section for `7b`
  word for word, with the owner's answer, (a);
- issue #3296, which it depends on, and its suite `tests/acceptance/3296/`, read for the shape of a fixture lane that the
  real `scripts/preflight` runs (nothing is imported from it);
- `docs/parallel-proof.md` sections 6, 7, 7a, 7b, 8, 10a and 12a, and AGENTS.md;
- the base's code (`3cab59fbd`), read only to learn the surfaces driven here: `scripts/preflight`, `preflight.mjs`,
  `checks.mjs`, `lanes.mjs`, `affected.mjs`, `perf.mjs`, `throttle.mjs`, `proof-kept.mjs`, `benchmark.mjs`'s `warm`,
  `measureOnce`, `prepareCopy` and `compare`, `bays.mjs`'s `replace`, both reporters, `lease`, how `proof-change.mjs`
  derives a criterion's ID, and `tests/perf.test.mjs` and `tests/preflight.test.mjs`.

Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
npm ci --ignore-scripts --no-audit --no-fund    # once; the fixtures link this checkout's node_modules
node --test tests/acceptance/3297/*.test.mjs
```

They must run under `node --test`: only inside a test run does a throttle table of a test's own exist (section 6), and every
file but `doc.test.mjs` refuses to start a run outside one. No file needs the network, a GPU, a model or a Rust toolchain.

On the 18-core Mac at a load of 15 to 60 each file takes about a minute on a program that passes, the five side by side; on
the base `fill.test.mjs` takes over three, since three requests wait their whole bound. Nothing here judges how long anything
takes: each bound turns a hang into a failure, and counts the test's own steps, so a machine asleep or too busy to run the
test doesn't run it down. `timed.test.mjs` runs its alone block in two shards, so its run is admitted only with 10 GB of disk
free (section 7a), though it uses little of it. There is no `lane.json`: the files are `node --test` files under
`tests/acceptance/`, which the unit lane doesn't run, and no file shares anything with another suite.

## The fixture

`scene()` in `helpers.mjs` makes a git repository in a temp folder: this checkout's whole `scripts/`, a `vitest.config.ts`
with the unit lane's globs, and a few probe test files at places the lane lists name: the parallel block (`tests/*.test.ts`),
groups of the alone block (files in folders of `lanes.mjs`'s `alone`), `node --test` (`tests/*.test.mjs`), and the files of
`timed` each of those commands lists. The test then runs `scripts/preflight` there, as a person does, and reads:

- when each probe's file ran and what the throttle's table held then, from the lines it appends as it is loaded and after its
  last test, with the time;
- the throttle's log, of the scene's table, for the grants: which, when, and by which process;
- the kept lines, `~/.deepbuild/preflight/<tree>.jsonl`, and the unit lane's records, `~/.deepbuild/lanes/<tree>-unit.json`;
- the preflight's output and its exit.

Another session is a process of the test's own that asks the scene's table for a `build` grant, under no grant of any run's.

Five things in the fixture aren't the checkout's. `checks` in its `lanes.mjs` is cut, by lines appended to it, to the unit
lane, whole, and one lane of a single command, which tells a finish from a fill; everything that lists, runs and keeps is
unchanged. `benchmarks/budgets.json` is a fixture's, with a margin no load can cross. `scripts/perf.mjs` is a stand-in that
notes its start, but in `perf.test.mjs`, where it is the checkout's. `cargo`, `rustc`, `npm` and `deep` are stand-ins first on
the `PATH` (`cargo test` prints two passing tests, a warm-up build takes as long as the scene says, `npm ci` links this
checkout's modules). And `machine.mjs`, loaded first into every node process, is the machine: its load reads 0, since a
top-level timed request waits for a load below the cores whatever readings a test's table has.

The fixture's `.gitignore` is as the repository's where perf's copy turns on it: `target/`, which doesn't cover the copy's
`target` link, and an ignored folder that holds a tracked file. `HOME`, `TMPDIR` and `DEEP_THROTTLE_TABLE` are the scene's,
and every `DEEP_*`, `DEEPBUILD_*` and `GIT_*` variable of the caller is dropped, so nothing of the machine's is read or
written. A probe's behavior comes from flag files in the scene's `state/`, never from the tree. Every process is stopped by
PID and start time after its test.

## The tests

| Criterion | ID | File | What it checks |
|---|---|---|---|
| AC1: other sessions work while it fills | `#3297.758dee21` | `fill.test.mjs` | A build request another session makes while the parallel block, an alone group, `cargo test` or `node --test` runs, each held part way, is granted before the preflight ends, by the log; beside all but `cargo test`, itself a build, while that job still runs. The preflight they were made beside runs every file once and exits 0 |
| | | `timed.test.mjs` | No timed grant is held while an untimed job runs; each one held before the last file ends is for one timed file's run; there are as many as timed files, and one more, after the last file, for the finish |
| AC2: a timed file is a job of its own | `#3297.dab8afb0` | `timed.test.mjs` | For two timed files of the alone block, two of the parallel block and one of `node --test`, with the alone folders in two shards: nothing runs beside it, the timed grant it runs under is its own, in the log and in the table it finds, and its kept line names that one file. With the kept lines of one of each kind taken away, the next run starts those three and no other, each under a grant of its own |
| AC3: a finishing run | `#3297.0a3b3b31` | `finish.test.mjs` | A file whose runner is killed, and one whose kept row is INCONCLUSIVE: exit 3, `INCONCLUSIVE preflight: 1 of 5 test files have no result on this tree: …` naming it, no PASS for the unit lane in output or record, and nothing of a finish. Then the same command runs that file and finishes; with nothing to fill it finishes at once; with a FAIL that stands it finishes and fails. Each finish starts no file that has a kept result, takes one timed grant, prints both lines and its record says `"kept": {"read": 5, "of": 5}` |
| AC4: the budget times the finish | `#3297.3773818a` | `finish.test.mjs` | A kept line's `run` is its preflight's and its `ms` its job's. The `Kept:` line's jobs, seconds and runs are the kept lines', over real ones and over planted ones far past the budget, with a line of another host's beside them left out. `Checks elapsed` is at least the warm-up builds' 3 s and at most the time the finish held its grant, no other line says the kept time, and the budget doesn't fail by it |
| AC5: perf's base side | `#3297.17071219` | `perf.test.mjs` | With every result of the merge base's tree kept, the merge-base run starts no job and like sides pass; with one file's line taken away it starts that job alone. With that line, or with all of them, taken away the workload line reads INCONCLUSIVE, perf doesn't pass and the preflight exits non-zero; each side's record says what it read. The checks without the change's own tests, which run whole, never pass against a base side that read its results |
| AC6: the owner's choice | `#3297.80732be9` | `doc.test.mjs` | `docs/parallel-proof.md` states that the owner chose (a), and not (b) |

Two tests are guards and carry no tag, since they pass on the merge base too: `fill.test.mjs`'s run ends whole, and
`doc.test.mjs`'s judge tells short pages apart.

Readings of the text, where it leaves room:

- "Every timed file" is every file of the unit lane that `lanes.mjs`'s `timed` names, by whichever command the lane lists it:
  the list holds files of the parallel block and of `node --test` too, and section 7 has it "run only under a timed grant".
- An untimed job "runs as any session's does (an admitted run's on turns of the pool)", and an alone group's turn takes no
  build grant. So a build request made beside one that stands still is granted while it stands, and a program that holds the
  Mac's one build grant around the whole alone block fails. The request made beside `cargo test` may wait for it.
- The preflight's end, for a request, is the log's release of its last timed grant, or its exit: the base's requests are
  granted between the two.
- Whether an open file counts among the `<n>` with no result isn't said, so with one open its line may say any count; it names
  the file.
- A timed file is a job of its own, so #3296's rule for jobs holds for each: one whose kept rows all ran isn't started because
  another must. No timed block is left to run whole.
- A job run again leaves two kept lines. Which of them the `Kept:` line counts isn't said, so no scene that reads it has any.
- "Its workload line" is perf's JSON line of the task `preflight`, or a verdict line `INCONCLUSIVE perf: …`: either may say so,
  and neither may pass.
- "The two sides" are the two that perf compares. With test files of the change's own, that is the checks without them.
- "Its own tree" is the merge base's, the one a preflight on it keeps its results by, though perf's copy of it holds a
  `target` link and, made with `git add -A`, lacks the tracked files an ignore pattern covers.

## The planted programs

The merge base of this issue is the planted program of AC1 (it claims timed for the whole run), of AC2 (it runs its timed
files in one job, and those of the parallel block and `node --test` beside others), of AC3 (with a file unrun it runs the rest
of the checks and prints `Checks elapsed`), of AC4 (`Checks elapsed` times the files it ran, and no line has the kept time)
and of AC5 (the base side runs whole, and unlike sides pass); `BASE-FAILURE.txt` has each test failing on it, at the named
assertion. What can be planted without the implementation is planted on the kept lines (times and runs of the test's own, over
the budget, another host's line, an INCONCLUSIVE row, a FAIL, a line taken away), on the jobs (a killed runner) and on short
pages for AC6. Each other planted program changes the implementation, so none can be kept here as a twin of it.

They were checked instead on a throwaway implementation, written in a temp copy of the base's `scripts/` and not kept: the
whole suite passes on it, and each fault below, planted in it one at a time, fails the test aimed at it, at the assertion that
names the wait, file, line or side.

| Criterion | Fault | Fails, saying |
|---|---|---|
| AC1 | claims timed for the whole fill | "the build request another session made while `tests/p.test.ts` ran (the parallel block) waited 190.6 s, to the preflight's end, and wasn't granted before it; held meanwhile: timed grant …, the preflight", and so for the other three; "the preflight held a timed grant while `tests/p.test.ts`, which isn't timed, ran from …" |
|  | holds the build grant around the alone block | "… while `…/149/a.test.ts` ran (an alone group) waited 62.2 s, until that job had ended; held meanwhile: build grant …" |
|  | runs the parallel block, or `node --test`, under timed | "… (the parallel block) waited 61.5 s, until that job had ended; held meanwhile: timed grant …", and "the preflight held a timed grant while …" |
|  | runs `cargo test` under timed | "the preflight held a timed grant while cargo test, which isn't timed, ran from …" |
|  | takes the finish's grant twice | "the preflight took 2 timed grants after its last file ended: the finish takes one" |
| AC2 | the alone block's timed files in one job | "the kept line of `…/1018/budgets.test.ts` (job vitest-timed) names other files: `…/46/budgets.test.ts`" |
|  | the parallel block's timed files run in it | "`…/15/budgets.test.ts`, timed, ran from … to … beside other files" |
|  | `node --test`'s timed file runs in it | the same: "`tests/preflight.test.mjs`" |
|  | one runs beside an alone group | the same: "`…/1018/budgets.test.ts`" |
|  | those outside the alone block run alone with no grant | "`…/15/budgets.test.ts` ran from … to … under 0 timed grants of the throttle's log" |
|  | one grant over all of the alone block's | "`…/1018/budgets.test.ts`'s timed grant isn't its own: other files ran under timed grant …" |
|  | a kept line names the other timed files | "2 kept lines name `…/1018/budgets.test.ts`" |
|  | the timed files run again together when one must | "the kept lines of … alone were taken away", and another started |
| AC3 | finishes whatever the fill left | "it finished early, with `…/1523/a.test.ts` unrun, its runner killed: it ran these of the finish", and so with it open |
|  | finishes over an open file | "it finished early, with `…/1523/a.test.ts` open, its kept row INCONCLUSIVE" |
|  | finishes while one file alone is unrun | "it finished early, with `…/1523/a.test.ts` unrun" |
|  | exits 1 with a file unrun | "it exited 1, not 3, with `…/1523/a.test.ts` unrun" |
|  | reads PASS for the unit lane with a file unrun | "the unit lane reads PASS with `…/1523/a.test.ts` unrun" |
|  | the finish reads no kept result | "a finishing run takes one timed grant, under which no file runs: 1 were taken, 0 of them with no file under it (under the others ran `tests/p.test.ts`, …)" |
|  | takes the finish's grant twice | "… 2 were taken, 2 of them with no file under it" |
|  | prints no `Kept:` line | "it prints no line "Kept: …"" |
|  | takes a file whose FAIL stands for an open one | "a finishing run takes one timed grant …: 0 were taken", in the run whose FAIL stands |
|  | the fill runs every lane | "the finish runs the checks' other lane once, not 2 times" |
|  | the record says no count, or counts jobs | "the record of the run "filled" says undefined", "says {"read":6,"of":5}" |
| AC4 | adds the kept time to what the budget bounds | "Checks elapsed is 27.08 s, longer than the finish held its grant, 5.0 s: it holds more than the finishing run", and over the planted times the budget fails |
|  | adds it to the line alone | the same |
|  | times from the start of the fill | the same |
|  | times without the warm-up builds | "Checks elapsed is 1.94 s, less than the warm-up builds' 3 s" |
|  | leaves the kept time out (no line, or 0 s) | "the kept jobs' machine time is left out", "its Kept: line says 0 s of machine time over kept jobs of 22.2 s" |
|  | counts another host's line | "the jobs of its Kept: line: those kept under this run's own key" |
|  | counts one run whatever the lines say | "the runs of its Kept: line, over the kept jobs of two preflights" |
|  | names the tree, or the job, as a line's run | "`…/1523/a.test.ts`'s job, which the second preflight ran, names the first's run"; "the jobs one preflight ran name 5 runs" |
|  | keeps a line's time in seconds | "the job of `…/1523/a.test.ts`, which took over 20.0 s, says 0.0 s" |
| AC5 | runs the base side whole | "the base side started jobs whose kept results of its own tree are whole: the merge-base run ran these again": `p, a, b, n, cargo test` |
|  | gives the base side the change's key | the same |
|  | reads the base side by its copy's tree, with the `target` link, or without the ignored files | the same, each |
|  | reads the change's results for the base side | "the base side was to run `…/149/a.test.ts` alone, whose kept line of its own tree was taken away" |
|  | passes unlike sides | "perf passed unlike sides: the merge base's tree keeps 3 of its 4 files' results …, and its workload line reads PASS", and so with none kept |
|  | passes sides that each read some | the first of those |
|  | passes a side that read none | the second of those |
|  | compares the change's own count with the base's though the checks without its tests ran whole | "perf passed unlike sides: the checks without the change's own tests ran p, a, n, cargo test, and the base side read every result" |
|  | reads INCONCLUSIVE whatever the counts | "the workload line of like sides" |
| AC6 | the page with the design and no answer, or with (b) | "the letters docs/parallel-proof.md says the owner chose …": none, `b`; with the answer (a) it passes |

## Out of reach

- **A checkout with no tree git can write** "keeps nothing and runs as before": `tests/preflight.test.mjs` runs the preflight in
  folders that are no repository, and isn't repeated here.
- **The release preflight** (`DEEP_PREFLIGHT=release`) runs the release lanes after the finish; they spend plan usage.
- **A change's side that read no results**, against a base side that did, can't be made: a finishing run reads them all.
- **The load a top-level timed request waits for** is read as 0 by `machine.mjs`, so how long a timed file waits for its grant
  on a busy machine isn't seen. A refusal would leave the file unrun, which AC3 covers by a killed runner.
- **Two preflights of one tree at once**, and a stop while it fills: #3296's suite has the stop, of the whole run.
- **The guard's list** (a script that decides a verdict joins it): no script is named in the issue.
