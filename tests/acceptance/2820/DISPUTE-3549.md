# Dispute under #3549: `failures.test.mjs` (#2820's AC5b)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). This test fills the build class with the
old number, written into `helpers.mjs` as `BUILD_SLOTS`, so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#2820.AC5b: no "INCONCLUSIVE no grant" line; exit 0
```

The criterion still holds under #3549, read with a neighbour for each build slot. The file's AC5a passes on the change; the swap is by file, so it is carried into the redraft as it is.

The blind redraft that runs in this file's place is `tests/acceptance/2820-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `2820-redraft-3549/failures.test.mjs`: on the change 2 pass, 0 fail; on main without it 2 pass, 0 fail.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
