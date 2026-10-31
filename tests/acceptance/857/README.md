# Acceptance tests for #857: parallel nodes in a phase

Written first, from issue #857 (its scope, its four acceptance criteria and its proof line), the design sections it
names, and the base commit, by a job that never saw an implementation; none existed. The base is this worktree's
HEAD, `0466575b` ("Merge pull request #861 … feat/104-run-as-you"); the task named `0b35e68e` (#859's merge), its
ancestor eight commits back, and nothing under `crates/deep-canvas` or `crates/deep-show` differs between the two.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/canvas-primitives.md`: Phase (closed lists; "Inside a phase an edge exists exactly when one operator writes
  an array another reads … Ties break by canvas module name then operator name, and items by dependency depth, order
  key, then ID"; it can never "Depend on registration order or thread timing; hold a mutable singleton"); Operator
  and read set (`parallel: none | fixed_blocks`, "a frame gives the same bits on one thread or several"; "legal-order
  shuffles"; the lint refuses "work split by the machine's thread count"); Content key; Frame clock and scheduler;
  Frame budget (five runs after warm-up, each run's p95 against the class, PASS / FAIL / INCONCLUSIVE with the
  margin the larger of 5% and the runs' spread); the budget class table under The cost model (work product: Frame
  CPU 4 ms) and Operator budgets by class.
- `docs/technical-design.md`: Budgets by class; Every task carries its own budgets ("A frame-time limit an issue
  states at p95 does gate: each timing run takes its p95 over every frame of the fixture's run, at least 300
  frames"; "A timing result comes from five runs after warm-up").
- At the base: AGENTS.md; `tests/acceptance/387/` (the scheduler's suite: `deep-show run`, its scenario and calls,
  `eval`, `frames`, `shuffle`, `planted`, the test canvas modules as Cargo features, the reference-Mac gate and the
  judge), whose helpers this suite imports; `tests/acceptance/379/` (the budget classes, the check's cost estimate,
  its model-only reference-Mac gate); `tests/acceptance/138/` (release builds of `deep-show`);
  `crates/deep-canvas/src/schedule/`, `crates/deep-canvas/src/budget.rs`, `crates/deep-canvas/src/cost.rs` and
  `costs.json`; `crates/deep-show/src/{frames.rs,hub.rs,main.rs,planted.rs}`; `scripts/lanes.mjs`.

What the base does: every node runs on the scheduler's one thread. `eval` and `frames` answer as #387's README says,
with no `threads`, no per-node `thread` and no `frame_ms`; the registry's operators have no `thread_safe`; a scenario's
`threads` and `background` are ignored; `planted` doesn't know this suite's two names (`bad_input`); and Cargo has no
`test-threads` feature. The check's cost estimate (#379) refuses a document whose estimate passes its class
(`over_budget`), which bounds the work-product view below.

## Run them

Like #387's suite they build `deep-show` per feature set before spawning it, so they run one file at a time, after
the parallel block. `scripts/lanes.mjs` needs `'tests/acceptance/857/'` added to its `alone` list beside
`'tests/acceptance/387/'`, which leaves the folder out of the parallel vitest line and runs it on the one-at-a-time
line, as #387's README asked for its own. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/857 --no-file-parallelism
npx tsc -p tests/acceptance/857/tsconfig.json   # type-check
```

Each file first builds the sets it uses with `cargo build --locked [--release] --bin deep-show --no-default-features
--features <set>[,test-threads]`, copies each binary out of `target/debug` or `target/release` under its own name, and
fails each test whose build failed. The release build (`full`, optimized) is made only on a reference Mac, where the
timing tests use it. Each test opens an evidence store root in a temporary folder and deletes it. A run with `--root
tests/acceptance/857` leaves Vitest's cache in `tests/acceptance/857/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

The timing tests (`speedup.test.ts`, the timed half of `background.test.ts`) run only on a reference Mac (Mac15,7 /
Apple M3 Pro / 36 GiB or Mac15,12 / Apple M3 / 16 GiB) and skip elsewhere with an `INCONCLUSIVE` message; they never
pass by skipping. As #379's gate does, and by the owner's rule, power, Low Power Mode, heat and load aren't gated: each
result prints them beside its five runs as a reading. Everything else runs headless on the CPU on any machine.

## Surfaces this suite defines

The issue names thread counts, a pool per budget class, a merge in node order, a not-thread-safe declaration, the
scheduler's thread, background priority for jobs, and planted programs, but no API. These tests extend #387's
`deep-show run` surface (its README: The surface under test), whose calls, replies and conventions hold unchanged.
Only what follows is new.

### Scenario fields

```json
{"threads"?: integer 1..64,
 "background"?: [{"job": "playtest", "replicas": integer ≥ 1, "document": Document}
               | {"job": "bake", "document": Document}]}
```

- `threads`: every document session in the run evaluates on a pool of exactly this many threads, in place of its
  budget class's setting. Without it, a session's pool is its class's: `core_view` 1, `data_view` and `figure` 2,
  `work_product` and `showpiece` 4, `export` the machine's performance cores (the issue's scope).
