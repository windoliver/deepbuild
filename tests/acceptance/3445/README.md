# Acceptance tests for #3445: what a sandboxed program costs that the fuel doesn't count

Written first, blind, from issue #3445 (its body; it has no comments), the design sections it links and those they
lean on, and base commit `aafef3131` (origin/main, its last merge #3394), by a job that never saw the work; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

The issue is a spike: it changes no shipped code. Its work is kept in `docs/spikes/3445/`, as #3222's, #2649's and
#2175's are, and these tests check what is kept there: the record, the raw outputs of its runs, the patch that takes
the epoch checks out, and the report. Every sum, median and "more than" is worked out here from the raw rows; what the
base gives (the packs a release ships, the metering record, the logic goldens) is read from this checkout's history at
the record's `main`, never from the spike's folder. No test starts a canvas core, times anything or builds anything.

## What was read

- Issue #3445. Of the issues it names (#310, #171, #2324, #212, #579, #3442, #1172, #3108) only the suites the base
  holds: `tests/acceptance/2324/`, `1172/`, `3108/`, and beside them `2662/`, `533/`, `532/` and `546/`.
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Closed issues stay proven, Criteria in a
  checked shape, Wrong programs, The edit guard, Dogfooding, Built to be hard to get wrong, Repo guards); Numbers
  version 0 has to hold (Every task carries its own budgets, The reference Macs); Sandbox and budgets; Threats, and
  what stops each one, with Threats from pieces, plug-ins, media and pages. `docs/canvas-primitives.md`: Logic: sandbox,
  Logic: work across steps, Logic: checkpoints and bake, Golden, Carried state: the cache manifest.
  `docs/parallel-proof.md`: sections 5 to 7 and 12a. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for names and shapes and never for an expected time: `crates/deep-sandbox-wasmtime/src/lib.rs`
  (`COMPILES`, `compiles()`, `Program::new`, `Runner::sized`, `PROGRAMS`); `crates/deep-logic/src/world/world_impl.rs`
  (`World::runner`), `fixtures.rs` (`pack_check`, `run_fixtures`), `budget.rs` (`METER`, `meter()`, `metered()`,
  `cpu_ns()`), `lib.rs` (`about`, `metering`, `golden`, `golden_verify`), `module.rs` (the kit fixtures), `main.rs`;
  `crates/deep-show/src/main.rs`, `canvas_side.rs`, `hub.rs` (`Hub::new`, `install_pack`), `packs.rs` (`install`,
  `lib_check`), `sandbox.rs` (`vet`, `vet_providers`, `vet_libs`), `costs.rs` (`build`), `build.rs`, `golden.rs`,
  `kit/goldens.rs`, `kit/carried.rs`; `packages/hub/src/canvas.ts` and `packs.ts`; `benchmarks/logic.mjs` and
  `crates/deep-logic/metering.json`; `scripts/benchmark.mjs` (`fingerprint`, `references`, `judgeLimit`),
  `throttle.mjs`, `proof-change.mjs`, `proof-runs.mjs`, `open-issues.mjs`, `repo-rules.mjs`, `wait-ratchet.mjs`,
  `public-text.mjs`; `packs/` (21 folders with a `pack.json`, seven of them with `libs` or `interfaces`);
  `tests/acceptance/3222/` whole, the READMEs of `2649/`, `2175/`, `2324/`, `2662/`, `533/`, `1172/` and `3108/`,
  `2324/ac4-seal.test.ts` and `helpers.ts`, `2662/goldens.rs`, and the two golden fixtures.
- wasmtime 49.0.5's source, for the issue's three statements: `Config::cache`'s note that every `Module::new`
  recompiles unless a cache is on, and `Module::deserialize`'s Unsafety note (`wasmtime-49.0.5/src/config.rs`,
  `src/runtime/module.rs`); that `epoch_interruption` is off unless set (`wasmtime-environ-49.0.5/src/tunables.rs`)
  and that Cranelift emits the checks only when it is on (`wasmtime-internal-cranelift-49.0.5/src/func_environ.rs`).
  The guide's "around a 10% slowdown" is in none of those three folders; no test rests on it.
