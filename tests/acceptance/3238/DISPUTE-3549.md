# Dispute under #3549: `serial.test.mjs` and `no-grant.test.mjs` (#3238's first and third criteria)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). These tests fill the build class with the
old number, written into `helpers.mjs` as `BUILD_SLOTS`, so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#3238.52168c75: the second command, `node stub.mjs build-two`, started while the first, `build-one`, still ran: two scripts/lease commands ran at once on a table with build at 1
#3238.4febe21a: its command `node stub.mjs cargo-build` started with no build grant
```

Both criteria still hold under #3549: the first read with every build slot but one held, as the original already holds it on Linux, and the third with every slot held. The second message's words are the original's; the command ran under a build grant of its own.

The blind redraft that runs in these files' place is `tests/acceptance/3238-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `3238-redraft-3549/serial.test.mjs`: on the change 1 pass, 0 fail; on main without it 1 pass, 0 fail.
- `3238-redraft-3549/no-grant.test.mjs`: on the change 1 pass, 0 fail; on main without it 1 pass, 0 fail.

The original files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
