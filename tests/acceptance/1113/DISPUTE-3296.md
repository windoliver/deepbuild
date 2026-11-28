# Dispute under #3296/#3297: `measured.test.mjs` (#1113's preflight and perf under a held grant)

Since `efddeb94d` (#3296/#3297, 2026-11-23) a preflight in a git tree first runs a fill: the unit lane, under a build
grant, keeping each job's result by tree; then it lists every unit-lane test file and ends `INCONCLUSIVE preflight`
unless each has a kept result. Only then does it ask for `timed` and start its timer. This file's scratch repository
has no `node_modules` and a `cargo` stub that prints nothing, so its fill can list and keep nothing and the preflight
never reaches its checks. That is the product honouring invariant 2, so the tests can't pass on a right program. On
plain main `fc09a09cb` (Mac, the whole file, `--test-timeout 240000`):

```
#1113.74ef5038 (preflight): the preflight never ran its checks
#1113.74ef5038 (perf by hand): test timed out after 240000ms (its top-level timed waits for load below the cores)
#1113.dadec762: the preflight ended before the build holder outside its chain did: it never waited for timed
```

Both criteria still hold under #3296/#3297, read with a fixture whose fill finds and keeps everything.

The blind redraft that runs in this file's place is `tests/acceptance/1113-redraft-3296/`: the same three tests, IDs
and assertions over a filled scratch repository, with the preflight's holders started once its fill has ended (a 3 s
holder started before a 10–50 s fill would end before `timed` is asked). Its runs are in its `REDRAFT.md`.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
