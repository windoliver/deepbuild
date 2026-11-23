# Acceptance test for #980 criterion 9, drafted afresh: the step budget

Criterion 9 (`#980.238de3e1`): "Budget, a proposal until measured on the reference Mac in the local preflight: a model of
2,000 live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step."

A fresh run of the acceptance-test job for this one criterion (docs/technical-design.md: Dogfooding; AGENTS.md: Proof),
written at the base `3f02bf52b` ("Merge pull request #2885 …"), where nothing knows process@1, from the issue, the
design and the base commit alone. The job saw no implementation and read no other worktree, branch, pull request,
plan or session; it did not read the suite's first test for this criterion, nor anything said about it. It imports the
suite's shared harness (`../980/`: README, helpers, programs, scenes), which defines process@1's surface as every test
of #980 uses it, and edits none of it. The implementing agent doesn't edit this folder.

## What was read

- The issue (saved today: title, labels, body; no comments): Scope, Fields, "It can never", the ten criteria, Proof,
  Not in scope. The ID is `scripts/proof-change.mjs`'s `criterionId` of the criterion's line, worked from the body.
- `docs/technical-design.md`: The logic module (Logic, Sandbox and budgets, Logic bake and checks, Linked libraries,
  Library interfaces, Data layouts); Criteria to tests; Wrong programs; Proven on the base; Dogfooding; Every task
  carries its own budgets; The reference Macs. `AGENTS.md`, `CONTRIBUTING.md`.
- `docs/canvas-primitives.md`: Logic `logic@1`; Logic: sandbox; Logic: linked libraries; Logic: library interfaces (its
  `process@1` paragraph); Logic: data layouts.
