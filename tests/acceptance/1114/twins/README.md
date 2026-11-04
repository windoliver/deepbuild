# Twins for the 1114 tests

Every test but AC5's already fails on the base at its assertion (`../BASE-FAILURE.txt`). AC5's can't: on the base,
"before" and "after" are the same scripts, so `timed-fail-inconclusive` is its only wrong program. The twins are the wrong programs the
design's Issue shaping asks each tooling test to show failing. Each is a copy of the base's script plus the blind
job's own small implementation of #1114, with one planted fault. It is laid over the change, so the change's other
scripts stay. The affected.mjs twins import `timed` from the change's `lanes.mjs`. The proof-runs.mjs twins read the
change's `timed` list.

| Criterion | Twin | Replaces | The planted fault |
|---|---|---|---|
| `#1114.9fc6be33` (AC1) | `runs-timed-anyway` | `scripts/affected.mjs` | It splits the timed files into their own block, but runs that block without `--timed` too |
| `#1114.9fc6be33` (AC1) | `unrun-passes` | `scripts/affected.mjs` | It skips the timed files without `--timed`, printing `SKIP`, but doesn't count them, so the summary stays PASS |
| `#1114.dc4376fb` (AC2) | `timed-as-test` | `scripts/affected.mjs` | With `--timed` it runs the timed block through `throttle.mjs test`, not `timed` |
| `#1114.f3e38214` (AC3) | `list-misses-one` | `scripts/lanes.mjs` | Its `timed` list holds the grep's files except `tests/acceptance/881/latency.test.ts` |
| `#1114.52a78dd9` (AC4) | `wraps-spawn` | `scripts/proof-runs.mjs` | The timed set's spawn is `throttle.mjs timed --wait 15 -- node --test ...` under the same 20-minute `TIMEOUT`, so the grant wait happens inside the spawn and counts against its timeout |
| `#1114.f626edec` (AC5) | `timed-fail-inconclusive` | `scripts/affected.mjs` | With `--timed` it runs the timed files under the timed grant, but reads their failures as INCONCLUSIVE ("a timed test, read under load"), so a FAIL main has drops out of the list |
| `#1114.52a78dd9` (AC4) | `one-spawn` | `scripts/proof-runs.mjs` | Every tagged file runs in one spawn, as before the split, and the timed files get no grant |

`list-misses-one` carries a frozen copy of the grep's list from the base (90 files). If the tree later gains files that
call a timing helper, the twin misses those too, and it still fails.
