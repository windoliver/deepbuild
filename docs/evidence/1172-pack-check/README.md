# #1172 AC3 on main: the canvas core's first reply came after the test's 10 s

`tests/acceptance/1172/rows.test.ts` and `popout.test.ts` fail on main in their setup: the hub's first `canvas.user`
in a fresh home gets no reply within 10 s. The hub's canvas core checks every shipped pack before that reply, and it
checks every installed pack again at each call. A pack's library check compiles its programs and fixtures with
wasmtime's compiler, which the dev profile built unoptimized.

`time-calls.mjs <repo> <tmp>` times the hub's own code (`Packs.shipped`, then `Canvas.call` with and without the
store's packs) on the checkout's debug `deep-show`, and prints the load and each shipped pack's state. Both runs are
the same commit and the same hub build on the Spark, one after the other: `spark-fix-35471fdf1.txt` is the head, and
`spark-base-b6b99ad8c.txt` is the head built with the ten profile entries set back to opt-level 0
(`cargo build --config 'profile.dev.package.<name>.opt-level=0'` for each, into its own target folder), which is
main b6b99ad8c's build. Load was 22 to 26, so the absolute times are INCONCLUSIVE.

| | base | head |
|---|---|---|
| shipped packs checked, fresh store (15 installed in both) | 21,154 ms | 7,413 ms |
| new process, all packs, first call | 21,515 ms | 6,707 ms |
| later calls, all packs | 16,333 ms | 1,640 ms |
| later calls, all but lanes | 5,017 ms | 626 ms |
| a call with no packs | 5 ms | 4 ms |

## The Mac round at 35471fdf1 (`mac-35471fdf1/`)

The compiler change alone was not enough. Both suites fail at the base and at 35471fdf1 with `no reply to
canvas.user within 10000 ms` (rows 2 of 2, pop-out 1 of 1). The Mac's load was 37 to 107, so its times are
INCONCLUSIVE too: the shipped check took 13,790 ms at the base and 10,368 ms at 35471fdf1; later calls 9,919 to
12,841 ms and 1,826 ms.

## The preset sweep

Checked alone on the head's build, every pack takes under 1.3 s but `foley`, at 4.8 s: its 90 presets are each swept
(27 or more 2 s renders apiece) one after another. The sweep now runs a chunk of presets per core, up to 8, through
`deep_canvas::document::each_index` (the canvas crate's reviewed thread use, inline on one core, so the wasm lane
still passes), and reads the refusals back in the presets' order; `sweep-checks.txt` has the order test, its
wrong-order run and the wasm lane's exit code and last lines (its full output was not kept), taken at 19a859a0d,
before main's merge; the full preflight reruns the lane. Stack samples taken during the check showed eight threads in
`Voice::render_part` under `presets_field_with`; the samples were not kept.

Its gain alone is not measured: the Mac's foley timings below compare main, which has neither change, with the
head, which has both. On the Spark it could not be read: `spark-foley-parallel.txt` (`foley-alone.mjs`) was taken at load 130 to
146 on 20 cores, where it reads 4.8 s with every core and 11 to 28 s pinned to one. `cargo test -p deep-canvas-media
synth`: 10 passed.

## The Mac round at 2541c2b71 (`mac-2541c2b71/`)

Base is main 89df55943, the merge base; both clones were built and run one after the other on the same Mac
(`exits.txt` has each step's load, power and exit code). Load fell from 97 to 73 across the base's suites and
from 60 to 19 across the head's, and was 18 to 20 at every timing, so the suites' two sides did not run under the same load, and the times stay
INCONCLUSIVE as absolute numbers. A chat app was in front during the head's steps, not a bare desktop Space.

| | base 89df55943 | head 2541c2b71 |
|---|---|---|
| `rows.test.ts` | 2 failed of 2, `no reply to canvas.user within 10000 ms` | **2 passed of 2** |
| `popout.test.ts` | 1 failed of 1, the same setup wait | 1 failed of 1, on its first assertion (below) |
| shipped packs checked, fresh store | 13,025 ms | 2,256 ms |
| new process, all packs, first call | 12,534 ms | 2,133 ms |
| later calls, all packs | 7,492 to 7,542 ms | 1,008 to 1,020 ms |
| foley checked alone, three times | 4,816 to 5,106 ms | 947 to 1,014 ms |

The pop-out test now gets past its setup and fails at `popout.test.ts:25`: before the press it wants every ask's
question on the main window's pixels, and two of the three rows draw cut short (`Which font for th... How it looks`).
The row's cut is not part of this change; this round does not show whether main's app draws the same, since main
never got that far.

## A version vetted once per process

The Mac round on 2026-11-22 failed both suites in setup again at load 47 to 99, so the margin was not enough. The
canvas core's `install` admitted a known version once per process (`ADMITTED`), but still ran the sandbox's half of
its check, `Host::vet`, on every call: lanes' libraries compiled and their fixtures run again, about 0.65 s of each
call on the Mac. `Host::vet` now keeps what a passed check gave its host, per process, keyed by the pack, its
manifest's hash, the planted layouts, the evidence folder and the other packs the host holds (a provider's output
may name another pack's layout), and gives it to the next host. A host that already checked that version, or whose
evidence store lost bytes the check kept there, checks it afresh.

`crates/deep-show/tests/pack_vet_once.rs` reads it as cost, since the library check counts in none of the sandbox's
counters: a later `packs` call must take under a quarter of the first. Without the fix it fails, a later call at
1.015 s against the first's 1.047 s (`vet-once-fails-first.txt`); with it, it passes, the first call at 1.040 s and later ones at 5 to 10 ms (`vet-once-passes.txt`). It shows the
cost only, not that a replayed host equals a fresh one; that rests on review.

`spark-vet-once.txt`, the head on the Spark at load 19 (INCONCLUSIVE as times): later calls with all packs 142 to
146 ms, from 1,640 ms; the first call in a new process is still 6.9 s here and the shipped check 7.8 s.