- `background`: jobs that start before the scenario's first call and run until its last call has answered. A
  `playtest` runs `replicas` copies of `document`'s session and a `bake` runs one; each copy is checked as a
  `deep_show` would check it, then evaluated frame after frame at successive times 1/60 s apart (wrapping at its
  span), as fast as it can, through the scheduler with the pool its document's class sets. Every thread a job uses
  runs at the platform's background priority (on macOS the background QoS class), below the threads that evaluate
  the scenario's own calls. These stand in for the platform's playtest and bake jobs, which don't exist at the base:
  real canvas-core work, at a job's priority. (A job's document that the check refuses evaluates no frame, which the
  tests fail on.)
- `planted` (#387's) takes two more values, each a wrong program reachable only there:
  - `merges_in_finish_order`: the scheduler collects a phase's results from its workers in the order they finish
    and stores them by that order: the k-th result to arrive is stored as the k-th node's in the plan's order (the
    bug of zipping a channel's arrivals with the node list). At one thread it's the shipped program.
  - `background_at_live_priority`: the `background` jobs' threads run at the priority of the threads that evaluate
    the scenario's own calls (the live view's), not at background priority.

### `eval`, extended

The reply gains:

```json
{"threads": integer, "frame_ms": number,
 "nodes": [{… #387's fields, "thread": integer | null}]}
```

- `threads`: the size of the pool this evaluation ran on.
- `thread` on each node: when its `run` is `ran`, the thread its operator ran on: `0` the scheduler's own thread,
  `1` to `threads` the pool's workers; for a check-phase node listed "as the revision's check had them", the thread
  it ran on in that check. `null` when its `run` is `hit` or `kept`.
- `frame_ms`: the frame's wall time on the binary's own clock, from the start of its first frame phase to the end of
  its last, every pool thread's work included (the frame's CPU time as the budget table's Frame CPU column limits
  it), excluding the reply's own digests and render-back.