- At the base, for call shapes only: `tests/acceptance/980/` (the six harness files); `981/README.md` and
  `981/ac8-budget.test.ts` (a sibling interface's step budget); `190/helpers.ts`; `416/interfaces/{helpers.ts,wat.ts}`
  and its `layoutProbe`; `532/README.md` (`view`, `frame`, a Frame's fields); `545/README.md` (a frame's `draws`);
  `194-redraft-ac11/` (a redraft's README and BASE-FAILURE.txt, for their form);
  `crates/deep-logic/src/{lib.rs,live.rs,budget.rs,bake.rs,world.rs,world/world_impl.rs,piece/checks.rs,first_party.rs,judge.rs}`
  (what `first_party`, `check`, `view` and `frame` take and return; what a frame's simulate phase runs and times);
  `scripts/{benchmark.mjs,lanes.mjs,proof-change.mjs,throttle.mjs,lease,studied-names.mjs}`; `Cargo.toml` (the dev
  profile builds `deep-logic` and the sandbox at release speed).

Every expected value comes from the criterion, the issue or this folder's own arithmetic; none from an implementation.

## Run it

```sh
npm ci && npm run build --workspaces                 # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/980-redraft-ac9 --no-file-parallelism --testTimeout=1200000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/980-redraft-ac9/tsconfig.json
rm -rf tests/acceptance/980-redraft-ac9/node_modules   # vitest's cache
```

On a shared machine the same command runs behind `node scripts/throttle.mjs <class> --wait <min> -- sh scripts/lease`.
What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` (#190's helpers, imported unchanged) and #416's assembler
arrangement (`../416/interfaces/wat.ts`, into `target/acceptance-416-wat`). It starts two `deep-logic` processes, each
stopped by its PID, and `fingerprint`'s `sysctl`, `pmset`, `osascript` and `sw_vers` reads; temporary folders are the
helpers', removed by them. The one test passes #190's 90-minute timeout; once the binaries are built it takes about
1,800 frames, under a minute on a Mac at rest.

## The test

`ac9-budget.test.ts`, one test: `#980.238de3e1 a model of 2,000 live entities, 40 queues, 30 resources and 10
conveyors steps in under 0.3 ms a step`. In order:

1. **The model as built** (model.ts): its builder calls make 2,000 entities, 40 queues, 30 resources and 10 conveyors;
   every case is made before the first timed step and none can be out before the last.
2. **The idle item**, which needs no process@1: a `view` of it opens and its frames 0 to 599 each run one step.
3. **process@1**: one first-party pack declares it and carries one library that implements it, the reference library.
   At the base this is where the test fails.
4. **The model's item** links that library through `lib:process@1`; a `view` of it opens and its frames 0 to 599 each
   run one step without a trap.
5. **Steps 600 to 899**, five runs of 60: the model's frame, then the idle item's, a step each. Each of the model's
   300 timed steps is first held to the criterion from the arrays that step left (below); a step that isn't the
   criterion's model fails the test there, whatever its time.
6. Between the first and the last timed step the model ran on: every queue let entities go and every conveyor's
   furthest case rode further.
7. **The budget**: `judgeLimit` on the five runs, each the model's median frame less the idle item's, against 300 µs.

Parts 1 to 6 hold on any machine and under any load; only part 7 reads the machine.

| ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|
| 9 `#980.238de3e1` | `ac9-budget.test.ts` (1) | the model's builder calls make 2,000 entities, 40 queues, 30 resources and 10 conveyors; each of 300 timed steps runs one tick with 2,000 live, none out, all of them at the queues, resources and conveyors, every one of which holds work; the model ran on between the first and last of them; five runs of 60 steps, the model's median frame less an idle item's, under 300 µs by `judgeLimit` with loads. Fails: the base, which has no process@1; a model short of the criterion's counts or standing still; a slow step. INCONCLUSIVE off a reference Mac or under load, never a pass |

## The surface

Nothing is asked of process@1 or of `deep-logic` beyond #980's README and the base's own calls.

**From #980's README**, as written there:

- The first-party pack: a pack of `first_party` whose `interfaces` holds `process@1`, and in its `libs` one entry whose
  `implements` names `process@1`, with its `asset`. This test reads no more of the pack than that.
- Pieces: `LogicParams.process = {"kinds": ["case"]}`, with `links: [{name, asset}]` of the reference library, the
  program importing `lib:process@1` (`../980/programs.ts`: `sceneProgram`).
- The header: `tick` 1/60, `rows` 2,000, `kinds` 1, `ring` 96, `window` 3,600 and `warmup` 0 (the issue's defaults).
- Exports: `sink`, `resource`, `conveyor`, `queue` (order 0, no capacity), `request` (one resource, a fixed `hold`),
  `source` (a table of times, `at`) and `stats(s, 1, out)` once a step with `out` the item's `writes_at`. Not used:
  `release`, `pack`, `unpack`, `mean_gap`, `mean_hold`, `every`, `until`, a queue's capacity or order by a column.
- Arrays read: `clock`, `made_n`, `out_n`, `kind`, `count`, `busy`, `cap`, `left`, `at`, `d`. The item declares all of
  process@1's arrays (`../980/programs.ts`: `processWrites`).

**From the base**, unchanged:

- `{"call": "first_party"}` (#416), `{"call": "view", "piece", "track": [], "span": 15}` and `{"call": "frame",
  "session", "seek": k ÷ 60}` (#532). Of a frame's reply the test reads `ok`, `steps`, `at`, `traps`, `eval_ns` and
  `draws` (#545: `{"<logic ID>.<name>": [value]}`, every write of the item as drawing reads it, here as the last step
  stored it, since no write is linear). Example: `draws["model.count"][91]` is the model's live count.
- `scripts/benchmark.mjs`: `fingerprint()` and `judgeLimit({limit, runs, fingerprint, loads})`.

**This job's own**, in this folder: the model (model.ts) and the idle item's program (a whole module with the model's
128 pages of memory, `reads_at` 0 and `writes_at` 4096, and empty `init` and `step`), with an item of the model's
`writes`, `step_rate` and `budget` and no `process` or `links`. The harness's `BUDGET` scene and `idleProgram` are not
used: the model and how it is timed are this draft's. The two pieces, each with one item `model`:

```text
the model   {"seed": 980, "packs": [], "assets": {…the first-party packs' assets, the program…},
             "items": {"model": {"kind": "logic@1", "params": {"program": <sha256>, "step_rate": 60,
               "writes": {…process@1's 25 arrays…}, "budget": {"fuel": 10000000, "memory": 8},
               "process": {"kinds": ["case"]}, "links": [{"name": <the reference library>, "asset": <its sha256>}]}}}}
the idle    the same item with its own program and without "process" and "links"; "assets" holds its program alone
```

## The model

Ten lines, 200 cases each, one kind (`case`), a tick of 1/60 s and one tick a logic step. A line, in the order a case
meets it:

```text
source → queue → 12 units, 2 s → queue → 6 units, 2 s → queue → 4 units, 2 s → queue → conveyor → sink
```

- **The source** makes the line's 200 cases one a tick: line l (0 to 9) from tick 12·l, as a table of 200 times.
- **Three resources** of capacity 12, 6 and 4 (the Scope's "six forklifts, twelve pickers or four dock doors"), each
  behind a request station of its own that holds a case 2 s (120 ticks), and each fed by a queue.
- **The conveyor** is the issue's own (criterion 3): 10 m at 0.5 m/s with 0.6 m spacing, 1,200 ticks end to end, a
  case let on every 72 ticks, fed by the line's fourth queue. All ten end at one sink.

So the model holds 10 × 4 = **40 queues**, 10 × 3 = **30 resources** and **10 conveyors**, in 91 stations (a sink, and
a line's source, four queues, three request stations and conveyor), and its sources make 10 × 200 = **2,000
entities**. The test counts these from the builder calls its program makes, and reads them again from each timed
step's arrays.

**Live.** The last case is made at tick 12·9 + 199 = 307. A case leaves only by a conveyor, 1,200 ticks after it came
onto one, so nothing can be out before step 1,200 however the stages run. From step 307 to 1,199 the model holds
2,000 live entities; the timed steps are 600 to 899.

**At work.** Each stage is slower than the one before (12, 6 and 4 cases every 2 s, then one every 1.2 s), so cases
gather in every queue. By this folder's arithmetic (and a plain reference model of #980's step contract, below) every
queue, every resource and every conveyor holds at least one entity from step 469 on (line 9's last queue takes its
first waiting case at tick 108 + 361), and the first case is out at step 1,560. Over the timed steps the queues hold
1,748 falling to 1,708 entities, the resources 220 (all 22 units of a line held) and the conveyors 32 rising to 72;
a queue holds at least 104, 24, 6 and 4 by its place in the line.

**A typical step.** A line's first stage lets a case go and takes the next on 12 ticks in a row every 120, and the
lines start 12 ticks apart, so on every tick one line does; its second and third stages follow on the first 6 and 4
of those ticks. Each timed step makes 2 to 8 moves between stations (2 on half the steps, 4 to 8 on the other half)
and carries 32 to 72 cases a tick further along a belt, and each run of 60 steps holds the same mix. That is why the
cases arrive a tick apart and the lines 12 ticks apart: were every case made at tick 0, each stage would move 12, 6
and 4 cases at once every 120 ticks and the median step would move nothing.

**What each timed step is held to** (model.ts: `stateProblems`), from the arrays that step left:

- `clock[0]` is (k + 1) ÷ 60 s within 1e-9: step k ran the model's tick k.
- `made_n[0]` 2,000, `out_n[0]` 0, `count[91]` (live) 2,000, and 2,000 rows with a kind (`kind` ≥ 0).
- The counts at the 40 queues, the 30 request stations and the 10 conveyors sum to 2,000.
- `cap` is the 30 capacities as built: 12, 6, 4, ten times.
- `count` ≥ 1 at each of the 40 queues and the 10 conveyors, and `busy` ≥ 1 at each of the 30 resources.

And between steps 600 and 899 (`progressProblems`): `left` grew at each of the 40 queues, and the largest `d` among
the rows at each conveyor grew.

## How a step's time is read and judged

- Two `deep-logic` processes each hold a live view (#532) of one piece: the model's item, and the idle item. Frame k
  seeks to k ÷ 60 s, so its simulate phase runs step k alone; the test holds every frame to `steps` 1, `at` k + 1 and
  no trap. A frame's `eval_ns` is that phase's CPU time on the render worker's thread, which other processes' load
  doesn't stretch.
- Steps 0 to 599 are warm-up for both. Then five runs of 60 steps: at each step the model's frame, then the idle
  item's. A run's reading is the median of the model's 60 `eval_ns` less the median of the idle item's 60, in µs, with
  the one-minute load (`os.loadavg()[0]`) at the run's start and end.
- `judgeLimit({limit: 300, runs, fingerprint: fingerprint(), loads})` judges the five (design: Every task carries its
  own budgets): all five within 300 µs is PASS; all five over it by more than the margin is FAIL, and the test fails;
  anything else, off a reference Mac, off mains power, a thermal state that isn't nominal, a load above the cores, or
  readings on both sides, is INCONCLUSIVE and the test fails with a message starting `INCONCLUSIVE:` and its readings;
  a reading below zero (the model's frame quicker than the idle one) can't be judged and fails as `BLOCKED:`.
- What the difference holds: the program's step, which is one `stats` call (a tick of the model and all of
  process@1's arrays written), and what the logic module does more for a step whose arrays changed (it keeps the
  changed ranges). What it leaves out: entering the program, copying its write region out and hashing it, the same
  for both items.
- The binaries are the debug build the suites build; the workspace's dev profile builds `deep-logic` and the sandbox
  at opt-level 3, so the logic module's own work runs at release speed there.

## Readings where the criterion leaves a choice

- **"A model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors"**: one model with all four at once.
  *Live* is made and not yet out: process@1's live count, 2,000 at every timed step, with no case out. The elements
  are counted at work: each queue holding a waiting entity, each resource a held unit and each conveyor a riding
  case at every timed step, so no queue, resource or conveyor is there only to be counted. Nothing is out while timed,
  since one case out would leave 1,999 live; so the sink takes nothing and no source makes anything in a timed step.
- **"Steps"**: a logic step that runs one tick of the model, the issue's "1/60 s step" (criterion 1), through one
  `stats` call that writes every array.
- **"In under 0.3 ms a step"**: the CPU time a step of the model adds to a frame, over what an item of the same shape
  that does nothing costs: as #981's suite read its sibling budget at the base, with `eval_ns` and an idle frame. One
  number is read as the median of a run's steps, and five runs are judged by `judgeLimit`, which passes all five at or
  under the limit.
- **"A proposal until measured on the reference Mac"**: the test holds the issue's 0.3 ms. The design lets a
  measurement made before the change move an estimate once; that is the owner's, not a test's. **"In the local
  preflight"** isn't something a test can see: it reads as this file run on the reference Mac.
- **The idle item links nothing.** It is the same item to the logic module (the same arrays, step rate, memory and
  budget), so its frame is the frame's own cost and the difference is all that stepping the model costs. It needs no
  process@1, so the idle half of the timing runs at the base. An idle program that linked the library and built the
  model at init would cost a frame the same.
- **The stages hold a fixed 2 s**, not an exponential time: the same model at every run, with nothing resting on the
  library's draws. 2 s is this draft's: short enough that every stage and conveyor is at work 8 s into the run.
- **`rows` 2,000**: a row for each entity and none spare. **`ring` 96**: the most departures any queue, request station
  or conveyor has by the last timed step (a first stage's eight rounds of 12), so every statistic of a timed step is
  over all of its window's departures, as #980's README says its scenes' are; a source's times are all 0, so its
  200 change nothing. **The window and warm-up** are the issue's defaults.
- **Warm-up 600 steps, then 300 timed**: the design's five runs after warm-up, 60 steps a run. 600 is past the step
  from which every element holds work (469) by more than two seconds of the model; 899 is 300 steps short of the first
  step anything could be out.

## Not covered, because the criterion doesn't reach it

A step in which a sink records or a source makes; exponential gaps and holds; `release`, `pack` and `unpack`; a queue
with a capacity or ordered by a column; a window shorter than the run; p95; the kind rules on this model (their own
criteria hold them); the first-party pack beyond its one library (criterion 1's test).

## Checked at the base

BASE-FAILURE.txt holds the run. In short: the folder's test files ran once at the base `3f02bf52b`, with `deep-logic`
built there, and the one test fails at its own assertion in part 3, `ac9-budget.test.ts:107`, because no first-party
pack of the base declares process@1:

```text
AssertionError: one first-party pack declares process@1 (the build's first-party packs: interfaces@1.0.0, lanes@1.0.0, modslib@1.0.0): expected [] to have a length of 1 but got +0
```

- **What ran cleanly before it**: the file loaded and the helpers' builds succeeded; part 1 held; the model's program
  and the idle item's were assembled; the idle item's `view` opened and its frames 0 to 599 each ran one step without
  a trap; `scripts/benchmark.mjs` loaded; `first_party` answered `ok`. So the test fails on the missing interface, not
  at load, in a helper's own check, in a build or at a timeout.
- **What did not run**: parts 4 to 7. The base has no process@1 to link, so no step of the model ran there and no
  time was read or judged. This job has not measured the budget.
- **Parts 4 to 7 on a stand-in.** The run held a second test file, which passed: a probe of this job's, removed since
  and not in this folder. It was this test with part 3 cut out and the model's item swapped for one that links
  nothing, whose program holds process@1's arrays for the model at work as data and whose step writes the clock, the
  departures and the belt rows' distances. Its pass shows that the test's text from the model's `view` to `judgeLimit`
  runs at the base as written. It says nothing of process@1, and its readings were not kept.
- **The reference model** that The model names: #980's step contract (`../980/README.md`) for this model's builders,
  written out in plain script as a probe outside this folder. Run on the model, it gives what The model says: 2,000
  live from step 307; every queue, resource and conveyor holding work from step 469 to 1,559, and the first case out
  at step 1,560; over steps 600 to 899 none out, 1,748 falling to 1,708 in the queues, 220 at the resources and 32
  rising to 72 on the conveyors, a queue never under 104, 24, 6 and 4 by its place in the line; 2 moves on 150 of
  those steps and 4 to 8 on the other 150. It is this job's reading of the contract, and no test uses it. This job
  never stepped the model on process@1: parts 5 and 6 are what hold process@1's steps to the criterion's counts.

## What the implementer adds outside this folder

`scripts/lanes.mjs` (this job writes only its folder):

```js
// #980's criterion 9, drafted afresh (blind): its file builds deep-logic and #416's assembler and judges a step's
// time on the reference Mac.
alone.push('tests/acceptance/980-redraft-ac9/');
timed.push('tests/acceptance/980-redraft-ac9/ac9-budget.test.ts');
```

Nothing else: no pack, fixture or flag is asked for beyond #980's README.
