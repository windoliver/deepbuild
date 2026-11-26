# Acceptance tests for #3444: what the GPU backend adds that nothing of ours declares

Written first, blind, from issue #3444 (its title, labels and body; it has no comments), the design sections it links
and those they lean on, and base commit `390c3f390` (origin/main; its last merge is #3420), by a job that never saw the
work; none was in what it could read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The issue is a spike: it changes no renderer code and no budget. Its work is kept in `docs/spikes/3444/`, as #3222's,
#2649's and #2175's are, and these tests check what is kept there: the report, the record, the raw output of each run
the record cites, and the patch that is the split-module branch. Every sum, share, "within 10%" and "more than" is
worked out here from the runs' own rows and compared with what the report says, never taken on the spike's word
(invariant 1). No test runs the spike, a binary of this repository or the GPU, and none takes or judges a time.

## What was read

- Issue #3444 as saved in the job's inputs. GitHub was not read: the issues it names (#241, #64, #3030, #3031, #2679,
  #1552, #579, #1903, #484) were read only as the base holds them, in suites, evidence and code.
- `docs/canvas-primitives.md`: The cost model; Compile, validate and cache; Meter and degrade ladder; Liveness and
  recovery (the four the issue links); GPU surface; Frame budget. `docs/technical-design.md`: How runs become one of
  five verdicts (the states and their precedence); How we know version 0 works (Criteria to tests, Closed issues stay
  proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding, Built to be hard to get wrong, Repo
  guards); Numbers version 0 has to hold (Every task carries its own budgets, The reference Macs).
  `docs/parallel-proof.md`: sections 5 to 7 and 12a. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for names, shapes and conventions, never for an expected value:
  - spike suites and their spikes: `tests/acceptance/3222/` with `docs/spikes/3222/` (its report's head and its
    record's fields), `2649/` with how `docs/spikes/2649/` keeps its patches, `2175/`, `2435/` with `spikes/2435/`;
  - the every-pass scene and the forest: `docs/evidence/1903/` (README, `run.mts`, `envelope.json`),
    `tests/acceptance/2189/` (`helpers.ts`, its fixture), `tests/acceptance/484/helpers.ts` (`forest`, `framesOf`);
  - the code the issue names: `crates/deep-gpu/src/counted.rs` (`Wgpu`, `Counts`, `compiles`), `seam.rs` (`pick`),
    `device.rs` (`noop`, `Device::open`), `pixel_hash.rs`; `crates/deep-gpu-layer/src/envelope/opens.rs`, `view3d.rs`
    (`cold`, `timings`, `pixel_hash`), `session3.rs` (`pipelines`), `timing.rs` (`adapter`);
    `crates/deep-scene3d-render/src/lib.rs` (`SHADER`, `Renderer::sampled`, the three `draw_indexed_indirect`) and its
    `.wgsl` files' entry points; `crates/deep-show/src/kit/lease.rs`; `spikes/2435/record.mjs`;
  - the lanes that read a suite: `scripts/proof-change.mjs` (`TAG`, `tagsIn`, `isTestFile`, `spans`), `proof-runs.mjs`
    (the before lane, `atAssertion`, `twinsOf`), `lanes.mjs` (`stateOf`, `worst`), `affected.mjs` (its header),
    `benchmark.mjs` (`fingerprint`, `references`), `repo-rules.mjs`, `wait-ratchet.mjs`, `open-issues.mjs`.
- The pinned crates' source, read-only: `wgpu-hal-30.0.1/src/metal/device.rs` (`load_shader`, `create_query_set`,
  `destroy_query_set`, the counters), `naga-30.0.1/src/back/pipeline_constants.rs` (`process_overrides`),
  `wgpu-types-30.0.1/src/instance.rs` (`InstanceFlags`) and `src/counters.rs` (`InternalCounter`, `HalCounters`),
  `wgpu-core-30.0.1/src/device/resource.rs` (`handle_hal_error`, `enable_indirect_validation`) and `src/instance.rs`
  (`flags`), `wgpu-30.0.1/src/api/device.rs` (`get_internal_counters`) and `api/instance.rs` (`generate_report`).
- Probes, in a scratch folder and not kept: the validators on `example.mjs`'s spike and on altered copies of it, to
  read their messages; each criterion test's two calls on the base; each file's imports; this suite's files through
  `proof-change.mjs`'s `spans` and `tagsIn` and through `scripts/studied-names.mjs`. No probe touched the GPU, cargo
  or a binary, and none is a reading of the spike.

## How to run

```sh
node --test tests/acceptance/3444/ac1-pipeline-table.test.mjs
node --test tests/acceptance/3444/ac2-split-module.test.mjs
node --test tests/acceptance/3444/ac3-indirect.test.mjs
node --test tests/acceptance/3444/ac4-query-sets.test.mjs
node --test tests/acceptance/3444/ac5-thresholds.test.mjs
node --test tests/acceptance/3444/validate.test.mjs
```

Each needs Node 24.22 first on `PATH` and `git`, and nothing built: no cargo, no `npm run build`, no binary, no GPU, no
network. Git is read for the record's `main` (a commit of this checkout's history), and `ac2-split-module.test.mjs`
checks the kept patch against that commit's tree on an index of its own in a temporary folder (`git read-tree`, then
`git apply --cached --check`): the checkout, its index and its refs are left as they were. Each criterion's check
reads a few dozen small files and takes well under a second. `validate.test.mjs` writes about 70 copies of the example
spike into temporary folders, one at a time, and removes each: run as a plain node script on this Mac it took 8 to 16 s
at a 1-minute load near 60 to 110, and 58 s at a load of 375. No file of the suite has yet run under `node --test`:
the machine's throttle gave no test grant in its 60-minute wait (`BASE-FAILURE.txt`).

