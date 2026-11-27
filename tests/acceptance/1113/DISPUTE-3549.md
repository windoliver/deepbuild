# Dispute under #3549: `cli.test.mjs` (#1113's no-grant and forged-grant tests)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). This test fills the build class with the
old number, written into `helpers.mjs` as `LIMIT.build`, so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#1113.99a9da00: the late request's exit status was 0, not non-zero: its command ran under a build grant of its own
#1113.06c9ec7b: the copied DEEP_THROTTLE was trusted: its command started Infinity ms before any build holder ended
```

Both criteria still hold under #3549, read with the build class full. The file also holds #1113.060e7bae, which fills no class and passes; the swap is by file, so it is carried into the redraft as it is.

The blind redraft that runs in this file's place is `tests/acceptance/1113-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `1113-redraft-3549/cli.test.mjs`: on the change 3 pass, 0 fail; on main without it 3 pass, 0 fail.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
