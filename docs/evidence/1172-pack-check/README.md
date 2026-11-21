# #1172 AC3 on main: the canvas core's first reply came after the test's 10 s

`tests/acceptance/1172/rows.test.ts` and `popout.test.ts` fail on main in their setup: the hub's first `canvas.user`
in a fresh home gets no reply within 10 s. The hub's canvas core checks every shipped pack before that reply, and it
checks every installed pack again at each call. A pack's library check compiles its programs and fixtures with
wasmtime's compiler, which the dev profile built unoptimized.

`time-calls.mjs <repo> <tmp>` times the hub's own code (`Packs.shipped`, then `Canvas.call` with and without the
store's packs) on the checkout's debug `deep-show`. On the Spark, load about 50, so the times are INCONCLUSIVE as
absolute numbers; both runs had the same load:

| | main 7a256fd4b | with the compiler at opt-level 3 |
|---|---|---|
| shipped packs checked, fresh store | 30,001 ms | 7,148 ms |
| new process, all packs, first call | 23,588 ms | 7,217 ms |
| later calls, all packs | 14,698 ms | 1,382 ms |
| later calls, all but lanes | 4,370 ms | 510 ms |
| a call with no packs | 4 ms | 3 ms |

Not run here: the two #1172 suites themselves, which need the Mac's app window.

Left open: the canvas core still checks every installed pack at every call (1.4 s a call here); the design says once
per version.