- Nothing was run but this suite: no binary of this repository was built or started.

## How to run

```sh
node --test tests/acceptance/3445/ac1-compile-table.test.mjs
node --test tests/acceptance/3445/ac2-first-reply.test.mjs
node --test tests/acceptance/3445/ac3-epochs-out.test.mjs
node --test tests/acceptance/3445/ac4-answers.test.mjs
node --test tests/acceptance/3445/validate.test.mjs
```

Node 24.22 first on `PATH`, and `git` with this checkout's history back to the record's `main` (every file reads it,
read-only: `cat-file`, `merge-base --is-ancestor`, `ls-tree`, `show`). Nothing needs to be built, and nothing is
installed: the imports are Node's own. Each criterion's file takes about a second; `validate.test.mjs` about six. No
`lane.json`: the files start no binary, time nothing and share nothing, so they run in the parallel block.

`validate.test.mjs` is this suite's own check that its validators pass a well-formed spike (a synthetic one, in the
formats below; its `good()` is their worked example, whole) and fail each wrong one. Its spike's `main` is the base
commit, `aafef31316f7da8f741647a5934a717d9019ffff`, whose packs, metering record and goldens it reads from git; every
time in it is made up. It carries no criterion and passes on the base.

## The surface under test

Every name here that the issue or the design doesn't give is this suite's choice and a requirement on the implementer:
the tests spell them exactly so. A field not named here is the implementer's, and no test reads it.

### The spike's folder

`docs/spikes/3445/`: `record.json`, `README.md` (the report), the run outputs the record cites and the patch that takes
the epoch checks out, each at a path relative to the folder (no absolute path, no `..`) and pinned by its sha256 as the
file is kept. The scripts that took the runs, and any other patch, are the implementer's to keep there. A home folder in
a kept file is written `~` before its hash is taken (`scripts/repo-rules.mjs`).

### `record.json`

```json
{ "main": "<40 hex digits>",
  "firstReply": { "command": "…", "out": "out/first-reply.json", "sha256": "…", "lease": "timed:5f3a9c1e",
                  "load": { "start": [6.2, 7.9, 9.4], "end": [7.1, 8.0, 9.3] },
                  "result": [ { "pid": 4101, "reply": 1, "ms": 1930.25 }, "… five in all" ] },
  "compile":    { "command": "…", "out": "out/compile.json", "sha256": "…", "lease": "…", "load": { "…": "…" },
                  "pid": 4301, "compiles": 29, "ms": 1584.00525,
                  "packs": { "deepbuild/art@1.0.0": [],
                             "deepbuild/circuit@1.0.0": [ { "program": "<64 hex digits>", "compiles": 2, "ms": 81.000125 } ] } },
  "epochs":     { "patch": { "path": "epochs-out.patch", "sha256": "…" },
                  "in":  { "command": "node benchmarks/logic.mjs", "out": "out/epochs-in.json", "sha256": "…", "lease": "…", "load": { "…": "…" } },
                  "out": { "command": "node benchmarks/logic.mjs (in a copy of main with the patch applied)", "out": "out/epochs-out.json", "sha256": "…", "lease": "…", "load": { "…": "…" } },
                  "goldens": { "tests/acceptance/2324/fixtures/base-golden.json": { "command": "…", "out": "out/golden-2324.json", "sha256": "…" },
                               "tests/acceptance/2662/fixtures/golden.json":      { "command": "…", "out": "out/golden-2662.json", "sha256": "…" } } },
  "tracker":    { "logic": { "command": "…", "out": "out/tracker-logic.json", "sha256": "…", "lease": "…", "load": { "…": "…" } } },
  "answers":    { "compiling": { "ms": 1584.00525, "over": true, "task": { "issue": 3501, "title": "…", "criteria": ["…"] } },
                  "checks":    { "in": 0.2503, "out": 0.2449, "over": false },
                  "writes":    { "ns_per_fuel": 0.61, "record": 0.25, "over": true, "task": { "issue": 3502, "title": "…", "criteria": ["…"] } } } }
```

