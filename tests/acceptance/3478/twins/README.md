# Twins for the 3478 tests

Each twin is a whole `scripts/affected.mjs` with exactly one rule broken, and nothing else changed: same lines, same
exit statuses, same variables. A twin replaces that one file of the product, never a file under `tests/`.

No implementation existed when these tests were drafted, and the first twins were the blind job's throwaway with a
fault planted (`../BASE-FAILURE.txt`, the planted runs). The two files here are a blind redraft of 2026-11-24 against
the implementation: its `scripts/affected.mjs` with the one line below changed, and nothing else. Each was laid over a
copy of the change's `scripts/` and failed its criterion's test at its assertion.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3478.ee81cf50` | `fixed-build-wait` | `scripts/affected.mjs` | With `DEEP_TEST_GRANT_WAIT` unset, the run asks for its binaries' build grant with a fixed wait of 0.05 min (`acquire('build', bound.stall === undefined ? bound : { wait: 0.05 })` for `acquire('build', bound)`), whatever `DEEP_TEST_GRANT_STALL` says, and reads no grant as the merged one does (`INCONCLUSIVE no grant`, each file `INCONCLUSIVE`, exit 2). Its test grant is asked as merged (`--stall`) | `moving-build.test.mjs`: behind at least 7.5 s of hand-overs the run leaves the line after 3 s; its output holds `INCONCLUSIVE no grant` (exit 2), not its test's pass |
| `#3478.b300c126` | `fixed-build-wait` | `scripts/affected.mjs` | The same twin | `drain.test.mjs`: the build slots are held 8 s after the run joined, so the run leaves the line after 3 s; its output holds `INCONCLUSIVE no grant` (exit 2) |
| `#3478.a5864770` | `fixed-test-wait` | `scripts/affected.mjs` | With `DEEP_TEST_GRANT_WAIT` unset, the run asks `throttle.mjs test --wait 0.05` for its test grant, whatever `DEEP_TEST_GRANT_STALL` says (`Object.entries(grantWait())` reads `{ wait: 0.05 }` in `queued`). Its build grant is asked as merged | `moving-test.test.mjs`: behind at least 7.5 s of hand-overs the throttle prints `INCONCLUSIVE no grant: no test grant came within 0.05 min` after 3 s and the run exits 2 |

`#3478.caea9543` and `#3478.981101c5` have no twin: each fails on the merge base at its assertion (the base's grants
carry `wait: 30`; the base run is still waiting at the test's 5-minute bound). Both twins happen to fail
`#3478.caea9543` too (the request they break carries `wait: 0.05`), which the before lane doesn't need.

`#3478.ee81cf50`, `#3478.a5864770` and `#3478.b300c126` pass on the merge base, whose 30-minute wait outlasts every
line these tests make, as the issue expects: it names only the planted program as failing. Their twins are their only
proof of failing first.
