# Acceptance tests for #3530: the page tracker marks a store's page without a call

Written first, blind, from issue #3530 as saved for this job on 2026-11-27 (its opening paragraph, Scope, four
acceptance criteria, `Runs on:` and Proof lines; no comments), the two design sections it links (canvas primitives:
Logic: sandbox, Logic: work across steps), the issues it names (#3445 with its closing comment, #3442, #211, #171,
#310, #531, #238), the files of `docs/spikes/3445/` its Proof line cites, and base commit
`f0a816405340a65f86db3d17f29eb2f904f0895a`, by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one test a criterion, and two more for criterion 1, whose headless Chrome and whose planted rewrite each need a
run of their own.

The suite's form was redrafted, blind again, at main `cd68d655ac6c2e81b3712ab3e4e719599455fa18`, which held no work
on #3530: its files carry no comments (AGENTS.md, Proof; `docs/adr/0001-code-carries-no-comments.md`), what their
comments said is in this file, and `lane.json` names the timed files. No test's title, assertion, message, expected
value or program changed (The redraft of the suite's form, below).

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-pages.test.ts` (3 tests) | `#3530.5321d459` | 1,000 seeded programs, three steps each: `deep-logic bake` on this host's wasmtime; the web runner in headless Chrome on the bytes the app rewrote; `deep-logic --planted store_skips_page_marked_last` |
| `ac2-fixtures.test.ts` (1) | `#3530.1f0dfd22` | `deep-logic bake` of #531's 14 fixtures over 60 steps, against the merge base's recording |
| `ac3-writes.test.ts` (1, timed) | `#3530.9355f915` | the judge on planted readings; the twin's fuel and rewritten bytes; the budget task; one reading of the twin on a release `deep-logic` |
| `ac4-metering.test.ts` (1, timed) | `#3530.80a29246` | the judge on planted readings; the budget task; `node benchmarks/logic.mjs` once |
| `programs.ts` | | the programs, as WebAssembly binaries, and the run of each in Node's engine that says which pages changed |
| `judges.ts` | | the four judges; no test runner in it, so each runs on planted inputs as a plain script |
| `helpers.ts` | | the criteria's IDs, where `deep-logic` is taken from, the line driver, headless Chrome, the repo's budget code |
| `record.mjs`, `base.json` | criterion 2 | the merge base's recording and the script that made it |
| `twins.json`, `twins/` | criteria 1 and 2 | two wrong programs, as their wrong lines |
| `lane.json` | | the suite runs alone, and names its two timed files |
| `BASE-FAILURE.txt` | | each file run at the base |

## What was read

- The issue and the issues it names, for the words it cites. #3445's files: the report's sections "How a reading was
  taken" and "The page tracker", `tracker.rs` (`writer`, `ITER`, `least`, `read`), `measure.mjs` (`tracker`),
  `out/tracker/writes-logic.json` (the twin's and the rewritten twin's SHA-256, its fuel, its five readings).
- `docs/canvas-primitives.md`: Logic: sandbox, Logic: work across steps, Logic `logic@1`. `docs/technical-design.md`:
  How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong programs, the edit guard),
  Dogfooding, Numbers version 0 has to hold (every task carries its own budgets, the reference Macs).
  `docs/parallel-proof.md`: sections 5 to 7, 8a and 12a. AGENTS.md.
- At the base, for surfaces only: `crates/deep-canvas-sandbox/src/rewrite.rs` (`Mode`, `Faults`, `rewrite_as`,
  `tracker`, the store's and the fill's marks), `crates/deep-logic/src/planted.rs`, `main.rs`, `lib.rs` (`handle`,
  `bake`, `web_plan`, `metering`, `view`, `frame`), `live.rs` (`eval_ns`), `budget.rs` (`meter`, `metered`, `cpu_ns`),
  `world.rs` (`report`, `step_hash`, `deep_hash`), `world/world_impl.rs` (the read region, the bitmap's clear, a
  step's fuel), `piece/checks.rs` (the seed's read entry), `web/logic.mjs`, `metering.json`; `benchmarks/logic.mjs`,
  `canvas-world.mjs`, `canvas-judge.mjs`, `budgets.json`; `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`,
  `validateBudgets`, `judgeTargets`), `budget-window.mjs`, `lanes.mjs`, `lanes-lists.mjs`, `proof-runs.mjs`
  (`atAssertion`, `twinsOf`, `twinOverlay`), `proof-binaries.mjs`, `twins-lint.mjs`, `wait-ratchet.mjs`; the suites
  `531/`, `547/`, `211/`, `265/`, `1255/`, `2324/`, `3544/` and `3612/` (READMEs, helpers, the budget tests).

