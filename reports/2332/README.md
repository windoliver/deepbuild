# #2332: hub startup

The measurements below are historical, from main `9f93f1e7bbd7974eeda9f2e98c47851e07ad9bff`, not closure proof for the current candidate. The branch `perf/2332-hub-startup` is now committed and rebased onto main `d8c46f0d58162ff0a4a483544149316aec960637`. The original checkout's unrelated edits were not changed. See [closure.md](closure.md) for the remaining gates and latest corrections.

## Requirement → change → proof

| Requirement | Change | Check/result |
| --- | --- | --- |
| At least 25% fewer own-process instructions, start to core-ready, 20 alternated rounds | Separate adapter facts from payload parsing; light contracts runtime entry; load check implementations, config eval, wiki builder and YAML only for their actual uses; generate record event/version metadata at build | Independent `tests/acceptance/2332/measure.mjs`; baseline failure saved before implementation; final candidate's paired median −26.056%, PASS by its seeded sign-flip rule (pBelow 0.002300). See `measurements.json`. |
| First SessionStart, prompt and PreToolUse no more instructions than main | No recovery or archive pass moved past ready; convert secret rules and event/version metadata at build, not on the first hook | Same 20 pairs. Test verdicts PASS; paired medians −0.774%, +0.297%, +0.512%. These are **not all literal reductions**: the blind test passes when a rise is not statistically established at p < 0.01. Strict non-increase remains unproven. |
| Idle memory no greater | Avoid unused module graphs and empty archive FTS index | `benchmarks/hub.mjs idle`, five alternating samples after warm-up: median main 118,505,472 B, candidate 108,380,160 B. The blind check says PASS; the environment fingerprint had thermal state `fair`, so the design's reference-condition memory verdict is **INCONCLUSIVE**. |
| Start-to-ready budget, first reading from main | New `hub-start-to-ready` task, real ready-line benchmark, live-PID mode of the perf lane's existing counter | Main first reading 5,004,036,860 instructions. Budget command executed successfully; existing budget definitions unchanged. Missing counters remain null/INCONCLUSIVE. |
| Explain startup/archive boundary | `packages/hub/README.md` | Diff reviewed: record/asks/leases/supervisor/recovery/spool/installed extensions remain before ready. Archive still runs at startup; shared adapter registry and no empty trigram index remove redundant work. |

## Regression checks

- `node scripts/affected.mjs` selected the relevant source graph. A full run was stopped after identifying the new synchronous-module/source-loader failure; its failures and unfinished checks were retained, not marked passed. Splitting adapter facts fixed that failure without changing tests.
- Focused affected runs: **161 tests passed** in contracts, evidence, all 221 gitleaks content-rule fixtures, record, archive-index and PR command parsing; **22 tests passed** in parser recovery, sibling notices and wiki integration after the loader correction. The final generated-version record checks passed **90 tests**, including the all-event-kinds append test. The first-use check-kind test passed on the real hub and caught its planted missing-route twin.
- The hub's production TypeScript build passes. Root `tsc --noEmit` fails with exactly the same pre-existing diagnostics as the base; no tests were weakened or edited.
- Focused affected's overall result is **FAIL**, not PASS: `168 new, 42 already failing on main, 0 inconclusive or blocked, 0 listed skips, 161 passed`. Its new lines are lint findings, not those tests. The corrected loader run reads `167 new, 42 already failing on main, 22 passed`; the first-use run reads `167 new, 45 already failing on main, 1 passed`. Direct comparisons establish identical repo-rules (51 findings), conformance-lint and size-ratchet output on base and candidate; other lint failures have not all been independently compared. The record test block passed, but its queued lint jobs were stopped and remain INCONCLUSIVE.
- Source selection printed no WIDE line. Timed/slow checks from the full selection were not run. The interrupted full report is INCONCLUSIVE; pi integration was BLOCKED on its required real pi 1.4.0 binary, and a command regression check lacked pnpm. Other unrelated failures from that interrupted run remain unresolved.
- The generated scrub rules were compared to main: all 221 expressions, flags, keywords, capture groups and multiline markers match exactly. The generated versions equal all 192 published event kinds. No generated metadata bypasses schema validation.

## Method and limitations

The independent test author saw only the issue, design and base. Its four files were copied unchanged; hashes are in `acceptance.sha256`. It uses the same macOS `proc_pid_rusage` instruction counter as the perf lane, read on the hub PID at the real ready line, children excluded. First-hook windows include 300 ms after each reply; idle uses five rounds. These assumptions are recorded in its README.

Machine: Mac17,10 / M5 Max / 64 GiB, Node 24.22.2, macOS build 26B8119, mains, Low Power Mode off. The host was heavily loaded; wall times are readings only. Thermal state was fair, not nominal. A first full comparison caught +13.53% prompt instructions; moving pattern conversion to the build fixed that. A later comparison caught +2.45% first-PreToolUse instructions; generating version metadata at build removed the deferred scan. The final unchanged test passed all its comparisons. Exploratory runs and failures are retained outside the worktree under `../evidence/`.

The final measured tree includes the memoized check-kind factory in the composition provider and both build-time generators. Its production hub and record TypeScript builds pass. No claim is made that unrun checks pass. The already-passing first-use test was inadvertently run a second time when its queued affected job finished just before the direct invocation; both results are kept, and the rerun adds no proof.

The diff exceeds the approximately 400-line guideline, chiefly because the original 375-line acceptance kit and two later blind closure drafts must remain unchanged. Runtime edits and build-time conversion serve the same startup/first-hook/memory criteria; splitting them would lose the paired comparison. The invalid closure draft is retained as dispute evidence, not passing proof.

**Delivery status: BLOCKED for closure.** The earlier performance check passed its measured candidate, but strict first-hook non-increase, nominal-thermal memory and completed verification of the current-main candidate remain open. The branch is suitable only for a draft `Part of #2332` PR until those checks finish.
