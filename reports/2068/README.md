# #2068 — partial implementation, verification BLOCKED

Part of #2068, **not ready to close**. No commit or PR was made. Base and merge base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. Work is on `fix/2068-forge-read` in a separate worktree; the original dirty worktree was not changed.

## Requirement → change → proof

| Requirement | Change | Observed proof / remaining gap |
|---|---|---|
| AC1: B's PostToolUse, 100 ms after A, is recorded before a forge's first 5 s answer | `core.ts` prepares issue data before joining the chain; `prompt-items.ts` holds per-hook data/reply/shutdown state. Task creation and origin checks remain on the chain. | Base: B observed at 26,716 ms after A, first forge answer at 6,205 ms. First fix: B at 530 ms, answer at 5,508 ms. **Both AC1 runs INCONCLUSIVE**: the forge request began after B arrived, violating the test's fixture precondition. Neither is the required before/after assertion proof. |
| AC2: one bounded read; prompt/task from your words; visible unread-issue warning | `ask-tasks.ts` gives credentials, HTTP bodies and all pages one 1,000 ms abort signal. `hub-shared.ts` passes it to `gh auth token`; `github-source.ts` passes it to fetch. Timeout discards partial readings. Core records a distinct deterministic `session.reading`; `rows.ts` shows it until a later person/app prompt. | Base prompt observed at 20,367 ms; prompt/task absent at the acknowledged hold and no warning. First fix bounded the wait but its warning ID collided with the prompt. After correcting the ID, the unchanged never-answering case passed (1 passed; 3 deliberately not selected). The endless-pagination case passed on the first fix. **Final extraction into `prompt-items.ts` was typechecked, not behavior-tested.** |
| AC3: instant source retains issue criteria and author roles | Preserve `readIssue`'s criteria/membership logic; consume prepared data only after origin checks. | Base instant twin passed. First fix's instant twin failed to lock its definition under extreme load. No isolated fixed run was available, so **unresolved**, not attributed conclusively to load. The reused #322 role tests were not run. |

This belongs in the core's existing hook/ask scheduling: an extension cannot release the core's queue while its existing `enrich` call awaits a forge. No new setting, dependency, flag, event schema or verdict is introduced. The one-second read budget is an implementation choice below the existing two-second prompt context hold; the issue states no exact read duration.

## Independent acceptance tests

A separate ephemeral drafting job saw only a base archive, the issue and design, with file-only tools and no session/diff inputs. It supplied `tests/acceptance/2068/`; `acceptance.sha256` pins its delivered files. The implementing session has not changed them. Their README documents the assumption that the read must fit inside the prompt's advertised `hold_until_ms`, an externally observable bound rather than an invented timeout setting. It also documents the unproven credential-delay path. The initial Claude drafting launch could not authenticate; the independent pi drafting job completed instead.

The draft reuses #322's existing role tests rather than duplicating them. It adds four cases (slow forge, never answering, endless pages, instant twin) with real hub, adapters, record and task machinery, and an HTTP fixture only at the forge boundary. No check/golden was weakened, skipped in source, deleted or re-recorded. Filtered runs below leave all unselected cases unrun.

## Checks actually run

- Base `npm run build --workspaces`: exit 0.
- Base `cargo build --locked -q -p deep-hook`: exit 0, using the installed 1.99.1 toolchain directory on PATH. An initial attempt had no cargo on PATH; its following acceptance setup was BLOCKED by the missing binary (`base-setup-blocked.txt`), not a regression failure.
- Unchanged new acceptance file on base: **3 failed / 1 passed** (`base-failure.txt`). AC2 failed on its expected wait/row assertions; AC1 reported INCONCLUSIVE as above.
- First implementation: **3 failed / 1 passed** (`first-fix-failure.txt`), with endless pages passing. AC2's warning failure was corrected, not its test.
- Corrected warning: `node node_modules/vitest/vitest.mjs run --config tests/acceptance/2068/vitest.config.ts tests/acceptance/2068/forge-wait.test.ts -t 'AC2: never'`: **1 passed / 3 not selected** (`row-fix-result.txt`).
- Final `node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json`: exit 0; acceptance `tsc -p tests/acceptance/2068/tsconfig.json`: exit 0.
- `git diff --check` and acceptance hashes: passed.
- Size ratchet: 34 existing findings in unchanged files (`size-result.txt`), none in this change's source. `core.ts` shrank 2641 → 2636 lines; its ceiling was lowered, never raised. This required extracting the new prompt-read state, shared by live and replayed hooks. The only check-data edit tightens that existing ceiling.

The patch plus independently authored acceptance harness is about 450 handwritten code/config lines (about 100 implementation lines and 350 acceptance lines). The real-process/socket fixture and three required scenarios plus whole-read pagination protection cannot sensibly be split from the bug proof; existing #322 role coverage is reused. No full preflight was run.

## Machine and affected verification

The reference Mac was at roughly **260–320 one-minute load on 18 cores**. These are causal observations on a loaded machine, not latency budgets or a speed claim. A single exclusive attempt through `node scripts/throttle.mjs timed --wait 2 -- …` received no grant (`timed-unrun.txt`). The paired isolated base/fix commands therefore **did not run**; no retry-until-green was attempted.

`node scripts/affected.mjs --list` selected approximately 1,000 test files plus a Rust crate for the source change. No **WIDE** line was emitted. Timed, slow and by-hand lanes remain unrun. To avoid a whole-core sweep on this overloaded machine, the attempted check was narrowed explicitly to:

```sh
node scripts/affected.mjs \
  tests/acceptance/2068/forge-wait.test.ts \
  tests/acceptance/322/github.test.ts \
  packages/hub/test/github-source.test.ts
```

It selected the new acceptance file, GitHub-source unit test, and #322 github/coverage files. It produced no WIDE line and no completed verdict: its test job and most lint jobs were still waiting for machine grants after about nine minutes. The runner and only its owned descendants were stopped (`affected-unrun.txt`): **INCONCLUSIVE affected: cancelled after waiting for shared machine grants; no completed verification result**. The full source-change selection was **not** run. Completed unrelated lint findings are not claimed green. Nothing is left running by this session.

## Resume / open work

1. Run the immutable AC1/AC3 checks on base and fixed trees under an available exclusive timed slot. The baseline needs AC1 to fail at its wait assertion, not its scheduling precondition. Preserve the currently inconclusive readings.
2. Diagnose the failed instant twin if it fails in that run; run the reused #322 role checks. A one-second deadline must not turn an immediately answering source into a words-only fallback on a normally available machine.
3. Run all four acceptance cases against the **final** extracted implementation, then `node scripts/affected.mjs` for the actual source changes. Review WIDE/INCONCLUSIVE and known-vs-new failures. Relevant unrun regressions include prompt replies before transcript placement, spool/remote replay, normal prompt origins and shutdown.
4. Review the deadline interpretation and the untested credential-delay/body-stall cases. The signal reaches the real token child and fetch, but that code review is not test evidence.
5. Review prefetch semantics: unknown-origin prompts may be fetched speculatively, but only person-origin prompts consume the reading; no agent-origin prompt can open an issue task through the prepared map. No same-session ordering beyond the existing network-stop exception was added.

`source.sha256` pins the final production/ceiling files. Logs in this folder redact fixture/worktree/home paths and contain no real forge token or live forge data.