## Run them

Node 24. `ac1` and `ac2` drive the debug `deep-logic` (from `DEEP_BIN_DIR` when the proof run supplies it, else each
file builds it, `cargo build --locked --bin deep-logic`). `ac3` and `ac4` read a release one from this checkout,
`cargo build --locked --release -p deep-logic --bin deep-logic`, the build the metering benchmark runs. With the
lanes' profile, which the helpers default to, a build made that way is found fresh and compiles nothing. `ac1` and
`ac4` need headless Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or `CHROME_BIN`.

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3530 ac1-pages.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3530 ac2-fixtures.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3530 ac3-writes.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3530 ac4-metering.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3530/tsconfig.json
rm -rf tests/acceptance/3530/node_modules    # the runner's cache under --root
```

Under `--root` a file runs without the repository's own runner config, as `benchmarks/canvas-world.mjs` runs the
two timed ones, so it needs no package built. The lanes run the same files through that config
(`node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/3530/<file>`), which needs
`npm run build --workspaces` once. No file reads anything the config sets up.

No test sleeps: a timer only bounds a program that never answers. Each file builds its binary before its tests,
under the build's own limit of 90 minutes, so a test's time is its own. Each test carries its own limit (12 to 40
minutes), each run of a binary its own, and every process is stopped by its PID. A binary that can't be built, a
missing Chrome or a benchmark that exits non-zero reads `BLOCKED`; a program that doesn't answer in time, and a
timing off a reference Mac at rest, read `INCONCLUSIVE`; neither passes.

As readings at the base on this Mac (Mac17,10, 18 cores), one run each with its binary built, at one-minute loads of
9 to 40: `ac1-pages.test.ts` 6 s (wasmtime 3.1 s, headless Chrome 2.1 s), `ac2-fixtures.test.ts` under 1 s,
`ac3-writes.test.ts` 1.4 s, `ac4-metering.test.ts` 5 s. A first build of `deep-logic` is what takes time: 13
minutes for the debug one at a load of 150 to 270, 2 minutes at a load of 20, and 1 minute for the release one at a
load of 15 (`BASE-FAILURE.txt`).

**Hosts.** The `Runs on:` line names the three hosts of #238's kit for the rewrite. This suite ran on macOS arm64
(wasmtime) and headless Chrome. Linux x86_64 is `BLOCKED`: this job had no such host and starts none, so nothing here
stands for it. `ac1-pages.test.ts`'s first and third tests and `ac2-fixtures.test.ts` need only a `deep-logic` of the
host they run on, and run there unchanged.

## The surface under test

`deep-logic` as the base has it: JSON lines in, one reply a line; `--planted <name>` runs a planted wrong program.
Read here: `bake` (`steps[].step`, `steps[].items.<item>.{hash, fuel, failed, pages}`, `checkpoints.<item>[].{step,
deep_hash}`, `traps[].{item, step, kind}`, `items.<item>.hash`, the rewritten program's SHA-256), `web_plan`
(`request`), `web_runner` (`source`), the web runner's own `bake`, `view` (`session`) and `frame` (`steps`, `eval_ns`,
`traps`). Also `node benchmarks/logic.mjs` (the record it prints: `runs.app`, `runs.web`),
`crates/deep-logic/metering.json` (`ns_per_fuel.app`, `ns_per_fuel.web`, `fingerprint.model`), `scripts/benchmark.mjs`
(`judgeLimit`, `fingerprint`, `references`, `validateBudgets`), `scripts/lanes.mjs` (`timed`) and
`benchmarks/canvas-world.mjs`. No call, field or script is new. Three names are this job's; the issue gives none.

### The planted rewrite (yours to provide)

**`deep-logic --planted store_skips_page_marked_last`**: one more name in `crates/deep-logic/src/planted.rs`, a
planted rewrite as `tracker_skips_memory_copy` is, and several names still apply together.

Under it, a logic item's program whose bitmap is one word (a memory of at most 64 pages) is rewritten as the work
rewrites it, with one fault. The rewrite keeps the page the last marked store marked, in a mutable global of its own
that starts as no page and that nothing resets, checkpoints or hashes: not the logic module before a step, not the
web runner. A store whose first byte lies in the kept page marks nothing. Any other store marks its pages as the work
does, and its first byte's page becomes the kept one. `memory.fill`, `memory.copy` and memories past 64 pages are as
the work has them, and neither read nor change the kept page. Fuel, traps, hashes and the pages the logic module
marks itself are as without it.

So the bitmap, which the logic module clears before each step, loses a page whose last mark came in the step before.
That is the criterion's "skips the mark of a store whose page was marked last". The third test of
`ac1-pages.test.ts` requires of it:

1. the binary takes the name and answers each of the 1,000 bakes (the merge base exits 2 with `bad_input`);
2. the judge of the first two tests fails it, each failure naming a page whose bytes changed and the bitmap doesn't hold;
3. it only loses marks: no page is held that nothing changed, and every lost page is one a store of that program
   wrote, never the read region's page 0;
4. each of the 126 programs whose stores all lie in one page of a memory of one bitmap word keeps that page at step 0
   and loses it at steps 1 and 2, and nothing else: `seeded program 1 … step 1: page 1's bytes changed and the bitmap
   doesn't hold it`.

