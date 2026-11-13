# #1123 supervisor recovery: timeout startup and malformed scans

Commit `7e5f7555600e06d7aec183019733ecade0f0974d` addresses the retained runner failure, without changing its three-second timeout or any existing test bytes. It does not claim the whole issue is complete.

## Requirement → change → proof

| Safeguard needed by run-private binary builds | Change | Actual proof |
| --- | --- | --- |
| A caller timeout must exercise real build work, then stop the entire owned group | `proof-bin-build.mjs` reads one fresh PID/parent/state/start snapshot per ownership-check stage, instead of launching `ps` separately for each ancestor. No snapshot is cached across stages or polling ticks. | The unchanged `tests/proof-binaries-timeout.test.mjs` fails on the original supervisor at `real work starts before timeout`, then passes on the candidate under the same 250 ms delay on each real OS process scan. Frozen variants carry identical test SHA-256 `b831c2097c2126d75a6f9c256e692391a983ad2f141872c4b9ee0ecf8950e0ff`. |
| Missing process evidence never certifies cleanup | Both identity and group parsers reject malformed rows explicitly. A failed cleanup keeps its bay-barrier record. | The new two-case `tests/proof-binaries-malformed-scan.test.mjs` fails twice unchanged on the original supervisor: malformed identity is unnamed, and malformed group output incorrectly returns success. Both pass on the change. |
| Keep ownership and reuse guarantees | Worker remains IPC-gated; owner/ancestor identities are rechecked before launch and every poll; record is published before compiler start; cleanup still verifies the group before deleting the record. | The affected runner's report contains **10 passes / 0 failures / 0 skips** across seven files: timeout, real lease loss, supervisor loss, early leader exit, failed and malformed scans, unrelated-owner refusal, and real bay reclaim. |

The malformed-group regression was also run before its parser correction, after batching: **1 pass / 1 expected failure**. Its group case reached `REAL BUILD COMPLETED` and then failed because cleanup was incorrectly successful. Tests were made green unchanged. The older integrated 13/14 failure remains retained; this is new regression evidence after a substantive source correction, not a silent retry of that run.

## Reproduction and scope

Original supervisor: `9c13ca3a2`'s `scripts/proof-bin-build.mjs`. Two temporary trees copied the same scripts, CLI builds and test bytes; only the supervisor source differed. An executable `ps` shim at the front of PATH slept 0.25 seconds, then `exec /bin/ps "$@"`. It supplied no fake identity or liveness output. Both sides ran sequentially under one normal `test` grant. This is controlled OS-boundary failure reproduction, **not a budget or speedup claim**. An earlier loaded diagnostic failed at the same assertion; an unadmitted exclusive request was cancelled before running, avoiding an unnecessary machine-wide drain.

No production option, dependency, tolerance, timeout, check selection, skip, golden or failure baseline changed. Source-only review found no new actionable safety regression in batching and identified the malformed-group gap that the added regression now proves. That review is not test evidence. This change belongs to the existing binary-build supervisor, not the product core or an extension.

## Verification status

- `node scripts/affected.mjs scripts/proof-bin-build.mjs tests/proof-binaries-malformed-scan.test.mjs`: targeted tests completed **10/10**, but lint jobs are still pending admission at this report's snapshot; **overall result pending, not PASS**. Selection emitted no WIDE or INCONCLUSIVE-prefixed line. Final output must be reconciled before delivery.
- The first repo-rules job flagged four placeholder paths in this issue's historical report. They were changed from a nested home-shaped placeholder to `<bay-root>` without changing any result, timestamp, hash or assertion. A targeted rerun no longer flags those four entries; **24 unrelated repo-rules failures remain**. No allowlist was changed.
- Syntax checks and `git diff --check` passed.
- Native-window diagnostic compilation is separate work in the old scratch build workspace. The benchmark candidate and its failed GUI checks remain uncommitted and non-PASS. No new AC4 reading, signed approval or closing reference is supplied here.

Redacted raw output is retained in [supervisor-scan-recovery/](supervisor-scan-recovery/). Full local commands, snapshots and pending job logs are under `/tmp/deep-1123-resume/`; those paths are not portable proof. The sole PR remains #2321, Part of #1123.