- `main`: the full hash of the main commit the readings ran on, an ancestor of `HEAD`. The packs main ships,
  `crates/deep-logic/metering.json` and the two goldens are read at it (`git show`).
- A **run** (`firstReply`, `compile`, `epochs.in`, `epochs.out`, `tracker.logic`) is a timed run the record takes as a
  result: `command` (what took it), `out` and `sha256` (its kept output), `lease` (the grant it ran under: the value
  `DEEP_THROTTLE` holds under `node scripts/throttle.mjs timed -- …`, `timed:<id>`) and `load` (`os.loadavg()`, the
  1, 5 and 15 minute averages, at its start and at its end). Its output holds `fingerprint`, as
  `scripts/benchmark.mjs`'s `fingerprint()` gives it (`model`, `chip`, `memoryBytes`, `power`, `lowPowerMode`,
  `thermalState`, `macosBuild`). `epochs.in`'s and `epochs.out`'s `command` name `benchmarks/logic.mjs`.
- `firstReply.result`: the five readings taken as the result, each a reply of the kept output by its `pid` and `reply`,
  with `ms`, its time in milliseconds (`repliedMs - startedMs`).
- `compile.pid`: the process of `compile.out` whose first reply the table is read from. `compile.compiles` and
  `compile.ms` are that run's own totals, beside the table: the compile counter's value and the milliseconds inside
  the calls it counts (`compileNs / 1e6`). `compile.packs` is the table: one key for each pack main ships, by its
  reference `deepbuild/<name>@<version>` (as `packages/hub/src/packs.ts` reads `packs/<folder>/pack.json`), an empty
  list for a pack that compiles nothing; each program once per pack with `program` (the sha256 of the bytes compiled),
  `compiles` (how many counted calls compiled it in that pack's check) and `ms` (the milliseconds inside them, summed).
- `epochs.patch`: the change that takes the epoch checks out, as a patch against `main`. `epochs.goldens`: one kept
  replay for each of the two golden files, keyed by the golden's path in the checkout: `command`, `out`, `sha256`.
- `answers`: for each question its readings, `over` (whether the threshold is passed) and, when it is, `task`: the
  task filed, by its issue number (not 3445, and no two answers the same), its `title` and its own `criteria`.
  `compiling.ms` is `compile.ms`; `checks.in` and `checks.out` are the benchmark's medians of `epochs.in`'s and
  `epochs.out`'s `runs.app`; `writes.ns_per_fuel` is the median of `tracker.logic`'s `runs.app`, and `writes.record`
  the record's `ns_per_fuel.app` at `main` (0.25 at the base).
- Numbers are kept unrounded: a milliseconds field is held to 1e-6 of what the rows give, an ns per fuel unit to 1e-9.

### The canvas core's run output (`firstReply.out`, `compile.out`; they may be one file)

One JSON object per run of the spike's harness:

```json
{ "fingerprint": { "model": "Mac17,10", "chip": "Apple M5 Max", "memoryBytes": 68719476736, "power": "ac",
                   "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "26B8119" },
  "packs": ["deepbuild/art@1.0.0", "… every pack main ships, and no other"],
  "replies": [
    { "pid": 4101, "reply": 1, "build": { "profile": "release", "toolchain": "rustc 1.99.1 (…)" },
      "startedMs": 1764040200000, "repliedMs": 1764040201930.25 },
    { "pid": 4101, "reply": 2, "build": { "profile": "release", "toolchain": "…" }, "startedMs": 1764040202500, "repliedMs": 1764040202541.5 },
    { "pid": 4301, "reply": 1, "build": { "profile": "release", "toolchain": "…" }, "startedMs": 1764040800000, "repliedMs": 1764040802104.5,
      "compiles": 29, "compileNs": 1584005250,
      "programs": [ { "pack": "deepbuild/circuit@1.0.0", "program": "<64 hex digits>", "ns": 30000000 },
                    { "pack": null, "program": "<64 hex digits>", "ns": 9000000 } ] } ] }
```

- `packs`: the packs the core's world held (`world.packs`, `{id, dir}` each, as the hub sends them), by reference.
- `replies`: one row for each reply the harness timed, and it may hold more than the record takes as the result (a
  warm process's, a dev build's: readings). `pid`: the `deep-show canvas` process. `reply`: which of that process's
  replies to a call line this is, from 1; the `{"ok": true}` that answers a world line is no reply (the core checks no
  pack before it: `canvas_side.rs`, `line`). `startedMs` and `repliedMs`: milliseconds since the Unix epoch, fractions
  allowed, on one clock. For a first reply `startedMs` is read just before the harness starts the process, for a later
  one just before it writes that call's line; `repliedMs` is read when the harness has the whole reply line.
- `build`: the build's own word for its Cargo profile and toolchain. deep-show gives it as `build` in its `costs`
  reply (`costs.rs`, from `DEEP_PROFILE` and `DEEP_TOOLCHAIN`, which its build script sets): the harness asks the
  process it timed, after the timed reply (`{"call": {"call": "costs"}}`), and keeps the reply's `build` whole.
- On the row the compile table is read from: `compiles`, the compile counter's value (`compiles()`) when the reply was
  written; `compileNs`, the nanoseconds that process spent inside the calls the counter counts, each from just before
  `Module::new` to its return, summed by the process itself; and `programs`, one row for each counted call in the
  order made: `program`, the sha256 of the bytes the call compiled (what `Program::new` hands `Module::new`); `ns`, the
  nanoseconds inside that call; `pack`, the reference of the shipped pack whose check the call was made in (the pack
  `install` in `crates/deep-show/src/packs.rs` was checking), or `null` for a call outside every pack's check.

### A reading of ns per fuel unit (`epochs.in.out`, `epochs.out.out`, `tracker.logic.out`)

The JSON object `node benchmarks/logic.mjs` prints, in the shape of `crates/deep-logic/metering.json`:

```json
{ "fingerprint": { "…": "…" }, "build": { "profile": "release", "toolchain": "…" },
  "engines": { "app": "wasmtime 49.0.5", "web": "…" }, "fuel": { "bench": 4800007, "twin": 47 }, "steps": 20,
  "runs": { "app": [0.2441, 0.245, 0.2447, 0.2455, 0.2449], "web": ["…"] }, "fixed": { "…": "…" },
  "ns_per_fuel": { "app": 0.245, "web": 0.391 } }
```

`epochs.in` and `epochs.out` are the benchmark's own output, unchanged. `tracker.logic` (the metering twin that mostly
writes, as a logic item's program) keeps the same shape, of which the tests read `fingerprint`, `build.profile` and
`runs.app`: the ns per fuel unit of each run, in the app.

### A golden's replay (`epochs.goldens[<path>].out`)

The golden a build with the checks out records for the golden's own piece, track and steps: either deep-logic's reply
to `golden` as it prints it, `{"ok": true, "golden": {…}}`, or the golden alone, `{"bake_key": …, "step_hashes":
{"<item>": ["<16 hex digits>", …]}, …}`. For `tests/acceptance/2324/fixtures/base-golden.json` the call is
`{"call": "golden", "piece", "track", "steps"}` with the fixture's own three fields (`2324/helpers.ts`, `goldenCall`);
for `tests/acceptance/2662/fixtures/golden.json` the piece is built by `2662/goldens.rs`, whose first test prints
`FIXTURE golden.json <golden>` under `DEEP_2662_PRINT=1` (`cargo test -p deep-logic --test acceptance_2662_goldens --
--nocapture`, in the copy the patch is applied to).

### The patch (`epochs.patch.path`)

A unified diff against `main`, as `git diff` writes it. In `crates/deep-sandbox-wasmtime/src/lib.rs` it removes the
line that holds `epoch_interruption(true)`, and no line it adds, in any file, calls `epoch_interruption(` with anything
but `false`: so a copy it is applied to has the checks out whatever its features and environment.

### The report (`docs/spikes/3445/README.md`)

- Its compile table names every pack main ships as `<name>@<version>` (`circuit@1.0.0`) and every program of
  `compile.packs` by at least the first 12 hex digits of its `program`.
- One line for each of the three questions: the clause in the issue's words, a colon, then `yes` or `no` (any case;
  `*`, `_` or a backtick may stand around the answer), the readings after it:

  ```
  - The first reply waits more than 1 s on compiling: yes, 1584.0 ms inside the compiler. Task #3501.
  - The checks cost a live step more than 5%: no, 0.2503 ns per fuel unit with them in and 0.2449 with them out.
  - A step that mostly writes costs more than twice the record's ns per fuel unit: yes, 0.61 against the record's 0.25. Task #3502.
  ```

