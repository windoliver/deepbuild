# #1687 — closure-gap progress (2026-11-11)

**Part of #1687; not yet proven closable.** This supersedes the post-merge
structural status in `issue-1687-merge-conflicts.md`, not the historical receipts.
The user requested actual gap closure, not another administrative PASS.

## Completed in this update

- Merged main `46bb7a35767f5bb5af26e161e9e3ef0e20ad4f68` and retained #1862's
  review rounds: previous-round inputs, counted-round recording, PR context and
  settled-item recording. `ReviewRounds` consumes the mandatory
  `ChecksProvider.reviewOutcomes`; the concrete function stays in the outer
  runtime. The public entry and behavior of Kinds remain unchanged. This is
  integration of upstream behavior, not a new core feature.
- Main advanced again to `db8d9ed7684d170c21d382f846b97a43b7c3e9c0` (#2021).
  Carried the running-call timestamp/quiet-window and `row.set@3` behavior into
  `SessionState` and its `Live` contract, avoiding another restored Core block.
  Three method bodies match upstream after capability substitutions; both
  shutdown methods are unchanged. Core and all frozen loader inputs are unchanged.
- Independently reviewed every changed loader input/guard/scope before updating
  its frozen provenance. Classified main's new `checks-host` and `routing-replay`
  as extensions from their documented responsibilities. No boundary, assertion,
  caller lock, unknown-loader rejection, base review or mutant was weakened.
  Detail: `tests/acceptance/1687/ac3-redraft/MERGE-PROVENANCE-REVIEW.md`.
- Refreshed five stale Core/MCP twin copies with current owner wiring. All **19
  original overlay-file fault deltas** match their earlier deltas exactly; fourteen
  overlays remain byte-identical. These are 19 files in 18 twin groups. No
  behavioral acceptance case, helper, manifest, fixture or expected value changed.
- Re-ran the four existing #1687 structural/oracle files through affected under
  a real test grant on the #1862 integration: **29/29 passed**. Its no-new-cycle
  and absolute extension boundary assertions pass; Core's largest method body
  remains **95 lines**. The final #2021 follow-up's graph rerun was not admitted;
  those earlier passes are not represented as a fresh run of that follow-up.

## Requirement → change → proof

| Criterion | Change | Actual proof / remaining work |
| --- | --- | --- |
| AC1: behavior and twins preserved | Carry #1862 into the owned services; exact fault refresh | 15 upstream method-body comparisons plus PR-context check pass after capability-path substitution; 19/19 fault-delta comparison passes. These are static only. Current builds, runtime twins, and broad base/candidate equality remain unrun. |
| AC2: owned seams and Core <=100 | Keep hook/wiring Core, ReviewRounds in its existing owner | Existing structural and independently qualified ownership checks pass; max body 95. |
| AC3: no new cycle or concrete-extension reach | Required inward review capability and independently reviewed provenance | Existing runtime/type graph checks and loader mutants pass in the 29-test run. |

The static parity and fault comparison ran again after the independent review;
all scanned product-source hashes matched that review then. The later #2021
merge changes session-state/types, hookmap, rows and upstream support, but none
of the frozen loader input/site/caller identities; its semantic source review
is not a new graph test pass. Neither establishes runtime equivalence, and
historical 17/19 kills are not relabelled current kills.

## Verification results and limits

The successful structural test block is recorded in
`deep-affected-7pgcUU/node.jsonl` (SHA-256
`d1b1a6359466f7f2ef694dc7b59808cf0a7d5aed0b038f940cfa76e27b2bfc24`);
every one of its 29 start rows has a pass row, with no fail or skip. The full
affected invocation is **not green**:

```text
FAIL affected: 168 new, 11 already failing on main,
0 inconclusive or blocked, 0 listed skips, 29 passed
```

Its failures are repository-wide lint findings (dependency inventory, vendor,
size, canvas, conformance and related checks); “new” is relative to the committed
known-failure table, not attribution to this PR. No fresh baseline run established
equality. The first invocation had no Cargo executable on PATH and ran no checks;
the corrected PATH invocation is the result above. No failure was edited away.

The latest source-path selection lists 428 parallel Vitest files, 17 Node files,
705 alone files, 79 timed files, 36 slow files and `deep-app`. That selection was
**not executed**. Neither the plan nor the focused execution emitted a WIDE or
INCONCLUSIVE line. Their absence is not proof that the unrun broad selection,
timing/live cases or inherited failures pass.

A fresh isolated base worktree was prepared at `46bb7a357` with independent
workspace links. The five-minute request to install the unchanged lock and build
each side's own TypeScript/native artifacts received no grant:

```text
INCONCLUSIVE no grant: no build grant came within 5 min
```

The install/build pair never ran. Existing node_modules predates two packages
added on main; it must be installed from the unchanged lock before a clean full
build. No stale dist/native artifact was passed off as a current build. Current
runtime, #822 refresh, moved-twin proofs and #21's 1,000-call replay remain unrun.
A guard attempt timed out before output; the later merged-scope attempt was
bounded after over three minutes without output, stopping only its own captured
child PIDs. No guard PASS or valid approval signature is claimed. The #2021
follow-up requested only the affected graph checks, with a one-minute bound,
and returned `INCONCLUSIVE no grant: no test grant came within 1 min`; no test
executed in that attempt. Its session runtime and a base comparison against
`db8d9ed76` are also unrun.

## The #18 protected blocker

The independent test-owner review established that the existing binding suite
is already its blind redraft. Its positive validator throws plain `Error` on the
expected leak, while the second test expects that leak. No existing unchanged
framework assertion rejects this exact overlay. The design and proof runner
correctly do not count the plain Error as an assertion kill.

[The exact one-line assertion-form proposal](issue-1687-binding-assertion-proposal.md)
is recorded but **not applied**. It retains the zero-problems predicate and all
scenarios/diagnostics. Previous ownership/loader/#822 approval does not cover it.
The authorized check owner needs approval for that specific change; no second
blind redraft, production special case or classifier exemption will substitute.
Required real signed approval of protected changes also remains a human action.

## Remaining before `Closes #1687`

1. Current clean builds and the same full affected results on base and candidate;
   account for every selected test, including timing/live work and genuine base
   failures. No blanket lint/size waiver or known-failure rewrite.
2. Current compiling clean/twin runs for all moved overlays, including #21 under
   its required timed grant. The exact fault plan is retained locally.
3. Separately approve the #18 assertion-form change and obtain its unchanged-runner
   formal kill; supply any real signed guard approval over the actual proposals.

All session-owned validation/reviewer jobs have ended; no foreign process was
stopped and the original dirty worktree was not touched. PR #2236 stays draft and
unmerged; the existing CLOSED/NOT_PLANNED tracker disposition is not changed into
completed verification.

Local receipts: `/tmp/deep-1687-close-{structural-with-cargo,build-grant,review-parity,retention-check}.log`
and numeric `.exit` files, `/tmp/deep-1687-close-boundary-{before,after}.json`,
`/tmp/deep-1687-close-twins-{result.md,plan.json}`,
`/tmp/deep-1687-close-affected-plan.log`, and
`/tmp/deep-1687-close-guard-interrupted.json`,
`/tmp/deep-1687-close-2021-affected.log`, and
`/tmp/deep-1687-close-2021-parity-corrected.log`.