### The budget tasks (yours to provide)

Criteria 3 and 4 are budgets on the reference Mac, which the scheduled budget window holds through the tasks of
`benchmarks/budgets.json` that name them (parallel proof, 12a). Each task runs its test file here, which takes the
reading and judges it, as #265's and #1868's tasks do. In `benchmarks/budgets.json`:

```json
{ "id": "logic-writes", "command": ["node", "benchmarks/canvas-world.mjs", "tests/acceptance/3530/ac3-writes.test.ts"],
  "margin": 0.5, "limits": {}, "targets": { "writes_ns_per_fuel": 0.5 },
  "initialReason": "Issue #3530 first measurement (#3530.9355f915): …", "criteria": ["#3530.9355f915"] }
{ "id": "logic-metering", "command": ["node", "benchmarks/canvas-world.mjs", "tests/acceptance/3530/ac4-metering.test.ts"],
  "margin": 0.5, "limits": {}, "targets": { "app_times_record": 1.5, "web_times_record": 1.5 },
  "initialReason": "Issue #3530 first measurement (#3530.80a29246): …", "criteria": ["#3530.80a29246"] }
```

Each test reads its task's `id`, `command`, `margin`, `targets`, that `criteria` holds its criterion and that
`initialReason` names `#3530`; that `validateBudgets` takes the file; that `scripts/lanes.mjs`'s `timed` lists the
test file; and that `node benchmarks/canvas-world.mjs`, started with no test file, names it among the files it runs.
So also:

- `benchmarks/canvas-world.mjs`: its `TESTS` gain `'tests/acceptance/3530/ac3-writes.test.ts': '#3530.9355f915'` and
  `'tests/acceptance/3530/ac4-metering.test.ts': '#3530.80a29246'`.

The suite names its timed files itself: `lane.json`'s `timed` holds `ac3-writes.test.ts` and
`ac4-metering.test.ts`, so `scripts/lanes.mjs` lists both and nothing goes into `scripts/lanes-lists.mjs`.

## Programs

`programs.ts` writes each program as a WebAssembly binary, so the suite builds no assembler.

- **The twin** is `writer(iterations)`: `tracker.rs`'s `writer(iterations, false)`, 64 stores in 203 instructions,
  23,600 iterations a step. Its bytes are #3445's: SHA-256 `431473630c12…` for the twin and `479ee43d7718…` for its
  one-iteration twin, the two `out/tracker/writes-logic.json` names. `ac3` stops `INVALID` if they ever differ.
- **The seeded programs** are `seeded(0)` to `seeded(999)`, from a fixed-seed generator: 3,451 stores of all nine
  kinds, 1,055 fills and 728 copies; 138 programs of stores in one page, 242 of stores anywhere, 620 mixed; 926 with
  a memory of 1 to 64 pages and 74 with 65 to 130. Stores sit on a page's first bytes, on its last, across two pages
  (531 of them) and behind an instruction offset of up to pages; 125 fills and copies move no byte; fills and copies
  cross up to three page boundaries. A step sets every byte of an i64 to k + 1 and runs the same instructions in
  order: a store writes those bytes, a fill the byte k + 1, a copy bytes an earlier instruction of the step wrote. So
  every byte a step writes changes, and no later instruction puts an old byte back.

## The pages whose bytes changed

The implementation is never the source. `changedPagesInNode` runs each program as written, never rewritten, in Node's own
WebAssembly engine, and compares its whole memory before a step with its whole memory after it, page by page. The
suite holds its own programs to that reading: a program whose instructions don't write exactly the pages Node saw
change stops the run `INVALID`.