- It names each filed task as `#<issue>`.

## What stands behind a build and a process

What a record says of a build or a process has to be in what is kept. This is what the tests require, and what they
can't hold.

| The record says | Required, and checked | Not held, and why |
|---|---|---|
| a release build, not a dev one | every reply taken as a result carries `build.profile` `release`; every ns per fuel unit reading carries `build.profile` `release`, which `benchmarks/logic.mjs` writes after it builds `--release` and runs `target/release/deep-logic` | that the word is the binary's own (the harness is asked to take it from the process's `costs` reply; a test sees only the kept row), and which sources the binary was built from: no binary is kept |
| a fresh process, not a warm one | the five readings are five `pid`s, each at `reply` 1; a row at `reply` 2 or later is a warm process's, and may be kept but not taken | that the harness numbered the replies truly; the state of the evidence store and of the disk's cache at each start, which the spike's report is to say |
| the epoch checks out | the kept patch takes `epoch_interruption(true)` out of `Program::new`'s file and adds nothing that can set it again; the record cites the patch beside the reading and the replays | that the run and the replays were made by a build of a copy with that patch applied: a golden's hashes read the same with the checks in, and wasmtime tells a caller nothing of how a module was compiled |
| a reference Mac, no other job holding a lease | each run's `fingerprint`, `lease` and `load` (The run's conditions, below) | that the grant named was held for the whole run: the throttle's table and log are outside the checkout |

