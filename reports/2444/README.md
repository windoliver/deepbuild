# #2444 — Part of, not Closes

## Requirement → change → proof

| Requirement | Change | Proof |
| --- | --- | --- |
| AC1 `#2444.3bfdfb07`: print each listed failing test as `LISTED`, with its issue; it must not fail the unit lane; an unlisted failure must still fail it | `scripts/lanes.mjs` reads `failures` alongside `skips`, matches exact failing IDs, prints the saved reason/issue and records `LISTED`, never `PASS`. Unknown states and abnormal runner exits remain unproven. | Blind `tests/acceptance/2444/preflight-known-failures.test.mjs`: two expected assertion failures on the base, then all five AC1 cases pass unchanged. `base-red.txt`, `focused.txt`. |
| The same rule must reach the unit lane's Vitest and Rust commands without concealing later failures | Reuse Cargo metadata/target identities in both `lanes.mjs` and `affected.mjs`; keep the latter's `crates` export. The unit Cargo command uses `--no-fail-fast`, so a listed failure cannot stop later targets. | `tests/listed-failures.test.mjs`: actual Vitest and Cargo fixtures fail before the fix and pass after; listed-only Rust exits 0, a later unlisted Rust target runs and fails. `regression-red.txt`, `focused.txt`. Existing Cargo identity/dependency tests also pass in `correction.txt`. |
| Regression protection: nothing missing or unrun becomes PASS | The Vitest result reader checks its existing end marker before allowing listed failures to explain a nonzero exit. A listed ID does not excuse BLOCKED/INVALID/INCONCLUSIVE or a killed runner. | The incomplete-report and same-ID/unrun-row checks each fail first, then pass unchanged: `incomplete-report-red.txt`, `correction.txt`, `unrun-row-red.txt`, `evidence-correction.txt`. Existing `tests/lane-reading.test.mjs`: all 17 cases pass in `focused.txt`. |
| AC2 `#2444.1bff92b0`: clean main's full preflight exits 0 on a reference Mac with every lane PASS and checks under the budget | **Open.** No scheduling, budget, known-failure entries or protected decisions changed. | **INCONCLUSIVE / unrun.** No full preflight, no measured budget proposal and no clean-main evidence. The blind AC2 test remains skipped with that explicit reason. |

## Provenance and checks

- Base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, also the merge base with the locally recorded `origin/main`.
- Acceptance author: an independent Claude job restricted to a base archive, the issue and the base design/rules. No command/network tools, implementing transcript or working tree. Its two files were copied unchanged; the implementer did not edit them.
- Acceptance SHA-256: test `c8ee9f3679b69abe870d55c15d06fd934c1febca98c39d4096d40cbba3a011b1`; README `2d5fe8c8fba6fe39e1c4719e904deff14b20305e265f6d7129138c2ec578eafc`.
- Before implementation: blind suite 4 passed / 2 failed / 1 unrun; four additional runner regression tests failed for the intended assertions. Outputs preserved, with local paths redacted.
- Focused verification: **27 passed, 0 failed, 1 unrun** (AC2), 134.5 s. After the report-completeness correction, only affected checks ran: **5 passed, 0 failed, 1 unrun** (Linux-only `prlimit`), 37.7 s. The evidence-row correction's affected checks: **4 passed, 0 failed**, 1.1 s. These are fixture/test timings, not a preflight budget measurement.
- `node --check scripts/lanes.mjs`, `node --check scripts/affected.mjs` and scoped `git diff --check`: passed.
- Required `node scripts/affected.mjs scripts/lanes.mjs scripts/affected.mjs tests/listed-failures.test.mjs tests/acceptance/2444/preflight-known-failures.test.mjs`: **BLOCKED/incomplete**, not PASS. It selected suites and prepared shards, then waited for a shared test grant; both test slots were held by other sessions. Only this task's runner PID was stopped, before its test/lint jobs started. See `affected-blocked.txt`. No `WIDE` line was emitted. No final `INCONCLUSIVE` summary was reached; the selection explicitly left **28 timed files and 9 slow files unrun**, including `tests/preflight.test.mjs`. The other selected suites/lints remain unverified too. No retries or full neighbouring suites were run to obtain a green result.
- The initial affected-selection attempt found no `cargo` on PATH; the installed pinned Rust toolchain's `bin` directory was added to PATH for subsequent commands. No toolchain or settings were changed.

## Full-run blocker and limitations

Observed **2026-11-15 18:13:31 UTC**: Mac17,10, Apple M5 Max, 18 cores, 64 GiB, macOS 27.2. This is reference hardware, but its load averages were **382.35 / 333.67 / 225.16**, far above its 18 cores. The working checkout was dirty, had substantial pre-existing edits and was behind the locally recorded main head `d8c46f0d58162ff0a4a483544149316aec960637`. None of that is clean-main proof. The 900,000 ms budget is unchanged.

To finish AC2, the changes need to land and a full `scripts/preflight` must run once on a quiet reference Mac at a clean, current main head, recording actual stdout/stderr, UTC date, hardware/power/thermal state, start/end load, commit, exit and elapsed time. Put output **outside the checkout** so recording it does not dirty main. Any over-budget run leaves AC2 open; a budget increase needs a separately approved measured proposal.

The blind suite's AC2 evidence reader is only a preliminary check: it does not independently establish current-main identity, reference hardware, or every lane's completion. Its canned output and self-test cannot close AC2. The suite's printed directory-form invocation is not accepted by this Node version; the recorded runs use the explicit `.test.mjs` path. The acceptance files were preserved rather than edited.

No commit, PR or approval tag was created. The pre-existing lane-list edits for #2078, #2084 and #2516 remain untouched. These runner changes still require the repository's normal protected-tooling review/approval before merge.
