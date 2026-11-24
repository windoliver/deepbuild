# Acceptance tests for #3296: a preflight stopped part way keeps what it finished

Drafted blind, before any implementation was seen, from these inputs only:

- issue #3296 (`gh issue view 3296`): its seven acceptance criteria, and its scope text, which is the design section
  `7b` word for word. It was read again after the sentence of "What runs" on a `skips` entry was clarified;
- `docs/parallel-proof.md` sections 6, 7, 7a, 8, 10a, 11 and 12b, and AGENTS.md;
- the base's code (`a288ae247`), read only to learn the surfaces driven here: `scripts/preflight`, `preflight.mjs`,
  `checks.mjs`, `lanes.mjs`, `affected.mjs`, `throttle.mjs`, `shards.mjs`, `proof-binaries.mjs`, `proof-bin-build.mjs`,
  both reporters, `lease`, `benchmark.mjs`'s `warm` and `measureOnce`, how `proof-change.mjs` derives a criterion's ID
  and how `proof-runs.mjs` runs a suite; and for shape the suites `3137`, `3221`, `3240`, `tests/shards.test.mjs` and
  `tests/preflight.test.mjs`.

Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
npm ci --ignore-scripts --no-audit --no-fund    # once; the fixtures link this checkout's node_modules
node --test tests/acceptance/3296/*.test.mjs
```

They must run under `node --test`: only inside a test run does a throttle table of a test's own exist (section 6), and
every file refuses to start a run outside one. `binaries.test.mjs` needs a Rust toolchain (`rustc` on the `PATH`, in
`~/.cargo/bin` or in `/opt/homebrew/opt/rustup/bin`) and works offline. No file needs the network, a GPU or a model.

Each file is one scene or two, and takes 1 to 3 minutes on the 18-core Mac at a load of 70 to 290, four of them side by
side. A run's length goes with the machine (one lane run took 13 s at a load of 70, and 11 minutes at one of 400 while the
machine slept for stretches), so no bound here judges how long anything takes but one: the design's 30 s for a stop,
asserted only while the load is under the cores and a diagnostic otherwise. There is no `lane.json`: the files are
`node --test` files under `tests/acceptance/`, which the unit lane doesn't run, and no file shares anything with another
suite.

## The fixture

`scene()` in `helpers.mjs` makes a git repository in a temp folder: this checkout's whole `scripts/`, a `vitest.config.ts`
with the unit lane's globs, and a few probe test files at places the lane lists name: the parallel block (`tests/*.test.ts`),
groups of the alone block (files in folders of `lanes.mjs`'s `alone`), the timed block (a file of `timed`) and
`node --test` (`tests/*.test.mjs`). The test then runs `scripts/preflight` there, as a person does, and reads:

- which probe files were started, from the marker line each appends when its file is loaded;
- the kept lines, `~/.deepbuild/preflight/<tree>.jsonl`, as the issue gives them;
- the lane's record, `~/.deepbuild/lanes/<tree>-unit.json`, the preflight's output and its exit;
- the processes it started, by PID and start time, and the throttle's table.

Four things in it aren't the checkout's. `checks` in the fixture's `lanes.mjs` is narrowed, by lines appended to it, to the
unit lane, and that lane's commands to those the scene names; everything that lists, runs and keeps is unchanged.
`scripts/perf.mjs` is empty and `benchmarks/budgets.json` a fixture's, so only the checks are read. `cargo`, `rustc`, `npm`
and `deep` are stand-ins first on the `PATH` (`cargo test` prints two passing tests; `binaries.test.mjs` uses the real
cargo). And `machine.mjs`, loaded first into every node process, is the machine: its load reads 0, since a top-level timed
request waits for a load below the cores whatever readings a test's table has, and a job the scene names is refused its
grant by the real throttle, at once, on a second table another holder has.

`HOME`, `TMPDIR` and `DEEP_THROTTLE_TABLE` are the scene's, and every `DEEP_*`, `DEEPBUILD_*` and `GIT_*` variable of the
caller is dropped, so nothing of the machine's is read or written. With `DEEP_SHARDS=1` the lane's jobs run one after
another in the worktree; only AC7's second scene uses shards. A probe's behavior comes from flag files in the scene's
`state/`, never from the tree, so a test fails once and passes after on one tree. Every process is stopped by PID and start
time after its test.

## The tests

| Criterion | ID | File | What it checks |
|---|---|---|---|
| AC1: a stopped run resumes | `#3296.87081be7` | `resume.test.mjs` | Three runs stopped in the parallel block, an alone group and `node --test`, then one to its end and one with nothing left. No job that ended before a stop is started again, and the job part way is; each ended job's line is there at the stop, whole and once, in a file of mode 0600 in a folder of mode 0700; the record of the last two runs holds every test's row once and reads PASS; a line for a file the tree doesn't list is ignored |
| AC6: a stop leaves nothing | `#3296.72441260` | `resume.test.mjs` | The same stops, by SIGINT, SIGTERM and SIGHUP sent to the process `scripts/preflight` becomes. The part-way job holds a build it waits for, with a compiler under it, and a child in a process group of its own that ignores SIGTERM, SIGINT and SIGHUP. After the exit nothing the run started is running, the exit is 128 plus the signal, and the table holds no grant and gives timed at once |
| AC2: a bad job counts for nothing | `#3296.4125e574` | `counts.test.mjs` | A runner killed (an alone group, `cargo test`, `node --test`), a report torn in a line, a report whose end never landed, an unhandled error (an alone group, the parallel block), a refused grant, and a kept line cut in half. Each job that started left a row that reads PASS; each is started again by the next run that can, and the jobs that ended whole beside them are not. The line kept after the torn one is whole. The third run's record holds every row once, PASS |
| AC3: a FAIL or INVALID stands | `#3296.a6124068` | `stands.test.mjs` | A failure in every kind of job and an INVALID. The next run, in which each would pass, starts none of them, starts the open file beside one, and reads FAIL with each row as it was; with a PASS line planted after each, nothing is started and the rows and the lane stand; the same with one FAIL alone and with one INVALID alone |
| AC4: only under its own key | `#3296.870c9548` | `key-lines.test.mjs` | Every line's key names all seven parts as the issue gives them, and its digest is none of the plain digests of the variables. Each part, changed on the line of one job, has that job run again and no other: in an alone group for all seven, and over two runs in the parallel block, `cargo test`, `node --test` and the timed block for all seven. A FAIL kept under another host doesn't stand |
| | | `key-real.test.mjs` | `DEEP_*` and `DEEPBUILD_*` set, changed and put back, another Rust version line, another tree and back: each runs the file again or doesn't, as its key says. No value is in a kept line. And a guard: the lanes run with no preflight above them start every file and keep nothing |
| AC5: an open file | `#3296.7136c045` | `open.test.mjs` | INCONCLUSIVE rows and an unlisted skip (in the parallel block and alone groups), a row that read PASS and then INCONCLUSIVE, and a kept INCONCLUSIVE row whose job is refused its grant: the lane reads INCONCLUSIVE, and the next run runs exactly those files (the parallel block whole, an alone group's file without its neighbour). A row a `skips` entry covers is kept as it read and its file isn't run again |
| | | `unrun.test.mjs` | A file with no kept result (its job refused, twice, and its line taken away) and one with a BLOCKED row: the lane reads INCONCLUSIVE, names `1 of 5` unrun, and the next run runs exactly those files |
| AC7: a build folder emptied | `#3296.27d9fa8c` | `binaries.test.mjs` | Every job checks, as it starts, that each binary the plan built runs, in `DEEP_BIN_DIR` and in its checkout's `target/debug`, and empties both as it ends: in the worktree (the parallel block, three alone groups, the timed block, `node --test`) and in two shards |

Two readings of the text, where it leaves room:

- AC5 says a BLOCKED row makes the lane INCONCLUSIVE, while section 10a has a BLOCKED row make its lane BLOCKED. Either
  is accepted over a BLOCKED row; PASS and FAIL are not. Over INCONCLUSIVE rows and unrun files alone it is INCONCLUSIVE.
- "Run whole when any of theirs must" and "a file with a kept FAIL isn't run again" meet in the parallel block. Whether
  its failed file is started again there isn't judged; its row must read FAIL and the lane with it.

## The planted programs

The merge base is the planted program of every criterion that starts a kept job again (AC1 to AC5), forwards no signal (AC6)
and builds once at the start (AC7); `BASE-FAILURE.txt` has each test failing on it, at the named assertion. What is planted
without the implementation is planted on what the issue names: on the kept lines (a part of the key changed, a PASS after a
FAIL, a line torn, a line taken away, a line for a file the tree doesn't list), on the jobs (a killed runner, a torn report,
a refused grant) and on the judge of the record itself (a lost row and a doubled one, in `resume.test.mjs`). Each other
criterion's planted program changes the implementation, so none can be kept here as a twin of it.

They were checked instead on a throwaway implementation, written in a temp copy of the base's `scripts/` and not kept: the
whole suite passes on it, and each fault below, planted in it one at a time, fails the test aimed at it, at the assertion
that names the job, part, file, process or binary. Each was run once; a key part's fault in a scene cut to that part's group
and the control.

| Criterion | Fault | Fails, saying |
|---|---|---|
| AC1 | the parallel block and `node --test` start again though kept | "jobs that ended before the run stopped by SIGTERM were started again by the next run: p, q" |
| | an alone group starts again though kept | the same: "a, b, c, d" |
| | a kept row of `cargo test` is lost | "the lane's record doesn't hold every test's row once", missing `cargo -p tiny --lib › tests::two` |
| | a line for a file the tree doesn't list counts | the same, other `tests/gone.test.ts › one` |
| AC2 | a killed alone job counts | "the next run started `…/149/a.test.ts` 0 times: its runner was killed, and it counted" |
| | a killed `node --test` counts | the same, `tests/n.test.mjs` |
| | a killed `cargo test` counts | the same, `cargo test` |
| | a torn report's whole rows count | "… `…/1523/a.test.ts` 0 times: its report was torn, and it counted" |
| | a report with no end counts | "… its report's end never landed, and it counted" |
| | an unhandled error's job counts | "… it ended with an unhandled error, and it counted" |
| | a refused job counts | "… `…/67/a.test.ts` 0 times: it was refused its grant, and it counted" |
| | a line is appended to a torn one | "jobs that ended whole in the second run were started again by the third, their kept rows lost: `tests/p.test.ts`, `tests/q.test.ts`" |
| AC3 | a failed file is run again | "files with a kept FAIL or INVALID were run again: …", naming all six |
| | the last result wins | "with a PASS kept after each FAIL, the lane reads PASS", and "the record's row of `tests/p.test.ts`" after its real later PASS |
| | the last result wins over an INVALID alone | "over one INVALID with a PASS kept after it, the lane reads PASS" |
| AC4 | the tree, host, platform, os, node, rust or env part is ignored (seven faults) | "a kept line with another `<part>` was used: `…/149/a.test.ts` wasn't run again" |
| | the digest leaves out `DEEPBUILD_*` | "DEEPBUILD_T3296 set: the file was started 0 times, not 1" |
| | the digest holds the variables' names and no values | "DEEP_T3296 set to another value: the file was started 0 times, not 1" |
| | the digest takes no secret | "the environment's digest takes no secret" |
| | the digest holds a variable the run sets | "nothing changed: the file was started 1 times, not 0" |
| | the Rust version is a constant | "another Rust version: the file was started 0 times, not 1" |
| | the lanes keep with no preflight above them | the guard: "the kept lines changed" |
| AC5 | an INCONCLUSIVE row reads PASS | "the lane reads PASS over …", naming the files, run and kept |
| | an unrun file reads PASS | "the lane reads PASS with `…/149/a.test.ts` unrun" |
| | an open file isn't run again | "`tests/p.test.ts` and `…` were to run again" |
| | a BLOCKED file isn't run again | "`…/1523/a.test.ts`, with a BLOCKED kept row, was to run again" |
| | a listed skip's file is run again | "… whose one open row a skips entry covers, was started 4 times in four runs" |
| AC6 | no signal is forwarded | "the stopped preflight left processes it started running", naming each, for all three signals |
| | the stop reaches the preflight's child alone | the same |
| | SIGTERM is sent and nothing after it | the same, naming the child that ignores it |
| | SIGHUP isn't handled | the same, for SIGHUP alone |
| | the stop exits 1 | "the preflight didn't exit with 128 plus the signal" |
| AC7 | the alone block builds once at the start | "jobs started without a binary the run's plan built": `seen3296` and `placed3296`, in the worktree and in a shard |
| | the lane's own jobs build once at the start | the same: "`seen3296` missing at the start of `tests/n.test.mjs`" |
| | only `DEEP_BIN_DIR` is built again | the same: `placed3296` |

## Out of reach

- **Host, platform, operating-system build and Node version** can't differ for real between two runs on one machine, so
  each is planted on the kept lines, and the key's value is compared with the machine's. Where the machine keeps its secret
  isn't named, so that the digest is keyed is checked only against the plain digests a program might write.
- **The guard's list** (the script that keeps and reads the lines joins it): the script has no name in the issue.
- **The 30 s of a stop** is a reading on a machine whose load is above its cores, as every run here was.
- **The release preflight** (`DEEP_PREFLIGHT=release`) runs the same unit lane; it isn't run apart.