One page joins them: the read region's. Each step the logic module writes the step's seed there (Logic `logic@1`),
and marks it (Logic: sandbox, `rewrite.pages`). Every seeded program has its read region at address 0, reads nothing
from it and writes nothing to its first 64 bytes, so page 0 is expected at every step and Node's run needs no seed.

## The recording

Criterion 2's expected values are the merge base's own. `base.json` holds the piece, its track and its 60 steps, and
for each fixture what the merge base's `deep-logic bake` answered: every step's hash and fuel, every checkpoint's
step and full-state hash, and its trap's step and kind.

```sh
node tests/acceptance/3530/record.mjs            # at the merge base, with target/debug/deep-logic built: writes base.json
node tests/acceptance/3530/record.mjs --check    # in any checkout: bakes again, prints each difference, writes nothing
```

A reader makes it again by checking out `f0a816405`, building `deep-logic` there and running the first command.

**#531's fixtures** are every program of `tests/acceptance/531/programs.ts` that the check admits, with its Rust
program, each as the item #531's tests build it: `spin`, `tally`, `recurse`, `quiz`, `nine_fills`, `table_copy`,
`lookup`, `start_forever`, `touch_pages`, `quiet_pages`, `src`, `aim`, `work` and `rules`. #2324's suite fixed them
in one piece, with the programs' bytes, for the same words of its own criterion
(`tests/acceptance/2324/fixtures/base-bake.json`), and `record.mjs` took the piece, the track and the steps from
there, so no assembler is built. `write_past_memory` and `logic_import` are refused at check and reach no state;
`layout_probe` only reads a layout and steps nothing.

## What each test file does

**`ac1-pages.test.ts`**, criterion 1 (`#3530.5321d459`): "For 1,000 seeded programs of stores, fills and copies, the
pages the bitmap holds after a step equal the pages whose bytes changed, in wasmtime and in headless Chrome. A planted
rewrite that skips the mark of a store whose page was marked last fails, naming the page". The 1,000 programs are
`seeded(0)` to `seeded(999)`, each run for three steps. The pages the bitmap holds are each step record's `pages`,
from `deep-logic bake` on this host's wasmtime and from the logic module's web runner in headless Chrome, which runs
the bytes the app rewrote (`web_plan`). The first two tests hold what the merge base's tracker already does, so they
pass there; their wrong program is the twin `store_skips_page_marked_last`. The third runs the planted rewrite the
criterion names. One run of the 1,000 programs through a debug `deep-logic` is bounded at 12 minutes, each test at 15.
A program's piece gives a memory past 4 MiB its budget (16 pages a MiB) and its fills and copies their fuel
(10,000,000).

**`ac2-fixtures.test.ts`**, criterion 2 (`#3530.1f0dfd22`): "Every fixture of #531 reaches the full-state hash it
reached on the merge base, and a program is charged the fuel it was charged there. A hash or a fuel count that moves
fails, naming the fixture and the step". `deep-logic bake` of #531's fixtures' piece is compared with the merge base's
own bake of it, kept in `base.json`: every step's hash, the fuel every step was charged, every checkpoint's full-state
hash, and where an item trapped. The first difference of each kind names its fixture and its step. Nothing compares an
item's rewritten program hash or its bake key: the Scope says both change once. The criterion says what stays as it
is, so the test passes on the merge base; its wrong program is the twin `step_fuel_reads_one_more`.

**`ac3-writes.test.ts`**, criterion 3 (`#3530.9355f915`): "#3445's twin that mostly writes, as a logic item's
program, costs at most twice the record's ns per fuel unit in the app (drafted). The merge base costs 2.5 times and
fails". One timed test, in parts, as #211's and #1255's budgets are judged:

1. On any machine: the judge, `scripts/benchmark.mjs`'s `judgeLimit` against 0.5 ns per fuel unit (twice the record's
   0.25), passes five readings at the bound and fails the merge base's 0.622 (2.5 times) on a reference Mac at rest;
   #3445's two sets, taken with Low Power Mode on and at a load above the cores, read `INCONCLUSIVE`, as does any
   reading off the reference Macs.
2. On any machine: the twin is #3445's, byte for byte; as a logic item's program a step of it is charged 4,790,807
   fuel and a step of its one-iteration twin 210, the rewrite's own code none; and it isn't rewritten to the bytes the
   merge base rewrites it to, the ones #3445 read at 2.49 times the record.