## Criteria to tests

| Criterion | Test | What it asserts | Fails on |
|---|---|---|---|
| AC1 `#3445.0424020d` The report gives each shipped pack's programs with their compile times, and the times sum to within 5% of the time the same run spends inside the calls the compile counter counts. A table that leaves a program out fails, naming it | `ac1-compile-table.test.mjs` | `compile.out` is pinned, its world held exactly the packs main ships, and the row of `compile.pid` is a release build's first reply with `compiles`, `compileNs` and `programs`; `programs` has one row for each of the `compiles` counted calls; `compile.compiles` and `compile.ms` are the row's; `compile.packs` has a key for each shipped pack and no other; each table row's `compiles` and `ms` are its counted calls' count and sum; every program the rows hold for a shipped pack is in the table; a pack with `libs` or `interfaces` has at least one program; the table's `ms` sum to within 5% of `compileNs`; the report names each pack and each program; the run's conditions (below) | the base (no record); a table that leaves a program out, `the table leaves out program <sha256> of <pack> (…)`, or a report that does, `README.md's table leaves out program <12 hex> of <name>@<version>`; a pack left out; a counted call with no row; more than 5% of the run's compile time outside the table; a time or count the rows don't give |
| AC2 `#3445.13016257` The first reply's time is read five times, each from a fresh process of a release build. A reading from a dev build or a warm process is a reading, never the result | `ac2-first-reply.test.mjs` | `firstReply.out` is pinned and its world held exactly the packs main ships; `result` names five replies of it, each of another process, each that process's reply 1, each with `build.profile` `release`, each `ms` its `repliedMs - startedMs`; the run's conditions | the base; a dev build's reading among the five, `pid <n>'s reply 1 is from a dev build, not a release build: a reading, never the result`; a warm process's, `pid <n>'s reply 2 is from a warm process, which had answered 1 call before it: a reading, never the result`; four readings; one process twice; a reading the output doesn't hold |
| AC3 `#3445.6abdd2ef` The ns per fuel unit with the epoch checks out is read by the metering benchmark as the record's was, 20 steps and 5 runs, and every golden of the logic kit keeps its step hashes with them out. A hash that moves fails, naming the golden and the step | `ac3-epochs-out.test.mjs` | the patch takes the checks out (above); `epochs.out` names `benchmarks/logic.mjs`, is pinned, a release build's, with `steps` 20, five `runs.app`, `ns_per_fuel.app` the benchmark's rounded median of them, `fuel` and `engines.app` the record's at `main`, and the run's conditions; each of the two goldens has a pinned replay whose step hashes equal, item by item and step by step, the ones the golden holds at `main` | the base; a golden with one step's hash moved, `golden <path>: step <k> of <item> hashes <x> with the epoch checks out, and the golden holds <y>`; a golden not replayed; 19 steps or four runs; a dev build; a patch that leaves the checks in or lets a build turn them on |
| AC4 `#3445.4cbba77d` The report states, with its readings, whether the first reply waits more than 1 s on compiling, whether the checks cost a live step more than 5%, and whether a step that mostly writes costs more than twice the record's ns per fuel unit (all three drafted), and a task is filed for each that does | `ac4-answers.test.mjs` | each reading recomputed from its kept run (`compile`'s `compileNs`; the medians of `epochs.in` and `epochs.out`, both read as the record's was and charged the same fuel; the median of `tracker.logic`; the record's `ns_per_fuel.app` at `main`) and equal to the record's; `over` and the report's line equal to the answer the readings give; each yes with a task of its own (number, title, criteria), named in the report; the four runs' conditions, on one machine | the base; a report or record that says no when its readings pass the threshold, `README.md says "<clause>: no", and its own readings say yes: …`; a yes with no task, `answers.<key>: no task is filed, and <clause>: …`; a yes the readings don't give; one task for two answers |

