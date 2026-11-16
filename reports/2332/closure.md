# #2332 closure progress

Pinned main: `031292bf15c0b9a32260413793f3b2d17e87115b`.
Measured candidate: `fdedb13fd7d24d48698e6f48a10147571fb31074`.
**Status: instruction criteria PASS; memory and full regression closeout remain BLOCKED.**

## Requirement → change → proof

| Requirement | Change | Completed proof |
| --- | --- | --- |
| At least 25% fewer own-process instructions to core-ready | Separate runtime contracts and adapter facts; first-use check fills/wiki/YAML; build-time schema-version and scrub-pattern conversion; avoid empty archive index creation | Frozen approved redraft, 20 alternated pairs: **−27.594%**, pBelow **0.00009999**, PASS. |
| First SessionStart no more instructions | Load only the requested shipped agent's facts in readers that need one agent; preserve validation at first use; no product Git discovery with an empty store and no spec | Same 20 pairs: **−4.873%**, pBelow **0.00009999**, PASS. |
| First prompt no more instructions | Same first-use boundary; no secret-pattern conversion deferred into prompts | Same 20 pairs: **−5.695%**, pBelow **0.00289971**, PASS. |
| First PreToolUse no more instructions | Same boundary; actual mapping/guard/record checks retained | Same 20 pairs: **−6.116%**, pBelow **0.00269973**, PASS. |
| Deferred work still counted | No recovery or archive pass shifted out of readiness | Quiescent total **−24.209%**, PASS. Every round and hook reached the frozen quiet bound; no round removed. |
| Idle RSS no greater, valid reference conditions | Smaller unused graph and no empty FTS index | **UNRUN on this candidate under valid conditions.** Historical lower RSS is not a pass. Memory-only proof is queued under the existing timed grant, waiting for AC/nominal thermal conditions before sampling. |
| Start-to-ready budget with first main reading | `hub-start-to-ready` in `benchmarks/budgets.json`; workload-local `benchmarks/read-instructions.c` reads the same kernel field as the perf counter | Frozen budget-task test PASS; command returns a positive hub-only counter at the core-ready line. Existing budgets are unchanged. |

Raw counts, verdicts and round settlement: [strict-instructions.json](strict-instructions.json). These are hardware instruction readings, not a wall-time claim. The design permits instruction comparisons under load; memory and timing still require reference conditions.

## Proof infrastructure and owner decision

The owner explicitly answered **yes** on 2026-11-15 to selecting `tests/acceptance/2332/closure-redraft/`. The first supplemental draft under `closure/` sends `matched: []` and incorrectly expects the hub to perform deep-hook's shell matching; it remains byte-for-byte as dispute evidence, not selected closure proof. The original loose comparison remains preserved too. The implementation never special-cases either test.

The proof guard initially refused edits to shared `scripts/benchmark.mjs` and `scripts/lanes.mjs`. Those edits have been removed entirely, along with the temporary extension to `scripts/count-children.c`. The branch was rebuilt as tests-first and implementation commits on the pinned base, preserving every acceptance file. **All shared scripts equal the pinned main**, and `node scripts/proof.mjs guard` passes ([guard.txt](guard.txt)). The live-PID reader now belongs solely to the new benchmark workload; the independent check has its own reader. The selected redraft runs through the unchanged throttle, without a new lane exemption.

## Regression results (not all green)

Both pinned-base and candidate workspace builds and `deep-hook` builds passed. Verification uses `node scripts/affected.mjs` with the focused files that cover each changed boundary; prior failing tests were not edited.

- Initial paired focused verification on `f98921218`: main 217 passed, candidate 219 passed, no candidate-only behavioral failures. The product-start Git discovery and startup-memory tests failed on main and passed on the candidate.
- Updated paired verification on `031292bf1`, before the final adapter optimization: main `182 new, 42 known, 216 passed`; candidate `186 new, 42 known, 216 passed`. Candidate-only failures are the evidence suite's time bounds and test timeout at loads over 200. These remain unresolved, not waived or marked PASS. Shared failures include review-check behavior and the record suite's timeout. Candidate-only lint differences are environment-kit `lsof`/process probes blocked under load; other lint findings reproduce on main.
- Adapter optimization: 88 tests passed, six failed; the same files on main passed 90 and failed four. Three schema/digest failures and one timeout occur on both. The candidate's two extra failures are 5 s property-test timeouts under higher load. This is **not a clean regression verdict**, despite the strict performance criterion passing.
- Selection printed **no WIDE line**. Whole-source selection reaches thousands of tests and Rust hosts; unrun neighbouring, timed and slow checks remain unrun. No full-preflight pass is claimed.
- No expectation, golden, schema, frozen budget, decision or known-failure entry was changed. Shared checks remain unmodified.

## Retained unsuccessful runs

The earlier exclusive acceptance request expired after 60 minutes without a timed grant, so it took no samples. The first strict instruction run of the prior implementation completed 20 pairs but returned INCONCLUSIVE for startup and all first hooks; those data are retained. Only after changing shipped-adapter loading was a new comparison run. That changed implementation passed all five instruction tests unchanged. No sample was discarded and no unchanged candidate was retried until green.

Machine during these attempts: Mac17,10, M5 Max, 64 GiB, Node 24.22.2, macOS 26B8119. Power alternated between battery and AC; thermal state remained fair in observations. Current memory work waits for the required conditions and never treats missing conditions as PASS. Other sessions' processes and throttle grants were not stopped.

## Remaining before `Closes #2332`

1. One valid memory comparison on the measured tree: mains, Low Power Mode off, thermal nominal, through the timed grant. No repeats or dropping failed samples.
2. Resolve or prove the remaining regression failures on a quiet host with unchanged tests; retain same-main comparison and all INCONCLUSIVE output.
3. If main changes relevant inputs again, integrate and recheck affected criteria. Current proof names the pinned base above, not every later main.

Until then the PR stays draft and says **Part of #2332**. The original checkout's unrelated work is untouched. Scope exceeds the one-page/approximately-400-line change guideline because all three blind test drafts must remain, alongside the same issue's runtime optimization and raw performance evidence.