`validate.test.mjs` is this suite's own check that its validators pass a well-formed spike and fail each wrong one. It
carries no criterion and passes on the base. The suite has no lane file: no file of it starts a binary, takes a time or
shares a resource, so it runs in the parallel block.

## The surface under test

- The spike's folder, `docs/spikes/3444/`: `record.json`, the run outputs and the patch it cites, and the report,
  `README.md`.
- This checkout's git history at the record's `main`.

Every name below that the issue or the design doesn't give is this suite's choice and a requirement on the
implementer. `example.mjs` builds one complete, well-formed spike in these formats (its numbers are made up), which
`validate.test.mjs` passes through every check; the snippets below are cut from it.

### The spike's folder

`docs/spikes/3444/`: `record.json`, `README.md` (the report), and every file the record cites, at a path relative to the
folder (no absolute path, no `..`), each pinned by its sha256. The tests read no other file there: the scripts,
instruments and builds that took the runs are the implementer's, kept beside the report as #2649's and #3222's are.

### `record.json`

```json
{ "main": "390c3f39067e7520ca7d2405d86578d17fe4f668",
  "pipelines": {
    "scene": { "path": "tests/acceptance/2189/fixtures/every-pass.json", "sha256": "07e5dd1c..." },
    "main":  { "command": "node docs/spikes/3444/run.mjs ...", "out": "out/cold-main.json", "sha256": "..." },
    "split": { "command": "...", "out": "out/cold-split.json", "sha256": "...",
               "patch": { "path": "split-module.patch", "sha256": "8376df05..." } } },
  "indirect": { "rounds": [ { "on":  { "command": "...", "out": "out/indirect-1-on.json", "sha256": "..." },
                              "off": { "command": "...", "out": "out/indirect-1-off.json", "sha256": "..." } } ] },
  "query_sets": {
    "states": { "one_window":   { "command": "...", "out": "out/state-one-window.json", "sha256": "..." },
                "four_windows": { "command": "...", "out": "out/state-four-windows.json", "sha256": "..." },
                "export":       { "command": "...", "out": "out/state-export.json", "sha256": "..." } },
    "one_more": { "command": "...", "out": "out/one-more.json", "sha256": "..." } },
  "tasks": { "translation": { "issue": 3501, "title": "...", "criteria": [ "- [ ] ..." ] } } }
```

- `main`: the full hash of the main commit the readings ran on, a commit of this checkout's history (an ancestor of
  `HEAD`). Every run output's `commit` is this hash.