Each test's name starts with its criterion's number and ID, the first 8 hex digits of the SHA-256 of the criterion's
text as `scripts/proof-change.mjs` reads it; they were computed from the issue's body and came out as above. The tag is
a string of the test's own file, so the lanes read each name from the source. One test a criterion.

**The run's conditions**, on every run above (the issue's `Runs on:` line; design: The reference Macs; parallel-proof,
sections 6 and 12a): its `fingerprint` names one of the three reference Macs by `model`, `chip` and `memoryBytes`, with
`power` `ac`, `lowPowerMode` false, `thermalState` `nominal` and a `macosBuild`; its `lease` is a timed grant; its
1-minute load at its start and at its end is no higher than that Mac's cores (12, 8 and 18). A run that misses one is
a reading: the test fails `INCONCLUSIVE: <run>: a reading, not a result: <why>`, never passes and never skips.
Something that isn't there (the record, an output, a replay, the patch, `main` in this checkout's git, a hash that
doesn't match) fails `BLOCKED: …`, naming it.

## The wrong spikes

A spike's wrong programs are wrong records and reports. On the base there is no spike, so each criterion's test fails
at its own assertion, `BLOCKED: no spike record at docs/spikes/3445/record.json` (`BASE-FAILURE.txt`). The ones the
criteria name are planted in `validate.test.mjs`, each an altered copy of the well-formed synthetic spike run through
the same check the well-formed one passes, and each must fail it with the message its criterion names:

- a table that leaves a program out (the record's, and the report's), naming the program and its pack;
- a reading from a dev build, and one from a warm process, taken as the result, naming the process and the reply;
- a golden with one step's hash moved, in each of the two forms a replay is kept in, naming the golden and the step;
- a report and record that say a threshold wasn't passed when their own readings pass it, and one that files no task
  for a threshold that was.

