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
(27 or more 2 s renders apiece) one after another. The sweep now runs a chunk of presets per core, up to 8, and reads
the refusals back in the presets' order. Stack samples of the canvas core during the check show eight threads in
`Voice::render_part` under `presets_field_with`.

Its gain is **not measured**: `spark-foley-parallel.txt` (`foley-alone.mjs`) was taken at load 130 to 146 on 20
cores, where it reads 4.8 s with every core and 11 to 28 s pinned to one. `cargo test -p deep-canvas-media synth`:
9 passed.

Not shown here: that the two #1172 suites pass. They need the Mac's app window, and on the Spark the first check
plus one call is still about 9 s of their 10 s.

Left open: the canvas core still checks every installed pack at every call (1.6 s a call here); the design says once
per version.
