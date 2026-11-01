# Acceptance tests for #896: patch to settled frame in O(dirty)

Written first, from issue #896 (its scope, its three acceptance criteria, its proof line and its Oracle note), #854
which it depends on, the design sections both name and those they lean on, and the base commit `3b57aa1d` ("Merge
pull request #911 … feat/854-efficiency-bar"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Invalidation and damage ("A changed item rebuilds and re-uploads only itself"; Cost
  "CPU O(dirty); upload 32 to 64 B per dirty item"; it can never "Rebuild an unchanged item"); Frame clock and
  scheduler; The cost model (per-item terms, "32 to 64 bytes per instance uploaded"; the authoring loop "from a
  patch's latch to the settled frame it causes"; the budget class table); Frame budget (five runs after warm-up, each
  run's p95 against its limit, PASS / FAIL / INCONCLUSIVE with the margin the larger of 5% and the runs' spread).
- `docs/technical-design.md`: Every task carries its own budgets, The reference Macs, Dogfooding, How we know
  version 0 works.
- At the base: AGENTS.md; `benchmarks/canvas.mjs` (the `patch-settled` workload, `judge` and `judgeEfficiency`, its
  `named` reasons); `benchmarks/budgets.json` (`canvas-patch-settled`, frozen on main); `scripts/benchmark.mjs`
  (`judgeLimit`, `validateBudgets`); `scripts/perf.mjs` (`judgeTargets`: the lane judges a task only by its
  budgets.json `targets`); `crates/deep-show/src/efficiency.rs` (`settle_patches`), `hub.rs`'s `Planted` (a scenario's
  `planted`, by snake-case name, which `canvas.mjs` passes from `--planted`); `planted.rs`; #854's suite
  `tests/acceptance/854/` (README, helpers.ts, patch.test.ts, budgets.test.ts, release.test.ts, AC1-MOVE.md), whose
  helpers this suite imports.

What the base does: `patch-settled` shows the 10,000-item board in a headless window and times 200 one-item patches a
run, five runs after a warm-up, each sample `{patch, item, frame, cpu_ms, gpu_ms, ms, ran}`; the judge holds
`settled_p95_ms` to 4 ms and names the slowest frame and its nodes. Every stage between a patch and its frame walks the
whole board (the issue's list), so the p95 is 16–34 ms; no sample says which stage took the time, nothing counts the
bytes the view uploads or the marks `marks2d.frame` rebuilds, nothing runs a board of another size, and none of this
issue's three planted programs exists.

## Run them

Like #854's suite they build release binaries inside the task (minutes cold) and each recording is several runs of
200 patches, so the folder runs one file at a time, after the parallel block. `scripts/lanes.mjs` needs
`'tests/acceptance/896/'` added to its `alone` list beside `'tests/acceptance/854/'`; this README is the
instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/896 --no-file-parallelism
npx tsc -p tests/acceptance/896/tsconfig.json   # type-check
```

The tests run each task as the perf lane does, `node benchmarks/canvas.mjs <mode> [--planted <name>]` from the
checkout root, and judge with `node benchmarks/canvas.mjs judge`; they build nothing themselves. Every process is
started by `spawnSync` and stopped only by its own timeout. A run with `--root tests/acceptance/896` leaves Vitest's
cache in `tests/acceptance/896/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

The tasks draw through Metal: off macOS each test that runs one skips as `INCONCLUSIVE`. Timings (the 4 ms hold, the
CPU per patch at two sizes, the judge's verdict on them) are judged only on a reference Mac (Mac15,7 / Apple M3 Pro /
36 GiB or Mac15,12 / Apple M3 / 16 GiB), by #854's helpers: elsewhere those tests check their recordings, then skip as
`INCONCLUSIVE (reading only)`; they never pass by skipping. Power, Low Power Mode and heat aren't gated by the tests'
own judge (the owner's rule, as in #379, #854, #857); the lane's `judgeLimit` gates them, and when it alone keeps a
run a reading the test skips as INCONCLUSIVE, saying so. Counts (bytes uploaded, marks built) are judged on any Mac.

## The surface under test

The issue names #854's `canvas-patch-settled` task, its stages, a board of 1,000 items, the bytes uploaded per
changed item, `marks2d.frame` and three planted programs, but no fields. These tests add, to #854's surface (its
README: The surface under test), only what follows. Everything #854 defines holds unchanged, and #854's tests must
still pass.

### A sample's new fields

Both patch modes below emit this sample, #854's plus three fields:

```json
{"patch", "item", "frame", "cpu_ms", "gpu_ms", "ms", "ran",
 "stages": {"patch": ms, "session": ms, "frame": ms, "present": ms, "gpu": ms},
 "uploaded_bytes": integer, "marks": {operator: integer}}
```

- `stages`: where the patch's time went, exactly these five keys, each ≥ 0. `patch` is the shared patch path's check
  and bookkeeping; `session` the document's session taking the revision; `frame` the session's frame, every operator
  run in it (`marks2d.frame` among them); `present` the view's work to put the frame on the GPU (painting or
  uploading); `gpu` the GPU time. The four CPU stages sum to `cpu_ms` (within 0.01 ms + 0.1%), each the process's
  CPU time across that stage, and `gpu` equals `gpu_ms` (within 0.001 ms).