3. On any machine: the budget window holds the criterion by the task `logic-writes` of `benchmarks/budgets.json`,
   which runs this file, a timed one. The task is read before the build, so a build that can't be read still names it.
4. The reading, once, on a release build: a live view of the twin and one of its one-iteration twin, a frame a step,
   each frame's `eval_ns` that step's CPU time in the logic module. A reading is taken as the record's is: the least
   of ten steps of the twin, less the least of ten of its one-iteration twin, over the fuel between them; six
   readings, the first left out. `judgeLimit` judges the five with the load at each one's start and end: PASS passes,
   FAIL fails, and anything else (off a reference Mac, under load) fails as `INCONCLUSIVE` with its readings, never a
   pass.

The same file reads the twin on the merge base, where no task holds the criterion and the rewritten bytes are the ones
#3445 read, so it fails there at part 3, and at part 4 too on a reference Mac at rest.

**`ac4-metering.test.ts`**, criterion 4 (`#3530.80a29246`): "Budget, on the reference Mac in the local preflight,
compared with the merge base: the metering benchmark's ns per fuel unit reads within its margin, in the app and in
headless Chrome". One timed test, in parts:

1. On any machine: the judge. The merge base's reading of the metering benchmark is the record,
   `crates/deep-logic/metering.json`, which this task leaves as it is; a reading is judged as a multiple of it, by
   `judgeLimit` against 1 + the task's margin. On planted readings: five at the record's own value pass, five at the
   bound pass, five at twice the record fail, and a reading off the reference Macs, under load, or on another
   reference Mac than the record's reads `INCONCLUSIVE`.
2. On any machine: the budget window holds the criterion by the task `logic-metering` of `benchmarks/budgets.json`,
   which runs this file, a timed one.
3. The reading, once: `node benchmarks/logic.mjs`, the metering benchmark itself, which builds a release `deep-logic`
   and reads five runs in the app and five in headless Chrome. The file builds that binary before its test, so the
   benchmark's own build finds it fresh. Each host's five are judged with the load at the benchmark's start and end:
   PASS passes, FAIL fails, and anything else fails as `INCONCLUSIVE` with its readings, never a pass.

The merge base runs the same benchmark, and no task of its budgets names the criterion: it fails at part 2.

## What the helpers, the judges and the programs hold

