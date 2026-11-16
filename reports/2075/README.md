# #2075 — closure proof

Merge base: `a50d923232d01de486bdaae9e7680e15e9c3f5b1` (current main when this branch was created).
This branch contains only #2075. The original dirty workspace, including other issues' hub changes, was preserved.

## Requirement → change → proof

| Requirement | Change | Evidence |
| --- | --- | --- |
| A fast check passes after the stop reply; the slow check starts without another prompt; the claim reaches a verdict | Always hand the claim to turn-end processing; retain the reading until fast checks finish | Frozen AC1 fails on the merge base: `.deepbuild/checks/slow.sh` has zero runs and the claim has no verdict. It passes unchanged on the candidate with the slow run followed by PASS. |
| The same fast check fails after the hold: no slow start, verdict FAIL | Read fast-check verdicts before placement | Frozen AC2 passes on base and candidate. A real zero-test run additionally proves that late INVALID starts none. |
| A new prompt before fast completion starts no old-snapshot slow check | Cancel deferred readings on a prompt, and revalidate after asynchronous queue-time reads | Frozen AC3 passes with the ordering asserted. Added regression detects a prompt during placement, and verifies resumption at the next stop without duplicate runs. |
| Existing loop/background rules still hold | Reuse placement; grace stays anchored at reply, background cap at stop; observe background/session endings | Deadline, background-ending and session-ending regressions pass. Existing cron/loop/background tests pass. A deadline-reset mutant was rejected during the initial proof. |
| Reply can precede snapshot setup, and spec checks continue while a definition drafts | Retain an early reading; readiness excludes the synthetic definition placeholder and is cleared before joining checks | Added pre-snapshot and pending-definition cases pass. The pre-snapshot case fails on base; the definition case exposed a regression in the first candidate, fixed without changing its test. |

The approved blind acceptance draft is unchanged. The user approved replacing the original draft after its AC3
was found to send the prompt only after waiting for fast completion. The replacement asserts that the fast run
has not ended when the prompt arrives. Its original base proof remains in `tests/acceptance/2075/`; current-base
proof is under `evidence/`. No acceptance criterion or assertion was weakened for the implementation.

## Verification

All selected behavior checks relevant to #2075 pass. Across the final corrected candidate runs: **88 unique
passing tests**, including 3 frozen acceptance cases, 9 late-fast scope cases, queue/stale/shared/pinned/snapshot
regressions, 7 real-stop cases and 5 cron/loop cases. One broader #322 planted-test case fails on both base and
candidate; its failure is not called a pass (see below).

Commands, with explicit file selection through `node scripts/affected.mjs`:

- Base: `tests/acceptance/2075/slow-checks.test.ts packages/hub/test/late-fast-lane.test.ts`.
  AC1 fails for the named missing slow run; negative controls pass. `evidence/base-tests.txt`, `base-affected.txt`.
- Candidate: those two files plus `packages/hub/test/{gate-runner,gate-queue,background-hold,codex-files,gate-stop,shared-runs,snapshot-sibling}.test.ts`,
  `tests/acceptance/965/{cron,loops}.test.ts`, and `tests/acceptance/322/early-claim.test.ts`.
  The selector additionally includes #322's coverage test. First run: 71 pass; real-hook tests are BLOCKED because
  the copied hook executable was placed in a nested target directory. This is setup failure, not behavior proof.
- After placing that built executable at `target/debug/deep-hook`, only blocked files were rerun: #2075,
  `gate-stop`, #965 cron/loops, #322 early-claim (and its selected coverage test). **17 pass**, one #322 plant fails.
  `evidence/candidate-hooks-tests.txt`, `candidate-loops-tests.txt`, `candidate-hooks-affected.txt`.
- Read-review regressions first failed on the initial candidate (pending-definition starvation and prompt during
  placement), then passed unchanged. `evidence/review-red-tests.txt`, `scope-green-tests.txt`.
- Build: workspace TypeScript/native builds and `cargo build --locked -p deep-hook`. A copied dependency install
  initially missed the new workspace-only `@deepbuild/briefs` link; that link was repaired, and only briefs/CLI/hub
  rebuilt. The corrected candidate hub build and acceptance/scope strict TypeScript checks passed.
- `git diff --check` passes. `digests.json` pins the tested source and immutable acceptance bytes.

## Remaining repository checks (not hidden)

`affected.mjs` is **FAIL**, not PASS. Final hook run: **153 new-to-baseline findings, 45 known**, 17 passing tests,
zero blocked/inconclusive results. Current-base runs already have the repository-wide lint findings (dependency,
canvas, vendor, cards, slots/mappings, record-reader and aged baseline findings); none names this task's changed
code/test files. No lint rule, ceiling, baseline or existing test was changed.

The #322 `spec-only-judges-early-claim` planted test also fails on unchanged main. Candidate: the planted scenario
unexpectedly passes. Base: it fails outside the expected PASS assertion because its ask was cancelled. The real
pending-definition scenario and coverage test pass on both. The differing planted failure is disclosed, not
claimed identical or fixed. See `candidate-early-claim-tests.txt` and `base-early-claim-tests.txt`.

The exact-file runs emit no WIDE or INCONCLUSIVE lines. The **unrun source-wide selection** in
`evidence/source-selection.txt` names 367 parallel Vitest, 14 Node, 649 alone Vitest, 67 timed and 30 slow files,
plus `deep-app` and 73 by-hand skips. Its WIDE line names:

- `tests/acceptance/1906/exit/children-at-exit.test.ts`
- `tests/acceptance/1906/exit/sync-children-at-exit.test.ts`

That larger selection and full release preflight were not run. There is no full-repository or release PASS claim.
The hook reproduction uses a 3 s reply hold with a 9 s fast check, not a real agent or exactly 60 s; the scope test
also exercises expiry of the runner's own hold. Owned-process cleanup warnings are retained in output.

Production changes plus active tests total about 400 handwritten lines; generated run output is kept separately
as evidence. The change belongs in the existing gate orchestration, which an extension cannot repair externally.
No new public API, setting, dependency or test-specific production exception was added.
