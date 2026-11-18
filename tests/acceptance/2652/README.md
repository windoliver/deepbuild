# Acceptance tests for #2652: each run the gate runner keeps holds only what it reads

Written blind from issue #2652 (its Scope, its 5 checkbox criteria and its Proof), `docs/technical-design.md` (How runs
become one of five verdicts; Numbers version 0 has to hold; How we know version 0 works: Wrong programs, Criteria in a
checked shape, Dogfooding), `AGENTS.md`, and base commit `3cf41958f` (origin/main). The job that wrote them never saw an
implementation of #2652. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The base code was read for its surfaces only: `packages/hub/src/gate-runner.ts` (`records`, `recorded`, `kept`,
`outputOf`), `shared-runs.ts` (`keptRecord`), `runs.ts` (`run.start` with a `command` goes through the command check
kind and `recorded`), `core.ts` (the start's read of kept runs), `core-worker.ts`, `stop-judging.ts` (the send-back that
quotes `outputOf`), `plant.ts`, `packages/checks-command/src/index.ts` (how an output is captured), the record's
`run.started`/`run.finished` schemas, and `benchmarks/hub-churn.mjs` (#824: the hub's heap through its inspector). Sibling
suites, for conventions and helpers: `tests/acceptance/1018` (whose `helpers.ts` AC5 imports), `tests/acceptance/323`
(whose `helpers.ts` AC2 imports: the final message's command and its send-back), `tests/acceptance/29`, `31` and `875`
(imported through those), and `tests/acceptance/2516` and `1434` (a suite run unchanged through a Vitest child).

| AC | Tag | Criterion, in short | Test |
| --- | --- | --- | --- |
| AC1 | `#2652.8e8af2a5` | after a command check that prints 8 MB the hub's retained heap is under 64 KB above its value before the run; over 8 MB on the merge base | `ac1-output-heap.test.ts` |
| AC2 | `#2652.71abd7a1` | `outputOf` returns the merge base's 2,000 characters for runs that printed 100, 2,000, 2,001 and 8 MB, standard error first; a runner keeping the first 2,000 fails, naming the run | `ac2-output-of.test.ts` |
| AC3 | `#2652.a3e2a15d` | a hub started on 3,000 kept runs of one check with 500 paths each retains under 20 MB for them, by the map's own retained size in a heap snapshot; over 100 MB on the merge base | `ac3-kept-paths.test.ts` |
| AC4 | `#2652.e46eede4` | each kept run carries the result the merge base carries for it, on #1018's suites, unchanged | `ac4-1018-unchanged.test.ts` |
| AC5 | `#2652.669feed5` | a runner that shares one `read` list between two runs and then changes it for one fails, naming the other run | `ac5-shared-read.test.ts` |

Tags are derived as `scripts/proof-change.mjs` derives them: `#2652.` and the first 8 hex of the SHA-256 of the
criterion's text after `- [ ] `, trimmed, white space collapsed. Each `describe` carries its tag.

## How to run

Node 24.22 (`.node-version`) first on `PATH`:

```sh
npm ci                                                    # once, if node_modules is missing
npm run build --workspaces                                # the deep CLI every hub here runs from
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # AC2, AC4 and AC5 drive sessions through it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2652 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2652/tsconfig.json
```

- Every file starts hubs of its own, and AC4 runs #1018's hub suite, so the folder belongs on `scripts/lanes.mjs`'s
  one-at-a-time list (`alone`), beside `tests/acceptance/1018/`. The implementer adds it.
- Folders are under `/tmp/dh2652-*` (AC1, AC3, AC4), `/tmp/dh323-*` (AC2) and `/tmp/dh1018-*` (AC5), each removed after
  its test; HOME is the test's own for every process it starts. Processes are stopped by PID only. No network, no
  model, no `claude` or `codex` binary.
- With `--root`, Vitest writes `node_modules/.vite/` under this folder (and AC4's run of #1018 under that one); delete it
  before committing.
- On the base, on a Mac at a load near 250 on 18 cores, AC1 took 33 s, AC2 15 s, AC3 16 to 26 s, AC5 64 s and AC4
  about 11 minutes, nearly all of it #1018's hub suite (`BASE-FAILURE.txt`).

## The readings

### AC1: the hub's retained heap around one command check

- **The surface.** The hub's socket, as the CLI reaches it: `run.start` with a `command`, which the hub runs through
  the command check kind, as it runs a claim's check, and whose record the gate runner keeps (`recorded`). The command
  is `node print.mjs <bytes>`, a program that prints a test runner's report on standard output: 100-byte lines, each
  starting with a check mark, and exits 0. The test writes the same lines, so a run counts only when it passed and its
  standard output's evidence (`run.finished`'s first digest) is the SHA-256 of exactly the 8,000,000 bytes it printed;
  any other run is `BLOCKED`, never a pass.
- **The reading.** The hub runs as `node --inspect=127.0.0.1:0 --no-opt --no-maglev --no-sparkplug --no-flush-bytecode
  <deep cli> hub run` (#824's benchmark turns the same tiers off, so the compiler's own work after warm-up isn't read as
  kept data). Through its inspector, each thread (the main thread and every worker, the core's among them) gets two full
  collections, and the reading is the sum over the threads of `heapUsed + external - arrayBuffers`, the least of three
  readings in a row. `external` is in it because Node 24 keeps a decoded text of more than about 1 MB as an external
  string: its characters sit outside the heap V8 counts as used while a heap object holds them, so the heap alone never
  sees a kept 8 MB output (on the base the heap alone grew 70 to 100 KB for one). ArrayBuffer backing stores are left
  out (Open points 1). The added `--no-flush-bytecode` stops V8 dropping old bytecode between readings, which
  moved a reading by up to 220 KB in calibration.
- **The run.** After two 8 MB checks and one 100-byte check (every path taken once before any reading), five times: a
  100-byte check, a reading, an 8 MB check, a reading. The 100-byte check before each means a hub that kept only its
  newest output still grows by 8 MB at each. The median of the five growths must be under 64,000 bytes (64 KB, as the
  repo writes 1 MB as 10^6 bytes). A kept output that is a slice of the whole one (`slice(-2000)` of an external
  string) still holds the whole, and reads so. The message names each run and its growth, and both readings per thread.

### AC2: `outputOf`, read where a send-back quotes it

- **The surface.** `outputOf` is what the gate's send-back quotes for a command the agent's final message tells you to
  run (#323): "the command your final message tells you to run, \`<command>\`, fails:" and a newline, then what it
  printed. Through a real hub, deep-hook and a Claude Code stand-in (#323's helpers, unchanged), a session makes its
  definition's check and the repo's spec pass (#323's `FIX` and `FLAG`) and stops on a final message whose shell block
  lists four commands, `node scripts/out.mjs 100`, `2000`, `2001` and `8000000`. Each prints that many characters and
  fails, so the stop's reply quotes each one's output.
- **What each prints.** `n` characters in all: `min(500, n/2)` of them on standard output, written first, and the rest
  on standard error, each a run of 9-character units (`E0000017 `, a newline for every eighth), so any 2,000 characters
  differ from any other 2,000. Standard error therefore shows in all four quotes, before standard output, though it was
  written second. A run counts only when it failed and its evidence digests are those of exactly what the program
  printed, and only when it ended before the stop's reply (else the hold ended first: `BLOCKED`, run again on a quieter
  machine).
- **The merge base's rule**, written in the test: standard error, a newline, standard output, each left out when it is
  only white space, and the last 2,000 characters of that. For each run the reply must hold "\`<command>\`, fails:", a
  newline, exactly those characters, and then the send-back's next mark (a semicolon before the next command, a full
  stop at the end). Each run that isn't quoted so is named by its handle, with what it printed and what the reply quotes.
- **The planted test** runs the same scenario under `keeps-output-head` and requires the judgement to fail, naming the
  run that printed 8 MB.

### AC3: the map's own retained size

- **The record.** The hub starts once on a fresh home and stops. Its record then gets 3,000 kept runs of one check,
  written through the record's public entry while the hub is stopped, as #1018's budget suite keeps its keys: each a
  `run.started@1` and a `run.finished@2` that passed, with a whole record (`plain: true`) and its key. All 3,000 are on
  one key whose paths are the same 500 paths of about 70 characters, as runs of one check on one tree's files are
  ("1,000 runs of one check hold 1,000 copies of the same strings"), each from a claim of its own. Each row's paths come
  from its own `run.finished`, so the hub parses each run's 500 strings anew, as it does for real rows.
- **The reading.** The hub starts again with its inspector. Its core's thread (the worker whose `workerData` holds
  `core`) writes a heap snapshot (`v8.writeHeapSnapshot`). "The map" is the gate runner's map of run records,
  `records`, which the issue names (`gate-runner.ts:205`): the `records` property of the one `GateRunner` object. Its
  own retained size is read as Chrome's DevTools defines it: the self sizes of every node reachable from it that the
  snapshot's root no longer reaches once it is gone, weak edges left out and shortcut edges kept only at the root.
- **What must hold.** The map's table holds every one of the 3,000 run handles (the hub read each kept run at its
  start, so the reading is about them), and its retained size is under 20,000,000 bytes. On the base it retains
  145.22 MB.

### AC4: #1018's suites, unchanged

Behavior that must not change, so it passes on the merge base. `tests/acceptance/1018/hub.test.ts` runs as it is,
through Vitest in a child process with a JSON report, as #1018's README runs it, and each of its 10 tests must end as it
ends on the merge base: its five criteria (#1018.a7bf0857, ce3898ef, 13494a7e, 9f44c904, 681b96a8: one base run read
as carried, carry that follows read files, a shared run counted once, a flaky key INCONCLUSIVE in both claims, a
held-out variant's verdict carried and hidden) and each of their planted runners failing.

On the merge base nine pass and one fails: #1018's own AC1 test, after its carry holds (one base run, read as carried by
the four other claims). Its five claims edit `test/cart.test.ts`, the file their check loads, so since #33 the check
counts as the agent's own and each verdict is INCONCLUSIVE, not the PASS it expects (Open points 8). That test may pass
here, or fail with that same failure (its PASS assertion, its verdicts naming the check as the agent's own because the
claim changed `test/cart.test.ts`); any other failure of any test fails AC4, named with its message.

Its budget files (`budgets.test.ts`, `redraft-ac6/budgets.test.ts`, `../1018-redraft-1830/`) time carrying on a
reference Mac and judge no carried result, so they are left out. The kept runs a restarted hub reads are AC5's ground
(below), which #1018's hub suite never restarts to reach.

### AC5: two kept runs with one list of paths

- **The scenario**, through a real hub, deep-hook and #29's Claude Code stand-in (#1018's helpers, unchanged). A repo
  with a drafted check, `.deepbuild/checks/cart.sh` (`node --test test/cart.test.mjs`, a test that reads `src/cart.ts`
  and passes on any version that defines `total`), and two worktrees cut from one commit. In the hub's first life a
  session in each worktree, one after the other, adds one line to `src/cart.ts` naming its worktree and stops; each
  claim runs the check, A in the first and B in the second. Both pass and read the same paths with other contents, so
  each is on a key of its own whose paths equal the other's (checked, else `BLOCKED`). The hub stops; both worktrees'
  `src/cart.ts` go back to the commit; the hub starts again on that record, so A and B are kept runs it reads at its
  start. In its second life a new session in each worktree makes the same change and stops.
- **The judgement.** Each second-life claim reads its worktree's kept run as carried: its verdict (`verdict.made`, and
  its line from `changes.read`) names that run's handle and says `carried`, and the claim ran no run of the check
  itself. Every kept run that doesn't carry is named.
- **The planted test** runs the same scenario with `shares-read-across-runs` in the second life and requires the
  judgement to fail, naming B, the other run.

## Planted programs

The hub selects each with `DEEP_HUB_PLANT=<name>` (`packages/hub/src/plant.ts`). On the base the hub refuses both names
(`names no planted program`), so both planted tests are `BLOCKED` there, never a pass. This job can't edit `plant.ts`:
the implementer adds each name to `Plant` and `PLANTS` with exactly this behavior, and nothing else changes with it.

| `DEEP_HUB_PLANT` | AC | What the planted runner does |
| --- | --- | --- |
| `keeps-output-head` | AC2 | The gate runner keeps the first 2,000 characters of what `outputOf` shows in place of the last. For a run whose standard error and standard output, joined as `outputOf` joins them (standard error, a newline, standard output, each left out when only white space), are longer than 2,000 characters, `outputOf` returns the first 2,000 of that text; a run of 2,000 characters or fewer reads as on the merge base. Everything else, the run's hashes and its verdict included, is the change's. |
| `shares-read-across-runs` | AC5 | When the hub reads its kept runs at its start, a later kept run of a check whose key paths equal an earlier kept run's of that check gets the earlier run's list itself, as its `read` and as its key's paths, where the change shares one list between a kept run's `read` and its key: after this, the two runs hold one array. Right after, the runner changes that list for the earlier run alone, as a runner that edits a run's reads in place would: it appends the path `src/read-by-a-only.ts` to the earlier run's `read`. The later run's `read` and key then hold that path too, though it never read it, so a claim whose files equal the later run's key no longer finds it. |

## Open points: readings this suite chose

1. **ArrayBuffers in AC1.** On the base each command check that prints 8 MB also leaves its 8,000,000 bytes in the
   core thread's `arrayBuffers` (16.93 MB before one such run, 24.93 MB after it, in BASE-FAILURE.txt's AC1), held by
   nothing a heap snapshot or `queryObjects` reaches from JavaScript, and apart from `records`: emptying the kept
   outputs through the inspector (calibration, not in the suite) freed the external strings and left those bytes. AC1
   reads the heap and the strings it holds outside itself, not ArrayBuffer backing stores, so it neither counts that nor
   the pooled buffers Node's I/O keeps (a 64 KB pool buffer comes and goes between readings). Whether those bytes are
   in #2652's scope is the owner's call; they are the same size whether or not `records` keeps the output.
