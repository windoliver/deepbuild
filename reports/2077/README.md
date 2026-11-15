# #2077 — removal lessons run configuration evals

Base regression: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.
PR base: `eb2822a36011e7534376e1345eb3d3dfb83bba4d` (main at integration).

## Requirement → change → proof

| Requirement | Change | Proof |
| --- | --- | --- |
| AC1 / `#2077.c76c4641`: installed hub submits one eval, freezes plan before either side | runner `eval` job, outer knowledge provider, plan evidence, asynchronous CLI handle | unchanged `tests/acceptance/2077/removal.test.ts`; `base-acceptance.txt` has the expected no-job failure; `acceptance-recovery.txt` has all three cases passing |
| AC2 / `#2077.d2415960`: only recorded adopt removes and decision cites eval; regression preserves bytes and names tasks | content-hashed report, exact-file apply and durable intent/recovery | same acceptance; crash/diff/symlink/fenced/cancel/provenance regression files |
| AC3 / `#2077.c43a0799`: INCONCLUSIVE preserves bytes and lesson | no application without adopt, explanation on job | unchanged INCONCLUSIVE acceptance case, judge supplies no grades |
| Existing #344 seam | same `DEEP_HUB_TEST_EVAL` branch, no new product test setting | unchanged `tests/acceptance/344/lessons.test.ts`, four cases passed |
| Reserve, API budgets, process ownership and isolation | runner gates every replay/probe/judge; supervisor owns and cleans processes; live readings update windows | new eval runner tests; fake external CLIs with real sandbox, record, ledger and supervisor; see `runner-real-processes.txt`, `runner-isolation.txt`, `runner-cleanup.txt` |
| No crash-time or attachment-based authority | durable intent before atomic replacement; only deepbuild-origin intents linked to recorded evals; cancellation/held dispositions | `removal-crash.test.ts`, `removal-cancel.test.ts`, `removal-provenance.test.ts`; saved failing-before output |

The independent acceptance suite was drafted against the issue, design and base before implementation. It is unchanged. Its original prerequisite-only logs remain unchanged but are **not** the fails-before proof: `base-acceptance.txt` is. Every requested outcome was observed with real hub/CLI/record/eval logic; only external agents and the judge were scripted. No paid/live model evaluation was run.

## Architecture and size

The replay/plan logic stays in `@deepbuild/config-eval`. The outer composition root injects it into the knowledge port; the kernel imports no concrete eval extension. The runner addition is required because no existing job kind can own a multi-process paired replay and judge under the account's reserve/budget while returning one job handle. Its functions are trusted callbacks, never RPC input. Existing read-only jobs are not widened into writing agents.

This issue exceeds the roughly 400-line guide because it adds the missing end-to-end caller plus necessary supervised model execution, crash-safe application and independent proof. The paired-eval algorithm and comparison were reused, not copied. Splitting off the safety gates would leave a removal path able to act before cleanup or without durable decision provenance; the regression tests directly cover those risks.

## Planning and held-out evidence

This caller applies a fixed, non-model removal transformation. It takes the newest 20 replayable tasks of the same git repository (excluding prompts that disclose eval/judge wording), three repeats, and up to four older tasks as separate readings. The cutoff is frozen at the start of the deciding cohort. Before any side runs, an inactivity lesson must also have been justified by **the 60 days before that cutoff**, read with the later events excluded. If a scoped rule was still used then, the eval is INCONCLUSIVE and keeps it, rather than using the scoring cohort to select its own change. A guard-backed lesson is selected by its planted guard check, not replay history. `removal-cutoff.test.ts` failed before (incorrect removal) and is the regression proof for this separation.

## Verification

- Workspace TypeScript build and this checkout's `deep-hook` build: PASS on the PR base.
- Original base: three expected #2077 no-job failures; non-task lint findings recorded separately.
- Implemented base: acceptance 3/3, #344 4/4, crash 3/3, safety and real-process tests passing as named in this folder's logs.
- Existing `runner.test.ts` default-undo test fails unchanged on the base runner too (`base-undo-failure.txt`). It was not altered or waived.
- The old base's targeted affected runs reported 172 repository-wide lint findings plus 11 catalogued known findings; those findings matched before and after. This is not an all-green repository claim.
- Current-main scoped affected run: **62 checks passed** (50 in the parallel behavioral block, 4 unchanged #344 cases, 8 architecture checks). All three #2077 acceptance cases passed after integration on main. See `current-main-tests.txt`, `current-main-344.txt`, `current-main-architecture.txt` and `current-main-build.txt`.
- After the final held-out-history correction, all 9 affected cases passed again (three independent acceptance cases, three crash cases, provenance, cancellation and cutoff). See `final-acceptance.txt` and `final-affected.txt`.
- `affected.mjs` overall: **FAIL**, 152 unlisted repository-wide lint findings, 42 already-known findings, 62 passed in the integrated run (9 passed in the final affected rerun); no WIDE or INCONCLUSIVE lines in these explicit-test runs. Findings name unrelated existing fixtures, dependency inventory, vendor marks, canvas code and size ceilings; none names an added #2077 file. `current-main-affected.txt` preserves the result. Current-main lint findings were not rerun on a second baseline checkout, so they are not presented as an independently proven complete baseline set.
- Full neighboring suites, timed/live/manual checks, proof-lane mutation/trace and a release preflight were not run. This is scoped behavior proof, not an all-green repository/release claim.

Test-fixture corrections approved by the user's request to close verification gaps: identify newly recorded subprocess run IDs instead of nonexistent argv in `process.starting`; pass the required timestamp to fixture IDs; inject a real cleanup storage failure instead of a tolerated `ps` failure. None changes expected product behavior. The crash harness's WAL snapshot fix changes implementation, not test assertions, and is required to exercise crashes on a pre-existing hub record.

All evidence here is redacted. No acceptance test or existing product check was edited. The documented newly-written test setup corrections retained their behavior assertions. No known-failure waiver was added, and no CI on push or PR was added.