- A run, wherever the record cites one, is `{ "command", "out", "sha256" }`, as in #3222's record: the command that
  took the run (any text; the tests don't parse it), its output's path in the spike folder, and the sha256 of that
  file's bytes. An output is one JSON object. No file is cited twice among the ten indirect runs.
- `pipelines.scene`: the every-pass scene the two cold runs played, by its path in this checkout and its sha256. The
  document must equal #1903's scene (`docs/evidence/1903/envelope.json`'s `scene`), which this suite keeps a copy of
  in `fixtures/every-pass.json`, as #2189's suite does; either suite's copy, or a copy in the spike folder, will do.
- `pipelines.main`, `pipelines.split`: the cold run of main and of the split-module branch. `split.patch` is the
  branch: a patch on `main`, kept in the spike folder (#2649's spike keeps its cuts so).
- `indirect.rounds`: exactly five rounds, each one run with the flag on and one with it off. The key is the column.
- `query_sets.states`: one run for each of `one_window`, `four_windows` and `export`. `query_sets.one_more`: the
  one-more-than-32 run.
- `tasks`: for each threshold of criterion 5 whose readings pass it, the task filed: `translation`, `validation`,
  `query_sets`. A task is `{ "issue", "title", "criteria" }`, as #3222's record holds its follow-up: the issue's
  number, greater than 3444; its title; its own acceptance criteria, at least one. No two tasks share a number. A
  threshold that isn't passed needs no entry.

Other fields are allowed and not read.

### What every run output says of its run

```json
{ "commit": "390c3f39067e7520ca7d2405d86578d17fe4f668",
  "machine": { "model": "Mac17,10", "chip": "Apple M5 Max", "memoryBytes": 68719476736, "macosBuild": "26B8119" },
  "adapter": { "backend": "metal", "name": "Apple M5 Max" } }
```

- `commit`: the commit the build that ran was made from, the record's `main`.
- `machine`: the machine, in the names `scripts/benchmark.mjs`'s `fingerprint()` gives: `model` and `macosBuild` are
  required, and `model` is one of the design's reference Macs (`Mac15,7`, `Mac15,12`, `Mac17,10`). `chip` and
  `memoryBytes` are compared when there. No host name or serial: they are personal data.
- `adapter.backend`: `metal`, as `deep-gpu`'s `adapter` call answers on a Mac's GPU (`noop` with none).

### A cold run's output (`pipelines.main`, `pipelines.split`)

```json
{ "commit": "...", "machine": { }, "adapter": { }, "patch": null,
  "open": "fresh", "first_settled_ms": 1500, "pipelines_made": 4,
  "pipelines": [
    { "name": "scene3d.geometry", "around_ns": 527310000,
      "stages": [
        { "stage": "vertex", "entry_point": "vs_main", "module": "scene3d",
          "override_ns": 40200000, "source_ns": 55100000, "compile_ns": 120400000 },
        { "stage": "fragment", "entry_point": "fs_main", "module": "scene3d",
          "override_ns": 41000000, "source_ns": 60300000, "compile_ns": 150200000 },
        { "stage": "pipeline", "override_ns": 0, "source_ns": 0, "compile_ns": 35000000 } ] } ],
  "frames": [ { "frame": 0, "pixel_hash": "5d0c9e1f7a3b28466e1b0f9d2c7a4e85" } ] }
```

- `patch`: null or absent in main's run. In the split run, the sha256 of the patch its build carried, which must be
  the kept patch's.
- `open`: `fresh`, the word `envelope_opens` gives a scene's first open in a fresh process.
- `first_settled_ms`: the cost model's cold timing, in ms: from opening the document in a fresh process to its first
  settled frame. A number above 0.
- `pipelines`: every pipeline the device made in that time, one row a making. `pipelines_made` is the device's own
  count of them (`Counts::pipelines`, which `envelope_opens` answers as `pipelines`) and must equal the rows.
  - `name`: the pipeline's name, unique in the run and the same in both runs for the same pipeline. The label the
    counted device lists it under will do where it is unique; how a shared label is told apart is the implementer's.
  - `around_ns`: the ns around the call that made it, the device's `create_render_pipeline` or
    `create_compute_pipeline`, read where the counted device times each making (`crates/deep-gpu/src/counted.rs`,
    `Counts::compiles`). Above 0, and no less than the sum of its stages' times, which are inside it.
  - `stages`: at least one row. `stage` is `vertex`, `fragment` or `compute`, a shader stage with its `entry_point`,
    or `pipeline`, a row for Metal's own compile of the pipeline as a whole when the spike times it apart from a
    stage. Each row has `override_ns` (naga's override step), `source_ns` (the Metal source writer) and `compile_ns`
    (Metal's own compile), each a number of ns, 0 or more. What the spike counts under each beyond `load_shader`'s
    three steps is its own to say in the report.
  - In main's run each shader stage has `module`, the label of the shader module it is made from (`scene3d` for the
    scene module). In the split run each shader stage has `module_entry_points`, the names of every entry point its
    module holds, its own among them.
- `frames`: the frames the run drew and hashed, at least one: `frame`, its number, once each, and `pixel_hash`, hex,
  16 digits or more, as `view3d` answers it. Both runs hash the same frames.

A pipeline's three times, in the table and in every sum, are its stages' `override_ns`, `source_ns` and `compile_ns`,
each summed over its stages, in ms. Criteria 1 and 5 read the times and the counts; `patch` in the split run,
`entry_point`, `module`, `module_entry_points` and `frames` are read by criterion 2.

### An indirect run's output (`indirect.rounds[i].on`, `.off`)

```json
{ "commit": "...", "machine": { }, "adapter": { },
  "started": "2026-11-25T03:16:40.000Z", "ended": "2026-11-25T03:17:30.000Z",
  "instance_flags": 32,
  "forest": { "instances": 100000, "indirect_draws": 6 },
  "geometry": { "encode_ms": 0.5, "gpu_ms": 3.1 } }
```

- `started`, `ended`: when the run began and ended, ISO 8601.
- `instance_flags`: the bits of the instance's flags (`InstanceFlags::bits()`), read back from the instance the run
  drew with, not from the descriptor it asked for. The test reads bit `1 << 5`, `VALIDATION_INDIRECT_CALL` in
  wgpu-types 30.0.1: set in an `on` run, clear in an `off` run. Other bits, such as a debug build's, don't count.
- `forest.instances`: 100000. `forest.indirect_draws`: how many indexed indirect draws a frame of the run made (the
  length of `view3d`'s `indirect_draws` for a frame), 1 or more.
- `geometry.encode_ms`, `geometry.gpu_ms`: the run's reading of the geometry pass's (`scene3d.geometry`) encode time
  and GPU time, in ms, each above 0. How a run sums up its frames is the spike's to say in the report.

### A state's output (`query_sets.states.<state>`)

```json
{ "commit": "...", "machine": { }, "adapter": { },
  "started": "2026-11-25T03:35:00.000Z", "ended": "2026-11-25T03:35:40.000Z",
  "state": "four_windows", "device": { "label": "deep-gpu" }, "windows": 4, "views_3d": 4,
  "reads": [ { "at": "2026-11-25T03:35:10.000Z", "hal": { "buffers": 212, "textures": 96, "query_sets": 9 } },
             { "at": "2026-11-25T03:35:11.000Z", "hal": { "buffers": 212, "textures": 96, "query_sets": 8 } } ] }
```

- `state`: the state the record cites it for. `device.label`: `deep-gpu`, the label the app's device is opened with.
- `windows`: 1 for `one_window`; 4 for `four_windows`, with `views_3d` 4 (the windows showing a 3D view). Not read for
  `export`.
- `reads`: at least one read of the device's own counters, each with `at` (ISO 8601, from `started` to `ended`, so it
  was taken in the state) and `hal`, wgpu-hal's part of `wgpu::Device::get_internal_counters()`, under its own field
  names: `query_sets` and `buffers` are required, whole numbers, 0 or more. A state's count is the largest
  `hal.query_sets` among its reads. Counters whose `buffers` reads 0 in every read count nothing (wgpu's `counters`
  feature was off in the build), and the state then wasn't read.

### The one-more-than-32 run's output (`query_sets.one_more`)

```json
{ "commit": "...", "machine": { }, "adapter": { }, "device": { "label": "spike-3444 one more" },
  "attempts": [ { "n": 1, "error": null, "lost": false, "query_sets": 1 },
                { "n": 33, "error": "Unexpected", "lost": true, "query_sets": 32 } ],
  "outcome": "lost" }
```

- `device.label`: the label the run's device was opened with. Any but `deep-gpu`.
- `attempts`: each timestamp query set the run tried to create, in order, `n` from 1 (the snippet leaves out 2 to
  32): `error` (null, or the text of the error the creation raised), `lost` (whether the device was lost by then) and
  `query_sets` (the device's own `hal.query_sets` after the attempt). Attempts 1 to 32 are created, and the counter
  reads `n` after each: the device is the run's own, holding the run's sets alone. Attempt 33 is the one more.
- `outcome`: what the device did at attempt 33, as that attempt shows it: `created` (no error, not lost, the counter
  at 33), `refused` (an error, the device not lost, the counter still at 32) or `lost` (the device lost).

### The report (`docs/spikes/3444/README.md`)

The tests read two tables of it and look for the split-module branch's pixel hashes in its text. A table is rows that
each start with `|`, a header row, then a `|---|` row. Header cells are matched without backticks, in any case. A
number is digits, with `,` between thousands or not, a decimal point or not, `ms` after it or not, a minus sign for a
negative one, backticks around it or not. A shown number must be the recomputed one rounded to the decimals it shows.

The pipeline table: the first table whose header holds `Pipeline` and `main override ms`.

```markdown
| Pipeline | main override ms | main source ms | main compile ms | split override ms | split source ms | split compile ms |
|---|---|---|---|---|---|---|
| `scene3d.geometry` | 81.2 | 115.4 | 305.6 | 32.5 | 46.2 | 122.2 |
| **sum** | 161.8 | 151.5 | 443.2 | 64.7 | 60.6 | 177.3 |
```

- One row for each pipeline, its `name` in the `Pipeline` cell, with the three times of each side that made it. A
  side's cells are left empty (or `-`, `n/a`) only for a pipeline that side's run didn't make.
- A row whose `Pipeline` cell is bold (`**...**`) is a summary and is not read. Other columns are allowed.
- A split-module column whose frame differs from main's is headed `split (reading) override ms`,
  `split (reading) source ms`, `split (reading) compile ms`. Headed `split ...`, the column is given as the result.
- The report's text holds each `pixel_hash` of the split run's frames.

The threshold table: the table whose header holds `Threshold`, `Reading`, `Of`, `More than` and `Task`.

```markdown
| Threshold | Reading | Of | More than | Task |
|---|---|---|---|---|
| translation | 756.5 ms | 1,500.0 ms | yes | #3501 |
| validation encode | 0.010 ms | 0.500 ms | no | |
| validation gpu | 0.100 ms | 3.100 ms | no | |
| query sets | 9 | 16 | no | |
```

- Four rows, one each, by their `Threshold` cell. `Reading` and `Of` are the two numbers compared, `More than` is
  `yes` or `no`, and `Task` names the task as `#<issue>` in each row that says `yes`.
- `translation`: `Reading` is the sum of every time of main's pipeline rows, in ms; `Of` is main's
  `first_settled_ms`; `yes` when the reading is more than a fifth of it.
- `validation encode`, `validation gpu`: `Reading` is the median over the five rounds of the round's on run less its
  off run, for the geometry pass's encode time and for its GPU time, in ms; `Of` is the median of the five on runs;
  `yes` when the reading is more than 5% of it.
- `query sets`: `Reading` is the largest count among the three states; `Of` is 16; `yes` when it is more than 16.

## Criteria to tests

Each criterion has one test, named with its number and ID (the first 8 hex digits of the SHA-256 of its text, as
`scripts/proof-change.mjs` computes it; they came out as the brief gave them). On the base, where there is no spike,
each test's two calls end in the assertion `BLOCKED: <tag>: no spike record at docs/spikes/3444/record.json: the spike
hasn't been recorded`. That was read by a scratch probe of the same calls, not by a run of the test files:
`BASE-FAILURE.txt` says what was run at the base and what was not.

| Criterion | Test | What it asserts |
|---|---|---|
| AC1 `#3444.2cc7fe69` The report's pipeline table lists every pipeline the every-pass scene makes on a cold start, and its times sum to within 10% of the time the same run spends inside pipeline creation, read around the calls. A table that leaves a pipeline out fails, naming it | `ac1-pipeline-table.test.mjs` | `main` is a commit of this history; the scene the record names is #1903's every-pass scene; main's cold run is kept and pinned, on a reference Mac's GPU, a `fresh` open whose rows number the device's own count, each row's stage times no more than the time around its call; every pipeline of the run has one row in the report's pipeline table, named by the failure when it hasn't, with main's three times as the run gives them; no row gives main times for a pipeline the run didn't make; the main times the table shows sum to within 10% of the sum of `around_ns` |
| AC2 `#3444.441f7ad4` The split-module branch draws the every-pass scene to the same pixel hashes as main, and the report gives both columns. A branch whose frame differs is a reading, never the result | `ac2-split-module.test.mjs` | both cold runs kept and pinned, on one machine; the kept patch applies to `main`, and the split run's build carried it; every stage main's run made from the scene module `scene3d` is, in the split run's pipeline of the same name, made from a module that holds only entry points that pipeline uses; both runs hashed the same frames and every hash is the same; the pipeline table has main's column and the split's, the split's held as main's is in AC1 (every pipeline its run made, each time its run's, the sum within 10%); the report's text holds the split's pixel hashes |
| AC3 `#3444.f25f18de` The indirect readings are from five runs a side in alternated rounds on one Mac, with the flag's state read back from the instance in each run. A side whose flag was not what its column says fails, naming the run | `ac3-indirect.test.mjs` | exactly five rounds, ten outputs kept and pinned, none cited twice; each on a reference Mac's GPU, of the forest's 100,000 instances with at least one indirect draw, with both readings of the geometry pass; all ten on one machine; in each run `instance_flags` has `VALIDATION_INDIRECT_CALL` set in the `on` column and clear in the `off` column, the failure naming the round, the side and the output; by the runs' own times, the two runs of a round don't overlap, a round starts after the one before ends, and the side that runs first swaps each round |
| AC4 `#3444.05638bf4` The count of live timestamp query sets is read from the device's own counters in each of the three states, and the one-more-than-32 run reports what the device did: created, refused with the device kept, or lost. A run on the app's own device fails the lane | `ac4-query-sets.test.mjs` | each of the three states has a kept, pinned run on the app's device (`deep-gpu`) with its windows, and reads of the device's own counters taken inside the run, counters that count; the one-more run is on a device that is not labelled `deep-gpu`, created 32 sets with the device's counter reading 1 to 32, tried one more, and its `outcome` is what attempt 33 shows; all four runs on one machine |
| AC5 `#3444.f6f69d8c` The report states, with its readings, whether translation is more than a fifth of the time to the first settled frame, whether validation is more than 5% of the geometry pass on the forest, and whether any state holds more than 16 live sets (all three drafted), and a task is filed for each that does | `ac5-thresholds.test.mjs` | the runs it reads (main's cold run, the ten indirect runs, the three states) are kept, pinned, whole and on one machine; each row of the report's threshold table gives the reading and what it is compared with as recomputed from those runs, and says `yes` exactly when the reading passes the threshold; for each threshold passed the record holds a task with a number above 3444, a title and its own criteria, the report's row names it, and no two thresholds share a task |

### The wrong programs

For a spike the wrong programs are wrong records and wrong reports. Each is an altered copy of `example.mjs`'s spike,
run in `validate.test.mjs` through the same check the well-formed one passes; the check must fail with the problem
shown. The merge base, with no spike, is the wrong program each criterion's own test fails on.

| Criterion | The planted wrong spike | It must fail with |
|---|---|---|
| 1 | the report's table without the `scene3d.shadow` row | `the pipeline table leaves out scene3d.shadow, a pipeline pipelines.main (out/cold-main.json) shows the run making` |
| 2 | frame 30 of the split run has another hash, in a column headed `split ...` | `frame 30 of the split-module branch has the pixel hash ..., and main's has ...: a branch whose frame differs is a reading, never the result ...` (FAIL) |
| 3 | round 3's `off` run read its instance's flags as 32 | `round 3's off run (out/indirect-3-off.json) read its instance's flags as 32: VALIDATION_INDIRECT_CALL was on, not what its column says` |
| 4 | the one-more run's `device.label` is `deep-gpu` | `query_sets.one_more: ran on the app's own device ... a run on the app's own device fails the lane` (FAIL) |
| 4 | the four-window state's output holds a count from the instance's registry and no read of the device's counters | `query_sets.states.four_windows: the count isn't the device's own: ...` |
| 5 | the report's `translation` row says `no` where its readings pass | ``the report says no for `translation`, and its own readings pass the threshold: translation is more than a fifth of the time to the first settled frame (756.5 against 1500)`` |
| 5 | the record has no `tasks.translation` where the readings pass | `translation is more than a fifth of the time to the first settled frame, and no task is filed for it: the record has no tasks.translation` |

`validate.test.mjs` also holds each check to the criteria's values (a sum outside 10%, four rounds, rounds not
alternated, two machines, a state not read, an outcome its attempt doesn't show, a state holding 17) and to the states
below.

### What a failure reads as

A failure's message starts with its state, as `scripts/lanes.mjs` reads one (`stateOf`), then the criterion's tag;
with none, it is a FAIL. The worst state among a check's problems stands, by the design's precedence.

- `BLOCKED`: something outside the code is missing. No record, no report, a run the record doesn't cite or whose
  output isn't kept, an output whose sha256 isn't the record's, a `main` this checkout's git doesn't have, a run with
  no GPU (`adapter.backend` not `metal`), a state that wasn't read, counters that count nothing.
- `INCONCLUSIVE`: a reading that can't decide. A run on a Mac that isn't a reference model; a split-module column
  whose frame differs and which the report heads as a reading; a one-more run in which a set before the 33rd was
  refused or lost the device, so that creating one more than 32 was never run.
- `INVALID`: the check can't fail. Main's run shows no stage made from the scene module, so nothing shows the split.
- FAIL: everything else, the wrong programs above among them.

## Readings

Where the issue and the design leave a choice, the choice made here:

- **The cold start, and whose pipelines the table holds.** The cold start is the every-pass scene's first open in a
  fresh process (the cost model's "cold"; `envelope_opens`'s `fresh`). The table must hold every pipeline the output
  of the run the record cites as `pipelines.main` shows the device making from that open to the first settled frame,
  as many as the device's own count. Not the 44 of #1903's evidence: that is a run of another build. A shader
  module's making is not a pipeline's and is not in the table.
- **"Its times".** The three the Scope names (naga's override step, the Metal source writer, Metal's own compile) and
  no other: a fourth column for the rest would make any table sum. The 10% is taken on the numbers the table shows.
- **"The time the same run spends inside pipeline creation, read around the calls".** The sum of `around_ns` in the
  same output file as the times, each the time around the device's call that made the pipeline, where the counted
  device already times each making. A test can't see the reading being taken; it holds that every `around_ns` is
  above 0 and no less than the stage times read inside it.
- **The split-module branch, to a test.** A test sees its own checkout and no other ref, so the branch is `main` and a
  patch kept beside the report: the patch must apply to `main`, the split run's output must name it by sha256, and
  the split run's rows must show the split. "No pipeline's module holds an entry point it doesn't use" is read for
  the stages main made from the scene module, not for every module of the renderer: the Scope splits the scene
  module, and other passes' modules hold several entry points on main too. That the branch "isn't merged" is not
  asserted, since a later merge of the split would then fail this suite.
- **Which frames' hashes.** Every frame both cold runs hashed: at least one, the same frame numbers on both sides, in
  the same output files as the pipeline times, so the build whose times are in a column is the build that drew its
  frames. How many frames, and which, is the implementer's.
- **"A reading, never the result".** The result is the split-module column given as what the split returns: a column
  headed `split ...`. A branch whose frame differs may still give its times, headed `split (reading) ...`; the
  criterion's first sentence is then unproven and the test reads INCONCLUSIVE, never a pass. A report that takes it
  as the result heads the column `split ...` while a frame differs, and fails, naming the frame. The threshold
  table's `translation` row is recomputed from main's run, so a report that puts the split's sum there fails AC5.
- **A run, a side, a round.** A run is one process's drawing of the forest with the flag in one state, with one
  output. A side is a column, `on` or `off`. A round is one run of each side, one after the other. Alternated: the
  side that runs first swaps from each round to the next, read from the outputs' own `started` and `ended`.
- **"Read back from the instance".** No function of wgpu's public API returns an instance's flags, so how the spike
  reads them is its own; the output keeps the flags' bits as read, and the test takes the bit itself.
- **The three states, and "the device's own counters".** The Scope's three: one window, four windows each showing a
  3D view, a film's export, each on the app's device. The counters are wgpu-hal's (`hal.query_sets`), which count
  only with wgpu's `counters` feature on; on Metal they count timestamp sets as they are created. A count from
  `Instance::generate_report()` or from counting places in the code is not the device's own. "During" an export and
  "with" windows are held by each read's time lying inside its run; a state's count is its largest read.
- **The app's own device and a device of its own.** By the label the device was opened with (`deep-gpu` is the app's),
  and by the one-more run's counter reading 1 to 32 as it creates its sets, which a device that holds other sets
  wouldn't. "Fails the lane": the test fails as a FAIL, not as BLOCKED or INCONCLUSIVE, so the lane that runs it fails.
- **One more than 32.** The 33rd creation on a device holding the 32 before it. If the device refuses or is lost
  earlier, the run the criterion asks for wasn't taken, and the test reads INCONCLUSIVE, naming the set.
- **Translation.** All three times of every pipeline of main's cold run, as the issue's first bullet uses the word
  and as the Scope puts "their sum beside the time to the first settled frame".
- **Validation, and "the geometry pass".** The Scope reads two times of the pass, encode and GPU, so each is judged
  on its own clock and validation is more than 5% of the pass when it is on either. Validation's time is what the
  flag adds: the rounds are pairs, so it is the median of the five rounds' differences, on less off. The pass is the
  one the app runs, with the flag on: the median of the five on runs. The median is nearest rank over five, the third
  smallest, as #2649's and #3222's suites take p50.
- **A filed task, to a test.** A test can't reach GitHub. It holds what #3222's suite held: the record names the
  task's number, title and own criteria, and the report names the number. The number is above 3444, since a task
  filed for these readings was filed after this issue. One task for each threshold passed, so no number twice.
- **The machine and its load.** The `Runs on:` line says every reading is from one machine and sets no budget, and
  the issue calls its three thresholds drafted. So no test bounds a time, and none asks for a load below the cores,
  mains power or a nominal thermal state: those gate a budget's result (The reference Macs; parallel-proof 12a), and
  here every number is a reading. The thresholds are arithmetic on the kept readings and decide only whether a task
  is filed. What is held: each run's machine is of a reference model with its macOS build, and all runs a criterion
  reads are on one machine.
- **States, not skips.** Nothing missing passes or is skipped: see "What a failure reads as".

### What each claim of a run must show, and what could not be held

| The record says | A test holds | Not held |
|---|---|---|
| a cold start | `open` is `fresh`; the run made pipelines, as many rows as the device counted | that the process was fresh; that no cache of the system's held compiled shaders |
| the every-pass scene | the document the record names equals #1903's scene | that the run played that document, and at what size |
| which build drew a frame | `commit` is the record's `main`; the split's `patch` is the kept patch's sha256; the patch applies to `main`; the scene module's stages are split | that the binary was built from them |
| the flag's state | the instance's flags' bits, as the run read them back | how they were read back |
| which device | `device.label`; the one-more run's counter from 1 | that the label is the device's own |
| the device's own counters | `hal` with `query_sets` and `buffers`, and `buffers` above 0 | that the numbers came from `get_internal_counters()` |
| which Mac | `machine` of a reference model, the same in every run read | which Mac of that model (no serial or host is kept); its power, thermal state and load |
| a GPU | `adapter.backend` is `metal` | |
| headless, under the GPU lease | nothing | no run output of the base's binaries carries a lease, and the lease file is gone when the run ends |

## What isn't asserted

- Any measured time or count against a limit of this suite's own. The only thresholds are the issue's three.
- Scope lines no criterion reaches: which of the validation's checks the cull pass's output already guarantees; what
  each change would return and what it would put at risk; the three recommendations; the report's indirect and
  query-set tables as tables (their readings are read from the kept runs); "says why none is" for a threshold that
  isn't passed; that the spike changes no renderer code and no budget.
- That each task is filed on GitHub, open, in the shape the open issues have, and is what the readings justify: the
  Proof's and the reviewer's.
- That the report is short, and that its numbers beyond the two tables and the hashes are the runs'.
- How the spike takes its times, reads the flags or the counters, opens its windows or its own device.

## What the implementer adds outside this folder

Nothing. No lane list, manifest or dependency changes for this suite.

## Gaps and deviations

- **Not run at the base under the test runner.** The one request made of the machine's throttle got no test grant in
  60 minutes, with the load far above the cores, so none of the six files has run under `node --test`. What stands in:
  `node --check` on each file, `validate.test.mjs` run as a plain node script (16 tests, all passing), and a scratch
  probe of each criterion test's two calls on the base. `BASE-FAILURE.txt` has the commands still to run.
- **The base fails every criterion's check on the missing record.** The base is the wrong program for each test; that
  each check also fails the wrong spike its criterion names is shown by `validate.test.mjs`, on a synthetic spike.
- **Never run against a real spike.** None exists. The formats were checked only against `example.mjs`.
- **The scene module's label.** `scene3d` is read from the base; a `main` that renames it reads INVALID in AC2.
- **A report with a table inside a code block** is read as a table; the first that matches is taken.