Beside them it holds each other fault a check names (a boundary pair for "more than": 1,000 ms is no and its task may
stay; the run's conditions; a missing or unpinned file).

## Readings where the issue and the design leave a choice

- **A pack's programs** are what the calls the compile counter counts compile while the core checks that pack: each
  `Module::new` in `Program::new`, named by the sha256 of the bytes it compiles. They aren't the pack's `.wasm` files:
  a library is linked into each fixture's program and never compiled alone, and a fixture's program is compiled once
  for each piece that holds it (`World::runner`). A pack with no program has an empty list.
- **The calls the compile counter counts** are fixed by the base: `COMPILES` is added to in one place, just before
  `Module::new`. So the run's rows are one for each count, and the time inside one is that call's.
- **"Sum to within 5%"**: the table's times, the shipped packs' programs only, against the run's own total over every
  counted call, a call outside every pack's check included: the gap is what the table doesn't account for.
- **A pack with libraries or interfaces compiles a program.** Read from `vet_providers` and `pack_check`: such a
  pack's fixtures are compiled and run at its check, in every fresh process. It keeps a table from passing when its
  run read no program of that pack at all.
- **The first reply** is the core's reply to the first call line it is sent, in a world that holds the shipped packs:
  `Hub::new` checks every pack of the world when the first call builds the hub, and the world line's answer comes
  before that. Its clock starts just before the harness starts the process and stops when the harness has the reply
  line. Which call is sent first is the implementer's.
- **A fresh process** is one the harness started for that reading, timed on its first reply: five readings are five
  process IDs, each at `reply` 1. A **warm** reading is any later reply of a process. **A release build** is one whose
  own word for its profile is `release`.
- **"As the record's was"** holds the reading with the checks out to: the metering benchmark's own output, 20 steps,
  five app runs, its `ns_per_fuel.app` the benchmark's rounded median, a release build, the record's engine, and the
  record's fuel for the benchmark program and its twin, since the rewrite counts fuel and no engine setting moves it.
- **Every golden of the logic kit** is read as every logic golden the base keeps as a file with its step hashes: the
  two above. The kit run over the logic module (deep-show's `kit`, `modules: ["logic"]`) keeps no step hash in a file:
  its `carried_state` part compares a seek with a straight run inside one build, and its golden store holds frame
  digests. #532's and #546's suites record a golden and verify it in one run, so they hold none either.
- **The kept replay is judged, and no test replays a golden.** A build with the checks out is in no lane, and once
  the spike has merged nothing on main builds one, so a test that needed it would be BLOCKED there. A replay's hashes
  can't tell a build with the checks out from one with them in, so running one here would add nothing unless the test
  also built a patched copy of an old tree in every lane.
- **"The checks cost a live step more than 5%"**: the benchmark's median ns per fuel unit with the checks in is more
  than 1.05 times its median with them out, both read by the spike on one machine. The record's own number isn't a
  side: it was read on another day.
- **"A step that mostly writes"** is the metering twin as a logic item's program, with the tracker's calls: its
  median ns per fuel unit is more than twice the record's `ns_per_fuel.app` at `main`.
- **"Waits more than 1 s on compiling"**: the compile run's `compileNs` is more than 1,000 ms.
- **The thresholds stay the issue's.** No test bounds a time: each answer is whatever the kept readings give against
  the issue's three drafted numbers. The design's five-run rule for a budget's limit isn't applied; a reading sets no
  budget.
- **A filed task**, to a test, is its issue number, title and own criteria in the record, and its number in the report.
- **`main`** stands in for "this checkout" wherever the base gives a value, so the suite stays true when main later
  adds a pack, measures the record again or records another golden.

## What isn't asserted

- That a kept output came from the build and the process it names, or that its build had the checks out: no binary is
  kept, and a test can't tell a number read from one typed. The patch's text, the outputs' hashes and the rows' own
  words are what is held.
- That each task is filed on GitHub with the criteria the record copies (a test can't reach GitHub), and that the
  figures the report prints, in its compile table and on an answer's line, are the record's: the table held to the
  run's rows is `compile.packs`, and the report is read for the packs, the programs, the three answers and the tasks
  it names.
- The Scope's lines no criterion reaches: the unmerged branch with `parallel-compilation`; whether a compiled module
  can be kept across starts, which store could hold one and what its key covers; the tracker's twin as a plain program,
  and that the twin stores once every two instructions; what each change would return and put at risk, and the
  recommendations; "or says why none is" for a threshold not passed; that the spike changes no shipped code and no
  ceiling.
- Any value of a time, and which call the first is.

## What the other agent adds outside this folder

Only the spike's own folder, `docs/spikes/3445/`. No lane list, manifest or rule file needs an edit.