- `nodes`, keys, results (each node's writes) and `issues` are the same at every pool size: results merge in the
  plan's node order.

### `frames`, extended

```json
{"threads": integer,
 "frames": [{… #387's fields, "frame_ms": number}],
 "background": [{"job": "playtest", "replica": integer 1..replicas, "frames": integer}
              | {"job": "bake", "frames": integer}]}
```

`threads` and `frame_ms` as for `eval`. `background` lists every job copy of the scenario's `background`, each with
the frames it evaluated from its start until this reply.

### The registry, extended

Each entry of `operators` (#387's) gains `"thread_safe": bool`: false for an operator whose canvas module declared it
not thread-safe, which runs only on the scheduler's own thread; true otherwise (the default, declaring nothing).

### The test canvas modules: Cargo feature `test-threads`

In no shipped build. A document that uses a kind declares its module in `requires.modules`. Both kinds are drawn
as `rect@1` (their `box` filled), as #387's test kinds are.

| Module | Manifest and registration | For |
|---|---|---|
| `test.serial` 1.0.0 | Kind `test.serial@1` {`box`}. Array `test.serial.out` (item). Operator `test.serial.out` (phase items; reads `[self]`; writes `test.serial.out`: its box's area), declared **not thread-safe** | criterion 3, first half |
| `test.racy` 1.0.0 | Kind `test.racy@1` {`box`}. Array `test.racy.out` (item). Operator `test.racy.out` (phase items; reads `[self]`; writes `test.racy.out`; declares nothing, so thread-safe), which also reads and bumps a process-wide counter, outside the core and its read set, and writes the count it read beside its box's area: **the planted operator**. The canvas lint refuses a static in a `deep-canvas*` crate, so it may live in `deep-show` (as #387's `test.accent` does) | criterion 3, second half |

Builds the tests make: `full`, `full,test-threads`, and on a reference Mac `full` with `--release`.

## Criteria to tests

Each test's name starts with `#857.<n>`, n the criterion's number in the issue. Where a criterion names a wrong
program, the test runs it through `planted` or the test feature and asserts that it fails the way the criterion
says, naming what it says.

| Criterion (the issue's text) | Tests, and the wrong programs each fails on |
|---|---|
| 1. A 10,000-item board's frame with every item changed gives the same keys, writes and pixel hash at 1, 2, 4 and 8 threads; a planted merge in finish order differs at some count and fails, naming the first node whose write differs | `threads.test.ts`, on `full` (debug): a board of 9,500 rects and 500 labels shown in variant 0, framed, shown in variant 1 (every item changed) and framed with its pixels, in a fresh process per count (`threads` 1, 2, 4, 8). At each count the reply's `threads` is the count, every one of the 10,000 items has a frame-phase node that ran, and from 2 threads up the nodes that ran name more than one thread. At 2, 4 and 8 every node's key and result, the issues and the snapshot equal the frame at 1 thread. Under `planted: "merges_in_finish_order"` at 2, 4 and 8, some count differs from the shipped frame at 1 thread, and the failure names the first node, in the plan's order, whose write differs. Wrong programs: the base; a pool never used (everything on one thread at every count); the finish-order merge |
| 2. On the reference Mac that frame runs at least 2.5 times faster at 4 threads than at 1 on an optimized build, and a frame with one item changed is no slower at 4 than at 1 | `speedup.test.ts`, on `full --release`, reference Mac only: per run, a fresh process shows the board and frames it after each of 10 revisions (2 warm-up, 8 timed); the run's time is the median `frame_ms` of the 8. Five runs at 1 thread and five at 4, in turn; run k's ratio (4 threads over 1) judged against 1/2.5 for revisions that change every item (the board's variants), and against 1 for revisions that move one rect. Wrong programs: the base; a pool that adds dispatch without dividing the work; a pool that slows a one-item frame |
| 3. An operator that declares itself not thread-safe runs only on the scheduler's thread, and a planted operator that touches shared state without declaring it is caught by the shuffle test at 8 threads, naming it | `serial.test.ts`: in `full,test-threads` the registry gives every operator a boolean `thread_safe`, `test.serial.out` false and `test.racy.out` true; at 8 threads a board of 1,000 rects and 200 `test.serial@1` items runs all 200 `test.serial.out` nodes on thread 0 while its other nodes run on the pool. The shuffle test with thread counts (the issue's scope line), on `full`: a board of 60 moving rects, 400 still rects and 40 labels framed at 1 s with pixels, unshuffled and under `shuffle` 1 to 8 at 1, 2, 4 and 8 threads, every node's key and result, the issues and the snapshot equal the unshuffled frame at 1 thread. The planted `test.racy` (200 items on that board) at 8 threads, unshuffled and under seeds 1 to 8, differs from its unshuffled frame at 1 thread, and the nodes that differ are exactly `test.racy.out`'s. Wrong programs: the base; a not-thread-safe operator put on the pool; the planted racy operator |
| 4. With a 4-replica playtest batch and a light bake running, a work-product view on the reference Mac keeps its p95 frame CPU inside its 4 ms class; a planted batch at the live view's priority pushes it past, naming the frames | `background.test.ts`: the view is a `work_product` board of 84 rects that each move every frame; `background` is a 4-replica playtest of a 600-moving-rect piece and a bake of a 300-moving-rect document (both class `export`). On `full` (debug, any machine): the view's frames run on its class's pool of 4 and every job copy reports frames evaluated. On `full --release`, reference Mac only: per run a fresh process, 60 warm-up frames then 300 timed; five runs' p95 `frame_ms` judged against 4 ms. Under `planted: "background_at_live_priority"` five runs judged the other way: caught when all five p95s are over 4 ms by more than the margin, FAIL when all five are within, else INCONCLUSIVE; each planted run names its frames over 4 ms (index, time and ms). Wrong programs: the base; jobs at the live view's priority; jobs that do no work |

## Readings where the issue and design leave a choice

- **One binary.** The scheduler is observed through #387's `deep-show run`; the live view of criterion 4 is a
  document session evaluated frame after frame by the `frames` call, the scheduler's own view of a live view.
  `deep-gpu`'s `live` call (#379) times a GPU-layer view that doesn't evaluate through the canvas scheduler at the
  base, so it isn't where the pool shows. The render worker the issue names isn't in `deep-show`; the tests check
  the jobs against the view's threads.
- **Thread counts per process.** Each thread count runs in a fresh process: in one process an equal key's result
  would be a cache `hit` from the earlier count and the frame would prove nothing about the pool. The scenario's
  `threads` sits beside `shuffle`, as the issue puts thread counts into the shuffle test.
- **"Keys, writes and pixel hash"**: every node's `key` and `result` (the digest of what the node wrote), the
  frame's `issues` (the issue's scope: "every write, issue, key and digest is the same at any thread count") and the
  render-back snapshot's sha256. The frame at 1 thread is the reference. Nodes are compared by `(operator, item)`, not
  by their place in `nodes`, since the order nodes ran in may differ by thread count; "the first node whose write
  differs" is the first in the 1-thread frame's order, the plan's.
- **"Every item changed"**: a revision in which every one of the 10,000 items differs from the last (each rect
  moves and changes its fill role; each label moves and changes its text). Labels spell numbers in letters: a label
  showing a number with no source is refused (`number_unsourced`). The board names no budget class: a 10,000-item
  live class would be refused by the check's estimate, and `threads` sets the pool.
- **Using the pool.** "Same at 1, 2, 4 and 8 threads" proves nothing if no frame ever leaves one thread, so from 2
  threads up the nodes that ran must name more than one thread; and the not-thread-safe test requires the frame's
  other nodes to reach the pool's workers.
- **The speedup** is a ratio of the binary's own `frame_ms`, paired run by run, judged by the design's rule like any
  timing: ratio ≤ 1/2.5 for every item changed, ratio ≤ 1 for one item. A run's time is the median of 8 frames after
  2 warm-up revisions. "Optimized build" is `cargo build --release`.
- **The work-product view** is as heavy as its class admits: the check's estimate (#379's `costs.json`) charges about
  45 µs a moving rect against the class's 4 ms and refuses a work product past it, so the view holds 84 moving rects.
  A reading at the base, on this reference Mac on battery with a load average near 100: a release build's `frames`
  call on that view reports 2.0 to 2.6 ms of `scheduler_ms` per frame on one thread (operator bodies excluded), so
  the view's frame is a real fraction of its 4 ms class.
  Criterion 4 doesn't say optimized; its view's frame is timed on the release build too, since the class budget is
  the shipped app's. Its frame CPU is `frame_ms` (wall time of the frame's phases across the pool), not the summed CPU
  time of its threads: a preempted thread charges no CPU time, and the criterion is about the view keeping its frame
  time while other work runs.
- **The jobs.** No playtest or bake job exists at the base, so the scenario's `background` defines them as copies of
  a document's session evaluated frame after frame through the same scheduler, at the job's priority. Their
  documents are of class `export` (no frame cap, so the check admits their size). "A light bake" is one bake of a
  smaller document than the piece. A job's progress is reported so a job that does nothing fails. "A planted batch at
  the live view's priority" plants every background job at that priority.
- **"Caught by the shuffle test at 8 threads, naming it"**: the frames at 8 threads (unshuffled and under seeds 1 to
  8) against the unshuffled frame at 1 thread; the nodes that differ are exactly the planted operator's, so the
  failure names `test.racy.out` and nothing else.
- **"Runs only on the scheduler's thread"** is read on the node's `thread`: 0 for every node of the operator.

Not tested, because no criterion asks or the surface can't reach it: the pool sizes of classes other than work
product (`threads` overrides them in criteria 1 to 3, and criterion 4 names work product); `export` taking the machine's
performance cores; logic step blocks (the issue leaves them out); `parallel: fixed_blocks`; asset jobs, checks and
replicas outside the two job kinds; the render worker's priority; the merge-base comparison of the timings, which is
the perf lane's.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria, so these tests are the local proof for all four.