- `uploaded_bytes`: the bytes the view handed to the GPU for this patch's frame (instance, vertex, uniform and texture
  data written for the GPU to read, on unified memory too). A one-item patch moves its item, so at least 1.
- `marks`: the marks each operator built or rebuilt for this patch's frame, by operator key as `ran` names them
  (`marks2d.frame`, …); an operator that built none may be left out.

`patch-settled` must carry `stages` (the first criterion's failure names a stage); its tests read only that.
`patch-dirty`'s tests read all three.

### `patch-settled --planted reloads_revision`

A session that reloads the whole revision on each patch (the document's every item, as `Session::load` takes it)
instead of taking the items the patch changed. Reachable only there, as #854's planted programs are.

### New task `canvas-patch-dirty`

budgets.json gains (it must still pass `validateBudgets` against the merge base's, so `canvas-patch-settled` stays as
frozen):

| id | command | targets |
|---|---|---|
| `canvas-patch-dirty` | `["node", "benchmarks/canvas.mjs", "patch-dirty"]` | `{"cpu_growth": 0.25, "upload_bytes_per_item": 64}` |

with `margin: 0.5`, `limits: {}` and an `initialReason` naming #896. Its report, as #854's tasks' (release build, one
warm-up run, five runs, exits 0 whatever it measured, the report as the last stdout line):

```json
{"task": "canvas-patch-dirty", "fingerprint": {…, "build": {"profile": "release", "toolchain"}}, "patches": 200,
 "runs": [{"boards": [{"items": 1000, "samples": [Sample × 200]}, {"items": 10000, "samples": [Sample × 200]}]} × 5]}
```

Each run patches a 1,000-item board, then a 10,000-item one, both laid out as patch-settled's board is, with
patch-settled's 200 one-item patches, timed as patch-settled times them; the 1,000-item board first.
`--planted rebuilds_draw_list`: a `marks2d.frame` that rebuilds the whole draw list on each frame (so `marks` counts
at least the board's items for it). `--planted repaints_every_mark`: a view that repaints every mark each frame (so
`uploaded_bytes` holds every mark's).

### `node benchmarks/canvas.mjs judge`, for canvas-patch-dirty

As #854's judge for its tasks (stdin `{"current": Report, "base": null}`, one verdict line, a non-release reading
INVALID, targets from budgets.json, `status` FAIL > BLOCKED > INCONCLUSIVE > PASS), with these targets:

- `cpu_growth`: per run, |p50 of `cpu_ms` on the 10,000-item board − p50 on the 1,000-item board| ÷ the latter
  (nearest-rank p50), judged by `judgeLimit` (a timing). Taken only from a run with one board of exactly 1,000 items
  and one of exactly 10,000; any other run makes it BLOCKED (or the reading INVALID), never PASS.
- `upload_bytes_per_item`: per run, the most `uploaded_bytes` of one patch on either board (each patch changes one
  item), a count judged on any machine: FAIL when any run is over 64, BLOCKED when a sample doesn't report it.
- A FAIL's `reason` names, for `cpu_growth`, in each failing run the operator that built the most marks for one
  patch on the 10,000-item board and that count (`marks2d.frame 10,000 marks`); for `upload_bytes_per_item`, in each
  failing run the most bytes one patch uploaded (`patch 77 uploaded 640,001 B`).

### The judge, for canvas-patch-settled

Unchanged, except that a `settled_p95_ms` FAIL's reason also names, for each run, the stage that took the most of its
slowest patch's time, as `stage <name>` (`stage session 9.4 ms`), and writes `stage <name>` for no other stage. A
reading whose samples carry no `stages` (#854's made-up readings) is judged as #854 says.

Numbers in a reason may be printed plain or grouped by threes (`10000`, `10,000`).

## Criteria to tests

IDs are `#896.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed
(scripts/proof-change.mjs `criterionId`). Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, and the wrong programs each fails on |
|---|---|---|
| `#896.b89e4aff` | Patch to settled frame holds 4 ms at p95 over 200 one-item patches on a 10,000-item board, CPU plus GPU, on the reference Mac, judged by #854's `canvas-patch-settled` task (moved here from #854's first criterion); a planted session that reloads the whole revision on each patch fails, naming the stage that took the time | `settled.test.ts`: every sample's five stages add up to its CPU and GPU time; on a reference Mac the five p95s are within 4 ms by the design's rule and the lane's judge PASSes on the same five (the same hold #854's patch.test.ts keeps in its last block, there without the stages); `reloads_revision`'s session stage costs at least 5× the shipped one's at p50 in every run, and on a reference Mac it is over 4 ms in all five runs by the margin and the lane FAILs, naming for each run the costliest stage of its slowest patch; a made-up reading at 9 ms with a different costliest stage in each run FAILs naming each and never `stage patch`, its twin at 1 ms PASSes. Wrong programs: the base; the reloading session; stages that don't partition the time; a judge that never fails, names no stage or names every stage |
| `#896.18600d21` | The same task's CPU per patch at 1,000 and at 10,000 items differs by under 25%; a planted `marks2d.frame` that rebuilds the whole list fails, naming the operator and its marks | `dirty.test.ts`: the `canvas-patch-dirty` entry (also tagged `#896.6987c701`); five paired runs at 1,000 and 10,000 items, every one-item patch building at least one mark and no operator 100 marks (1% of the board) or more; on a reference Mac the five differences under 25% by the design's rule and the lane's `cpu_growth` PASSes on the same five; `rebuilds_draw_list` builds a `marks2d.frame` mark for every item of each board on every patch, and on a reference Mac its five differences are over 25% by the margin and the lane FAILs, naming `marks2d.frame` and each run's count; a made-up reading whose CPU per patch doubles FAILs naming the operator and each run's marks, its twin 10% apart PASSes, and readings with only a 10,000-item board, two 10,000-item boards or two 1,000-item boards aren't passed. Wrong programs: the base; the rebuilding `marks2d.frame`; a ratio taken from another board; a judge that never fails or names nothing |
| `#896.6987c701` | A one-item patch uploads at most 64 B per changed item to the GPU; a planted view that repaints every mark fails, naming the bytes it uploaded | `dirty.test.ts`: every one-item patch at both sizes uploads 1 to 64 B, and the lane's `upload_bytes_per_item` PASSes on any Mac with limit 64 and each run's most bytes; `repaints_every_mark` uploads at least a byte per mark of the board on every patch, and the lane FAILs on any Mac, naming each run's bytes; a made-up reading with one 640,000 B patch FAILs naming each run's bytes, its twin at 48 B PASSes, and a reading with no bytes isn't passed. Wrong programs: the base; the repainting view; a task that doesn't report the bytes, or reports none for a patch; a judge that never fails or names no bytes |

## Readings where the issue and design leave a choice

- **A second task.** `canvas-patch-settled`'s entry is frozen on main (`validateBudgets`), the lane judges a task
  only by its entry's `targets`, and #854's release.test.ts and patch.test.ts require #854's made-up patch reading,
  which carries no stages, bytes or second board, to PASS. So the second and third criteria can't be targets of that
  task without either moving its frozen entry or passing a reading with nothing to judge. `canvas-patch-dirty` runs
  "the same task's" workload, its patches and its timing, at both sizes, and carries both targets.
- **"CPU per patch … differs by under 25%"** is each run's p50 `cpu_ms` at 10,000 items against its p50 at 1,000, as
  a fraction of the latter, either way; the two boards run back to back in each run so load falls on both alike; five
  runs judged as the design judges a timing, within when ≤ 0.25 (as `judgeLimit` judges every limit).
- **"Naming the stage that took the time"** is the costliest of the five stages in each run's slowest patch, the
  patch #854's reason already names by its frame. Which stage the planted session's time lands in (the session's own
  reload, or a frame that then reruns every node) is the implementation's; the tests require the judge to name the
  one the report shows, and the session stage itself to cost at least 5× the shipped one, since it takes 10,000 items
  where the shipped session takes one.
- **"Naming the operator and its marks"**: `marks2d.frame` is one node a frame, so `ran` can't show it rebuilding the
  list; `marks` counts the marks each operator built. A one-item patch builds at least its own mark and fewer than 1%
  of the board's, from the design's "It can never: Rebuild an unchanged item".
- **"At most 64 B per changed item"**: every patch here changes one item, so it is each patch's `uploaded_bytes`,
  judged as a count on any Mac at both sizes. At least 1 B, since a moved item's instance must reach the GPU; the
  planted view's at least a byte per mark of the board.

Not tested, because no criterion asks or the surface can't reach it: which stage each part of the scope's work lands
in beyond the five named; the per-stage costs the issue lists for the base; layer caches; patches of more than one
item; boards of other sizes.

## Upstream tests (the Oracle lane)

The issue's Oracle note says no upstream test checks these criteria (budgets and planted programs on our own patch
path, scheduler and 2D view), so these tests are the local proof for all three.
