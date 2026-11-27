# Dispute under #3549: `stall.test.mjs` and `far-stalled.test.mjs` (#3334's second and fourth criteria)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). These tests fill the build class with the
old number, written into `helpers.mjs` as `SLOTS`, which `stillLine` holds, so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#3334.ed504fe3: a request whose line stalls exits 3, as a timed-out wait does; request: exit 0
#3334.f5046205: the near end prints "INCONCLUSIVE unit on <host>"; exit 3
```

Both criteria still hold under #3549, read with every build slot held and each holder named. `stall.test.mjs` also holds #3334.6c8b5837, which passes on the change; the swap is by file, so it is carried into the redraft as it is, with the original's own count.

The blind redraft that runs in these files' place is `tests/acceptance/3334-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `3334-redraft-3549/stall.test.mjs`: on the change 2 pass, 0 fail; on main without it 2 pass, 0 fail.
- `3334-redraft-3549/far-stalled.test.mjs`: on the change 1 pass, 0 fail; on main without it 1 pass, 0 fail.

The original files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
