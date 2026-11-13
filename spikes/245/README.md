# Spike #245: copy-on-write logic blocks against one instance

Design: [Step blocks](../../docs/technical-design.md#step-blocks) and canvas primitives' Logic: step blocks. The
question: does the app run a step's blocks each in its own instance mapped copy-on-write from the step's state, on 4
logic threads (`copy_on_write`), or one after another in one instance (`one_instance`)? The rule (issue #245):
`copy_on_write` only if its step's wall time on 4 threads is at most half `one_instance`'s, and its mapping and
page-fault overhead stays under 0.3 ms a step. Otherwise the app runs `one_instance`, every class's logic threads read
1, and nothing in a document changes.

## The answer

**`one_instance`.** The app runs a step's blocks one after another in one instance, every class's logic threads read
1, and nothing in a document changes. `copy_on_write` misses both thresholds:

| On Mac15,12 (M3, 8 cores, macOS 14.7.7, mains power, Low Power Mode off, thermal nominal) | one_instance | copy_on_write | Rule |
|---|---|---|---|
| Step wall time p50 | 4.230 ms | 3.473 ms (0.82×) | at most 0.5× |
| Step wall time p95 | 6.136 ms | 4.540 ms (0.74×) | at most 0.5× |
| Overhead p50 / p95 | 0.098 / 0.129 ms (restoring S) | 2.067 / 3.420 ms (mapping and page faults, summed over the 8 blocks) | under 0.3 ms |
| of which mapping p50 / first touches p50 | none | 0.723 / 1.227 ms (239 16 KiB pages a step) | |
| Write check p50 (both forms, not overhead) | 1.151 ms | 1.980 ms (summed over the 8 blocks) | |

Each test fails on its own. The wall-time ratio misses 0.5× at both p50 and p95, and the overhead is 11 times the
threshold at p95. The overhead is summed over the 8 blocks, the way the rule reads it. The blocks run 2 to a thread, so
only about a quarter of that sum, plus the main thread dropping the mappings, lands on the step's wall time. Even
counted that way it is near 0.85 ms at p95, still past 0.3 ms, so no reading of "a step's overhead" changes the verdict.
Nor can the overhead be subtracted from the wall time to see what a cheaper mapping would reach. The run is `record.json` (3,600 steps per form after 120 of warm-up, at c8d5d7f0). Both forms ended in the
same full-state hash, `86bb805a…`, the Spark's too. The Mac runner's own log and timestamps are in `mac/`: one try,
exit 0, load 3.3 at the end and 7.5 at the start on 8 cores, within record.mjs's gate.

**The memory file on macOS.** The log line `memory file: no private mapping: Invalid argument (os error 22)` is macOS
refusing a private mapping of a POSIX shm object, so the harness fell back to an unlinked file in the temp folder
(`memory_file: "tmpfile"` in the record): S is a shared mapping of that file, each block a private mapping of it. That
is a real copy-on-write mapping, and the only POSIX one macOS offers. Mach's `mach_vm_remap` with copy (a copy-on-write
copy of anonymous memory) wasn't tried. It might map and fault more cheaply, but it would have to cut the overhead by
more than 90% at p95, and the wall-time ratio would still have to reach 0.5×. A later issue that wants to revisit the form would start there, with
this harness.

On the Spark (Linux, 4 KiB pages, not evidence for the verdict), `copy_on_write` touched 819 pages a step, and
mapping and first touches cost about 1.9 ms a step at p50: the same order.

## What is here

| File | What it is |
|---|---|
| `steer.wat` | The 8,000-agent steering fixture at 60 Hz with 8 blocks, which #212 reuses. Its header has the memory layout and the `parallel` fields #212 declares for it. |
| `src/main.rs` | The harness: the fixture through sandbox@1's check, the logic role's check and the logic rewrite (`Mode::Logic`: fuel, page bitmap, exported globals), on wasmtime 49.0.5 with deep-sandbox-wasmtime's engine settings, in both forms. |
| `record.mjs` | Builds the harness, runs both forms, reads the host through `scripts/benchmark.mjs`'s `fingerprint()` and stores `record.json` with the verdict from `rule.mjs`. It stores nothing when the 1-minute load is above the core count. |
| `rule.mjs` | The rule as a pure function `verdict(record)`: what the logic module's build reads (#212). |
| `record.json` | The reference Mac's run: host, fixture hash, every step's wall time and overhead in both forms, and the verdict. |
| `mac/` | The Mac runner's log of that run (`run.txt`), its timestamps and exit code (`exits.txt`) and its environment (`run1-env.txt`). |
| `spark-linux.json` | The same harness on the Spark (Linux arm64) without per-step samples: a reading for fuel and bits, never for timing. |

Run it on a reference Mac (Mac15,7, Mac15,12 or Mac17,10), on mains power, Low Power Mode off:

```sh
node spikes/245/record.mjs spikes/245/record.json 3600
node --test 'tests/acceptance/245/*.test.mjs'
```

## How each form runs

Both forms run `step(k)`, then the 8 blocks `block(k, b)` on S (the memory and globals `step(k)` left), then merge
the blocks' slices and run `join(k)`. Each block counts its fuel from zero, and each block's written pages (the
rewrite's page bitmap) are compared with S outside its slices and scratch, so a stray write traps `block_write` in
either form. Steps are paced at 60 Hz. The first 120 steps are warm-up and the next 3,600 are recorded. A step's
wall time runs from the start of `step(k)` to the end of `join(k)`.

- **one_instance** (1 thread): before the blocks it keeps S's out-region pages and scratch page aside. After each
  block it keeps the block's slices, restores its slices and scratch from S, zeroes the scratch and restores the
  globals. Then it writes all slices back. Its `overhead_ms` is that keeping and restoring. It maps nothing.
- **copy_on_write** (4 threads, blocks dealt round-robin): the main instance's memory is a shared mapping of a memory
  file holding S (a memfd on Linux; a POSIX shm object on macOS, or an unlinked temp file if the OS refuses a private
  mapping of shm, named in `memory_file`). Each block has its own instance whose memory, inside a reservation with
  wasmtime's guard so the compiled code is the same, is a private mapping of that file. Before each block, the worker
  maps it again (`map_ms`). It then touches each OS page the block reads or writes (`fault_ms`), so the block runs
  with no fault: on Linux the run fails if a block faults after its touches, and the Spark run saw 0. After the
  merge, the main thread drops every block's mapping before `join` writes S (also `map_ms`). `overhead_ms` is
  `map_ms + fault_ms`.

Both end in the same bits: the full-state hash (memory and mutable globals) matches every 600 steps and at the end
(`deep_hash`). A fixture that writes outside its slices trips `block_write` (checked with a mutant that stores into
POS: `block_write {block: 0, offset: 0} at step 0`).

## The fixture's cost

Fuel is the same on every machine (the Spark run, `spark-linux.json`):

| | p50 | max |
|---|---|---|
| `step` (binning 8,000 agents into a 128 × 128 grid) | 1,315,927 | 1,315,927 |
| 8 blocks together | 5,845,983 | 8,390,516 |
| busiest block | 738,287 | 1,055,708 |
| `join` (two 128,000-byte copies) | 256,009 | 256,009 |
| whole step | 7,417,919 | 9,962,452 |
| critical path on 4 threads | 3,040,164 | 3,677,043 |

That is close to the design's estimate (0.8M + 6.4M = 7.2M on one thread, 2.4M on 4). The whole step stays under
`budget.fuel`'s 10,000,000. A block needs up to 1.06M fuel, above `parallel.fuel`'s default 500,000, so the fixture
declares `parallel.fuel: 2,000,000`. #212 should note that the default cannot hold 1,000 agents a block at this cost.

Earlier drafts of the fixture went past 10M: a seek toward one shared target, and two crowds crossing, both clumped
into flocks at 15–16M a step. Its agents now seek goals of their own, and each considers its first 12 candidates in
the 2 × 2 cells within reach of radius 8, which bounds the step.

## Disclosed limits

- The workers wait on `std::sync::Barrier` (mutex and condvar) twice a step. A spin-then-park pool would wake
  faster, so `copy_on_write`'s wall time is if anything conservative.
- `one_instance` copies about 384 KB of S each step to restore from and compare against: roughly 15–40 µs, counted
  in its wall time and its `overhead_ms`.
- The write check compares whole 64 KiB pages outside each block's slices. It costs about 0.7 ms a step on the Spark
  in both forms (`check_ms`), and neither form's `overhead_ms` counts it.
- The pre-touch covers the fixture's own read and write ranges (`reads()` and `allowed()` in `src/main.rs`), checked
  against the fixture's exported layout globals at start. A block that reads more would fault inside its run: the
  Linux check catches that, but macOS can't count faults per thread, so it relies on the same fixture and layout.
- Where `one_instance` kept no copy of S, it names a stray write by its page's first offset, not the exact byte.
- `rule.mjs` doesn't check that the forms ended in the same bits, since the blind suite's planted records carry no
  hashes. The bits are checked where a record is made and kept: `record.mjs` stores nothing when they differ, and AC1
  asserts the stored forms' `deep_hash` values are equal. The rule doesn't pin `fixture.sha256` either; AC1 checks it
  against `steer.wat`.
- `record.mjs` takes `base_commit` from HEAD without checking the tree is clean. The Mac run's was (`mac/exits.txt`:
  `status []`).
- The Spark's timings are INCONCLUSIVE (load 25–41 on 20 cores, not a reference Mac). They show one thing worth
  knowing: with 4 KiB pages, mapping and first touches cost about 1.9 ms a step at p50 (819 pages touched per step).