2. **"Prints 8 MB"** is 8,000,000 bytes of UTF-8 (AC1) and 8,000,000 characters (AC2, all ASCII). AC1's lines carry a
   check mark, as a test runner's report does: its text is then UTF-16 inside V8, about 15.7 MB for 7.84 million
   characters, and it is the same text whatever its form. The base's growth is "over 8 MB" either way.
3. **One run, five readings.** One check's growth moves by tens of KB from one reading to the next on the base (the
   hub's own timers allocate as it runs), so AC1 takes the median of five checks, each read as "after against before
   the run"; the base's five were 15.73 to 15.78 MB.
4. **AC1's runs are `run.start`'s**, which the gate runner records as it records a claim's, not runs of a claim. A
   claim's own state, its verdicts and its send-back would also grow the heap, and the criterion is about the run.
5. **AC3's one key.** All 3,000 runs are on one key. With a key each, the base's groups would also hold each run's
   parsed paths, and the strings would no longer be the map's own to retain; on one key they are, as for the audit's
   "1,000 runs of one check". The map must hold every kept run by its handle, so a change that keeps them elsewhere
   fails here rather than passing on an empty map.
6. **AC2's split.** "A run that printed n characters" is read as n characters over both streams, so each quote holds
   standard error before standard output; the boundaries of the 2,000 then fall on the joined text, 2,001 and 2,002
   characters long for the 2,000 and 2,001 runs. The planted test requires only the 8 MB run to be named, since a
   runner that kept the first 2,000 characters of each stream apart would quote the other three as the base does.
7. **AC5's observable.** A shared list changed for one run reaches the other run through its key: the later run no
   longer carries, its claim runs the check itself, and the judgement names it. A change that copied the paths for its
   key while sharing `read` would not show it there; the scope says a kept run's `read` and its key share one list, and
   the plant is written on that list.
8. **#1018's AC1 fails on main.** At `3cf41958f`, `tests/acceptance/1018/hub.test.ts`'s first test fails at its PASS
   assertion for the reason AC4 above gives, and `scripts/known-failures.json` doesn't list it. It isn't #2652's to fix;
   it is reported as a follow-up, and AC4 accepts that one failure as the merge base's result.
9. **Whether a correct change can meet the drafted numbers** was checked by calibration on the base hub, outside the
   suite, through its inspector: with each kept output cut to a copied 2,000-character tail right after its run, AC1's
   five growths read between -96 KB and -45 KB; with each kept run's 500 paths rebuilt over one set of shared strings,
   AC3's map retained 13.27 MB. Neither is a run of the change.

See `BASE-FAILURE.txt` for each test's run on the base.