- **`helpers.ts`** stands in for nothing: every page, hash, fuel count and reading a test judges is the program's own
  answer. A failed check is the test runner's own assertion, thrown from this suite's files; what can't run throws a
  plain `Error` starting `BLOCKED:` or `INCONCLUSIVE:`, naming it.
  - The debug `deep-logic` comes from `DEEP_BIN_DIR` when the proof run supplies it, else from this checkout's debug
    build; the release one, which only the timed files read, from this checkout's release build. Each build runs with
    `CARGO_TARGET_DIR` unset, since the binary is read from this checkout's `target/`, and with rustup's cargo on
    `PATH` where Homebrew keeps it off the default one.
  - A `deep-logic` that ends before it has read every call, as one that refuses its arguments does, leaves the writer
    a broken pipe (`EPIPE`): that is read as the exit it is, by its status, never as `BLOCKED`.
  - Headless Chrome serves one page that imports the web runner and runs each request through its `bake`, as #531's
    suite does. The mock keychain and no background networking keep a fresh profile from waiting on the keychain and
    on policy and component fetches (#238's suite found a minute's wait without them). Chrome and its helpers are the
    test's own process group, a detached child, stopped by its PID.
  - The two timers carry the wait ratchet's `// deadline:` marker: each only turns a program that never answers into
    a result that says so.
- **`judges.ts`** holds no expectation of its own making. A finding of criterion 1 is `unmarked` (a page's bytes
  changed and the bitmap doesn't hold it), `unchanged` (the bitmap holds a page and none of its bytes changed) or
  `unread` (the piece wasn't baked, the program trapped, or a step reports no pages; its page is null). A trap's step
  is null when it came before step 0.
- **`programs.ts`**: a store is written as a constant address (`base`) and the instruction's `offset`, and writes
  `size` bytes at `at`, their sum; a copy takes `len` bytes from `from`. The twin's step, and a seeded program's:

  ```wat
  (func (export "step") (param i64) (local $n i32) (local $p i32) (local $q i64)
    (local.set $n (i32.const ITER)) (local.set $q (i64.const 0x0123456789abcdef))
    (loop $l
      (i64.store offset=8j (local.get $p) (local.get $q))                                  ;; j = 0 … 63
      (local.set $p (i32.and (i32.add (local.get $p) (i32.const 512)) (i32.const 0xffff8)))
      (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1))))))

  (func (export "step") (param $k i64) (local $v i64)
    (local.set $v (i64.mul (i64.add (local.get $k) (i64.const 1)) (i64.const 0x0101010101010101)))
    (i32.store16 offset=OFFSET (i32.const BASE) (i32.wrap_i64 (local.get $v)))       ;; a store
    (memory.fill (i32.const AT) (i32.wrap_i64 (local.get $v)) (i32.const LEN))       ;; a fill
    (memory.copy (i32.const AT) (i32.const FROM) (i32.const LEN)) …)                 ;; a copy
  ```

  The twin has a 32-page memory, and its name section holds what the text names, the locals n, p and q and the label
  l, as the spike's assembler wrote it. A step of it is charged each block's instruction count: 5 before the loop,
  203 an iteration, 2 after. Every program's `init` does nothing, and its type is `(func (param i64))`, as `step`'s.
- **`record.mjs`** is no test, and no lane runs it. Once `base.json` exists, the piece, its track and its steps are
  `base.json`'s own. It checks that each fixture's program is the bytes its item names, refuses to record from
  sources that differ from the commit it names, and writes one line a fixture, so a diff of two recordings names the
  fixture.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`, computed from the issue's body. Each test's title starts
`AC<n> #3530.<id>`.

| ID | Test | What it holds | Wrong programs it fails |
|---|---|---|---|
| `#3530.5321d459` | `ac1-pages`: "in wasmtime, for 1,000 seeded programs …" | Each of 3,000 steps' `pages` equals the pages whose bytes changed. A failure names the program, the step and the page | the twin `store_skips_page_marked_last`; a mark of the store's first byte's page alone (203 programs); a mark that leaves out the instruction's offset (421); a mark for a fill of no bytes; a tracker that skips fills or copies |
| `#3530.5321d459` | `ac1-pages`: "in headless Chrome, for the same 1,000 programs as the app rewrote them …" | The same, from the web runner's `bake` of each `web_plan` request | the same, and a web runner that reads or clears the bitmap otherwise |
| `#3530.5321d459` | `ac1-pages`: "a planted rewrite that skips the mark of a store whose page was marked last … fails, naming the page" | The four requirements above | the merge base (no such name); a planted rewrite that loses nothing, or other marks |
| `#3530.1f0dfd22` | `ac2-fixtures`: "every fixture of #531 reaches the step hashes and full-state hashes …" | The 14 fixtures' 60 steps and their checkpoints equal `base.json`. A failure names the fixture and the step | the twin `step_fuel_reads_one_more`; any change of a step's bits, a checkpoint or a trap's step |
| `#3530.9355f915` | `ac3-writes`: "#3445's twin that mostly writes … the merge base's 2.5 times fails" | Parts 1 to 4 of `ac3-writes.test.ts` under What each test file does | the merge base (no task; the merge base's rewritten bytes; 2.5 times on a reference Mac at rest); a rewrite that charges its marks fuel |
| `#3530.80a29246` | `ac4-metering`: "the metering benchmark's ns per fuel unit reads within its margin …" | Parts 1 to 3 of `ac4-metering.test.ts` under What each test file does | the merge base (no task); a metering benchmark at twice the record on the record's Mac at rest |

Criterion 1's first sentence and criterion 2 say what stays as it is, so their tests pass on the merge base, whose
tracker marks every page. Each names a twin.

## The wrong programs (twins)

`twins.json` names one twin for each of criteria 1 and 2, kept as its wrong lines (`twins/<name>/lines.json`,
#1832's form). Each edits one line of a file the issue doesn't name. This job checked that each `find` matches the
base's file at exactly one place, and built neither.

| Criterion | Twin | The wrong program | The tests that fail, and what they name |
|---|---|---|---|
| `#3530.5321d459` | `store_skips_page_marked_last` | The work, where every run of `deep-logic` is the planted rewrite: in `crates/deep-logic/src/main.rs`, `planted` starts as `Planted::default().and("store_skips_page_marked_last")` | `ac1-pages`' first two tests: "wasmtime: seeded program 1, step 1: page 1's bytes changed and the bitmap doesn't hold it", and the same in headless Chrome, which runs the bytes the app rewrote |
| `#3530.1f0dfd22` | `step_fuel_reads_one_more` | The work, where a step is charged one unit of fuel more than it used: in `crates/deep-logic/src/world/world_impl.rs`, `fuel` is `(item.fuel - left + 1).clamp(0, item.fuel)` | `ac2-fixtures`: "fixture tally, step 0: it was charged 5 fuel on the merge base and is charged 6", one line for each fixture that runs a step |

If a twin's lines no longer apply to the work, make the same one-place change in the file as the work holds it and
write the twin's `lines.json` again; the tests stay as they are.

## Readings where the issue leaves a choice

- **"The pages the bitmap holds after a step"** are the step record's `pages`, as #531's and #547's suites read
  them. **"Equal"** is read both ways: a page that changed and isn't held, and a page held that nothing changed.
- **"1,000 seeded programs of stores, fills and copies"**: one generator, 1,000 seeds, three steps each. Memories
  past 64 pages are among them because the Scope says they keep the tracker; their marks are judged alike.
- **"In wasmtime and in headless Chrome"**: each host's bitmap is judged against the changed pages, not against the
  other host's.
- **"A store whose page was marked last"**: the planted rewrite above. The spike's report names the design it is the
  fault of: "the tracker marks a page only when the store's page differs from the last one marked".
- **"Every fixture of #531"**: the 14 above, in #2324's piece.
- **"The full-state hash"** is a checkpoint's `deep_hash` (Logic `logic@1`; `World::deep_hash`): the piece
  checkpoints every 20 steps. "A hash … that moves" is read as the step hashes too, which name the first step. A
  trap's step and kind are compared; its function and offset aren't.
- **"A program is charged the fuel it was charged there"**: every step record's `fuel`.
- **The Scope's "a logic item's hash and bake key change once"**: `ac2` compares neither with the merge base's.
- **"Costs … ns per fuel unit in the app"** is read through a live view: a frame runs one step, and its `eval_ns`
  is that step's CPU time in the logic module, as #190's, #1181's and #1255's suites read it. A reading is taken as
  the record's is (`budget::metered`; the spike's `least`): the least of ten steps, less the least of ten of the
  one-iteration twin, over the fuel between them, six times, the first left out. No new call is needed, and the same
  file reads the twin on the merge base, which the Proof line asks for.
- **"Twice the record's ns per fuel unit"** is 0.5: the issue gives the record's 0.25. The test doesn't read the
  record for it, so the bound stays where the issue put it. "(drafted)" is the owner's to move.
- **"The merge base costs 2.5 times and fails"** is held three ways: the judge fails five planted readings of 0.622;
  the test fails on the merge base, where no task holds the criterion; and the twin must not be rewritten to the
  bytes #3445 read at 2.49 times (`rewritten.bench` of its kept reading). That SHA-256 is the one value here that
  comes from a run other than criterion 2's: it is #3445's, cited by the issue's Proof line, and it is only ever
  required to differ. The base rewrites the twin to exactly those bytes, and reads 0.62 ns per fuel unit through
  this file (`BASE-FAILURE.txt`).
- **"Compared with the merge base … within its margin"** (criterion 4): the merge base's reading of the metering
  benchmark is the record, `crates/deep-logic/metering.json`, which the issue leaves as it is ("Not in this task:
  … its readings"). "Its margin" is the task's `margin`, 0.5, the one every task of `benchmarks/budgets.json`
  compares with its merge base by. So each host's five readings are judged as multiples of the record against 1.5.
  A reading on another reference Mac than the record's is `INCONCLUSIVE`: there is no merge-base reading of that
  Mac. The budget window also compares the task's own time with the merge base's, 20 samples a side, once main has
  the task.
- **A timing that can't be judged fails the test** as `INCONCLUSIVE`, with its readings, after the parts that hold
  on any machine have been asserted. A timed file takes one reading and its load; it waits for nothing.

## Not asserted

- The shape of the rewritten bytes: that a store is followed by no `call`, or that fills, copies and larger
  memories still call the tracker. The criteria hold the Scope's first line by its marks (criterion 1) and its cost
  (criterion 3).
- An item's rewritten hash or bake key against the merge base's, and any golden: the Scope says they change once,
  by the owner's decision.
- Linux x86_64, as above. Criterion 2 in headless Chrome: it names no host.
- A store's cost in ns (the issue's 0.15, 1.97 and 0.28 are readings); the ceiling's formula and the record's
  readings (#3442); the engine's own inlining; fuel for the rewrite's own code, beyond that no fixture's and no
  twin's fuel moves.
- Checkpoints, restores and saves under the planted rewrite; the planted rewrite in headless Chrome.

## What the implementer adds outside this folder

- `crates/deep-logic/src/planted.rs` (and the rewrite's `Faults`): `store_skips_page_marked_last`.
- `benchmarks/budgets.json`: the tasks `logic-writes` and `logic-metering`.
- `benchmarks/canvas-world.mjs`: the two test files in `TESTS`.
- Nothing in `scripts/lanes-lists.mjs`: `lane.json` is here already, and names the timed files.
- Nothing in a `Cargo.toml`: the suite holds no Rust test.

## What the base does

`BASE-FAILURE.txt` has each file's run at the base and the probes' readings. It is a record of those runs, of the
files as they were before the redraft of their form, and stays as written. So its stack lines name helpers and lines
as they were (`none` at `helpers.ts:37`, `ac1-pages.test.ts:75`, `ac3-writes.test.ts:141`,
`ac4-metering.test.ts:113`; `none` is `expectNoProblems` now), and each timed file's problems there include
"scripts/lanes.mjs doesn't list … in timed", which was true at that base, whose lane file named no timed file.
With `lane.json` as it is now, that line no longer comes.

## The redraft of the suite's form

Main's rules for a new suite changed after the suite's base: a suite's files carry no comments, and a suite names its
timed files in its own `lane.json`. The redraft took every comment out of the eight source files (two
`// deadline:` markers stay, which the wait ratchet reads), moved what they said here, named the timed files in
`lane.json` and took the `scripts/lanes-lists.mjs` line out of what the implementer adds. Comments, white space and
the names below aside, each file's code is token for token the code it was; the programs' bytes, `base.json`,
`twins.json`, both twins' lines and `tsconfig.json` are as they were. Each name below took the place of a comment
that said what the old name meant. Read for the redraft, at main: AGENTS.md, `docs/adr/0001-code-carries-no-comments.md`,
`tests/acceptance/3419/README.md` (the lane file's shape), `scripts/comment-ratchet.mjs`, `scripts/wait-ratchet.mjs`,
`scripts/lanes-lists.mjs` and GLOSSARY.md. Nothing was built or run but the suite's own programs in Node's engine.

| Was | Is |
|---|---|
| `AC` | `titlePrefix` |
| `none` | `expectNoProblems` |
| `supplied` | `suppliedBinDir` |
| `BUILD_MS` | `FIRST_BUILD_LIMIT_MS` |
| `logicBin` | `logicDebug` |
| `answers` | `answerForEachCall` |
| `logic` | `debugLogicAnswers` |
| `live` | `longLivedLogic` |
| `Live` | `LongLivedLogic` |
| `pieceOf` | `oneItemPiece` |
| `inChrome` | `bakeInHeadlessChrome` |
| `atRest` | `fingerprintAtRest` |
| `held` | `benchmarkTaskHolders` |
| `Held` | `BenchmarkTaskHolders` |
| `ITEM` | `PIECE_ITEM` |
| `rowsOf` | `rowsByStep` |
| `Task` | `BenchmarkTask` |
| `taskProblems` | `benchmarkTaskProblems` |
| `shown` | `judgedReadingInALine` |
| `Record_` | `MeteringRecord` |
| `RECORD_APP` | `RECORD_APP_NS_PER_FUEL` |
| `u32` | `unsignedLeb128` |
| `sleb` | `signedLeb128` |
| `rng` | `mulberry32` |
| `KEEP_OUT` | `UNTOUCHED_FIRST_BYTES` |
| `ONE_WORD` | `ONE_WORD_MEMORIES` |
| `LARGER` | `LARGER_MEMORIES` |
| `span` | `writtenSpan` |
| `written` | `writtenPages` |
| `stored` | `storedPages` |
| `only` | `onlyStoredPage` |
| `said` | `seededInALine` |
| `changedIn` | `changedPagesInNode` |
| `PLANTED` | `PLANTED_REWRITE` |
| `changed` | `changedPagesOfEveryProgram` |
| `MERGE_BASE_REWRITTEN` | `MERGE_BASE_REWRITTEN_TWIN_SHA256` |
| `STEPS` | `STEPS_A_READING` |
| `READINGS` | `READINGS_TAKEN` |
| `read` | `readTwinThroughLiveViews` |
| `round` | `oneFrameOfEachView` |
| `MARGIN` | `MERGE_BASE_MARGIN` |
| `record` | `meteringRecord` |
| `FIRST` | `FIRST_RECORDING_SOURCE` |
