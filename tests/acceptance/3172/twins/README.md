# Twins for the 3172 tests

AC1's four tests fail on the base at their assertions, and AC3's on the Spark (`../BASE-FAILURE.txt`), so they have no
twin. AC2's three can't fail on the base: there every target that exits non-zero with no test reported reads FAIL,
which is what AC2 keeps. These are the planted wrong programs that fail them. Each replaces the one file its path names,
`scripts/lanes.mjs`, and no test or helper. A copy goes stale as that file changes, and still holds its fault.
`../twins.json` names them by criterion.

| Criterion | Twin | Replaces | The planted fault | Fails |
|---|---|---|---|---|
| `#3172.531b8e24` (AC2) | `no-line-inconclusive` | `scripts/lanes.mjs` | The base's file, with the reading of a target that failed outside any test it reported turned from FAIL to INCONCLUSIVE: the over-wide fix AC2 rules out, where every non-zero target with no test reads INCONCLUSIVE, line or none | All three AC2 tests |
| `#3172.531b8e24` (AC2) | `any-name-line` | `scripts/lanes.mjs` | The base's file with AC1's reading added, but taking any `<name>: INCONCLUSIVE; <reason>` or `…: BLOCKED; …` line under a target as that target's own, whatever name the line gives | The test of a target printing another target's line |

`any-name-line` holds a whole AC1 reader, not just one changed line, because the fault is in how that reader matches a
line: with its name compared to the target's (the last word of the arguments that rerun it), it is the throwaway reader
that passes the whole suite (`../BASE-FAILURE.txt`, part 5). That reader is no part of this suite and isn't a guide for
the fix.

Both were run on the Mac, each in an APFS clone of the checkout (`cp -cR`) with the twin's file copied over
`scripts/lanes.mjs`, by `node --test tests/acceptance/3172/fail.test.mjs` (`../BASE-FAILURE.txt`, parts 3 and 4). Each
failure is a `node:assert` failure thrown in `fail.test.mjs`. Neither file has a fixed wait, so `scripts/wait-ceilings.json`
needs no entry for them.
