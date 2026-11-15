# #1123 remaining criterion-proof gap — read-only feasibility audit

**Not a pass. No tests, builds, measurement runs, jobs, GitHub writes, trust changes or signing were performed.**

Inspected worktree HEAD `ab6edbef6bfb288c01fbeb13090e7786c53795bc`, merge base `092754bb14a75cd07157e623e21b0d9e7a51677a`; live #1123 and sole PR #2321; AGENTS; parallel-proof design; technical-design trace, wrong-program and Dogfooding rules; acceptance sources; runner sources; retained migration/measurement evidence. Existing dirty benchmark work was left untouched.

## 1. Bottom line

1. **AC1 has an agent-addressable executable-proof route without editing existing acceptance tests.** A new blind-drafted integration test can discover the real migration from the runners' plans, execute the original moved files through the real parallel command against clean and compiled wrong sources, and assert their actual reports. It must reuse the original checks, not reimplement their assertions or merely inspect `proof.json`. Historical proof-before-removal still needs its retained provenance; a run now cannot retroactively establish that ordering.
2. **AC4 is not inherently untestable just because there is no speed threshold.** A live check can verify that both prescribed complete runs actually happened and yielded identified alone-block readings. Its wrong case is omitted/incomplete/misattributed execution or observation, not “too slow.” A real runner twin that omits the serial block is a meaningful negative control. A static report-presence test is not.
3. **But there is no currently demonstrated, faithful route to put that complete AC4 experiment through the existing `before`/`trace` entry.** Every selected Node/Vitest runner invocation there has a hard 20-minute cap. The retained before **parallel block alone took 2,974.39 s**, before the incomplete serial block. An outer test's larger timeout does not override this cap. Moreover, an AC4 test that succeeds on the base needs a registered outer twin; its own successful negative-control subrun is not automatically credited. Nesting a full pair in a tagged test would repeat the full workload on base/change/twin rather than consume the one required pair.
4. **An ordinary independent measurement job can collect machine-readable AC4 evidence using current runner surfaces after the demonstrated stall is resolved. That is distinct from closing the trace gap.** Trace has no interface to consume that job's complete, current-run evidence. Under the present constraints, retain `Part of #1123`. A precisely approved evidence-dependency/observation contract is the minimal design question if the full experiment cannot fit the unchanged test-run entry. Do not add an observation exemption, increase a limit, or accept a saved report on the agent's authority.

The earlier statement “observational evidence necessarily needs new tooling” is too broad for AC1. Conversely, “just add a tagged integration test” overlooks the actual AC4 entry timeout, repeated workload, and proof-credit rules.

## 2. What the actual entries accept

### Claim and selection

- `scripts/proof-change.mjs:94–123,153–190`: the claim comes from **commit messages**, not the PR body. `Closes` dominates `Part of` across the change's commits. `readIssue` hashes normalized live criterion text; it reads checked and unchecked criterion lines alike. Ticking a checkbox does not remove a trace obligation. `DEEP_PROOF_ISSUES` substitutes issue text, not proof evidence; do not use altered text to evade the live requirement.
- `scripts/proof.mjs:23–45,80–95`: `trace` automatically adds `before`. There is no trace-only “read these reports” mode. Each criterion needs a reported, passing, non-skipped tagged test in the returned `proven` set. `PASS trace: Part of ...; open: ...` is explicitly not proof of the open criteria.
- `scripts/proof-runs.mjs:487–540`: selects test files by the issue's tags, overlays the change's test paths onto the merge base, then runs both sides. Runtime test **names** supply the credited tags. README tables and report filenames do not.

### Wrong-program accounting

- `proof-runs.mjs:306–338,612–670`: the same reported test key must fail at an assertion on the base, a registered twin, or a credited mutant, then pass on the change. Missing imports, failed installation/build, uncollected work and timeouts are not wrong-program proof.
- `proof-runs.mjs:468–479,566–608`: registry is `tests/acceptance/<issue>/twins.json`, mapping criterion IDs to names. Each `twins/<name>/` supplies repository-relative replacement files. The runner overlays **files**, not executable patch recipes. A twin cannot replace acceptance/test paths or `node_modules`; it may replace production runner/source files. It is built and run, not accepted by declaration.
- An outer test which expects an inner wrong program to fail normally **passes** on that inner result. That does not itself put the outer test in `proven`. It also needs an outer base/twin failure. This matters for both AC1's nested migration experiment and AC3's existing embedded plant.
- `proof-runs.mjs:749–897`: automatic mutation targets added package TypeScript/Rust source, not `scripts/*.mjs`. Cargo-mutants results lack per-test attribution and explicitly prove no criterion here. `--release` is not a shortcut around missing runner twins.

### Time and evidence

- `proof-runs.mjs:336–338,351–385`: 20 minutes per outer Node/Vitest invocation; a timeout makes its files unrun. Vitest is explicitly invoked with `--no-file-parallelism`. Therefore directly tagging the eight migrated Vitest files would both edit existing acceptance tests and fail to exercise their parallel route.
- `scripts/lanes.mjs:476–494,911–1023`: exported `checks` and `runLanes` are the existing runner entry used by the independent #1123 suite. The unit definition runs parallel Vitest, serial Vitest, workspace Cargo tests, then Node tests. There is no unit-selection CLI in `scripts/checks.mjs`; a small driver calls `runLanes(checks.filter(...))`.
- `lanes.mjs:944–1000`: its elapsed value is whole-lane time including preparation/waits, not alone-block time. Per-command logs/reports are temporary and removed; output is buffered. `writeRecord` retains lane/tree/platform/test states, **not** per-command start/end/duration or a paired before/after recipe.
- `scripts/proof-vitest-reporter.mjs` supplies actual result rows and a final `end`, but no file execution intervals. Vitest's JSON reporter supplies per-file start/end intervals. Use those for overlap; an `overlapped: true` field is not an independently recomputable interval.

These are source-derived findings, not results of running trace in this audit.

## 3. Requirement → existing evidence → remaining proof

| Requirement | Existing evidence inspected | Remaining work / constraint |
| --- | --- | --- |
| AC1 `#1123.4ed9aa75` | Two folders, eight original files; retained red/green results in `reports/1123/migration-{374,375}/proof.json`; independent helpers adopted before scheduling, per retained history | New executable tagged integration proof; retain ordering/build/input provenance, not just summary booleans. No requirement to migrate exactly 29 folders. |
| AC2 `#1123.07de86fd` | Independent `binaries.test.mjs` drives real `proof.mjs before`, asserts distinct source-built sides and the wrong-base assertion failure | Reuse unchanged. Audit did not rerun it or certify a current preflight. |
| AC3 `#1123.cd6b3dd8` | Independent shell/explicit-value/lanes/affected checks; embedded delete-after-merge plant | Behavior evidence exists, but there is an additional automatic-before bookkeeping problem described below. |
| AC4 `#1123.273f1f14` | Same-workload recipe and partial real Mac run; no completed before-alone endpoint and no after run | Complete pair still absent. Collection is agent work when prerequisites permit; existing trace ingestion/time constraints remain separately unresolved. |
| Landing/regression safeguards | Protected-runner edits; retained non-PASS affected/guard results | Human presence-backed approval; explain/fix applicable new regressions without changing baselines. These are not invented speed criteria. |

The local raw `original374-wrong.json` and `original375-wrong.json` still exist under `/tmp/deep-1123-final/`. Read-only inspection found intervals for all eight original files. #374's three intervals overlap; #375's long `never` interval overlaps its other four originals. The checked-in summaries omit these numeric intervals. Preserving redacted raw intervals and build/recipe binding in durable evidence is agent-addressable, not a reason to rerun the full suite. No check was re-executed to inspect these files.

### Additional AC3 trace blocker, despite adequate behavioral proof

`environment.test.mjs:24–28` is a **new tagged** explicit-value test which passes on the actual merge base as well as the change. The base `childEnv` merges `extra` and does not delete `DEEP_BIN_DIR`. The separate embedded plant at lines 30–48 is untagged and succeeds by observing its child fail. There is no `tests/acceptance/1123/twins.json` today.

Consequently `before` can report “passed on the merge base” for that new tagged test, even if other tests qualify AC3 for trace. The README already discloses this limitation. **Do not remove its tag or edit it.** The compatible remedy is an independently prepared additive `twins.json` entry for AC3 and a runnable `twins/delete-after-merge/scripts/proof-runs.mjs` overlay. The unchanged explicit-value test then fails against that outer twin. The independent author must make the minimal wrong program and retain its actual red result; an implementing agent must not fabricate the replacement or self-approve it. This is additive proof work using an existing interface, not an AC3 requirement change.

## 4. Minimal independent test plan for AC1

This is a feasibility specification, **not an acceptance draft to copy from this audit**. This auditor has seen the work and cannot be the blind drafting job.

### Blind inputs

Give a fresh job only the frozen live #1123 text (including the existing one-PR/Mac decisions), AGENTS and the relevant designs, and an isolated archive of the pre-work base. No working transcript, implementation diff, this findings file, implementation worktree, or branch objects. Ask for a **new complementary** `.test.mjs` under `tests/acceptance/1123/`, not an edit/redraft of the existing mechanism tests. Let it derive expected behavior and wrong programs from the issue/design/base. If original moved suites' requirements are needed, obtain their issue text as definition inputs, not an implementing agent's rewritten expectations. Candidate selection must remain a runtime fact, not a hardcoded assertion that exactly #374/#375 must move.

### Required experiment

1. Read actual pre-change and checked-tree unit plans through the exported runner entry. Derive the removed-alone set and enumerate its files with real Vitest selection using the actual parallel command/config. Require an actual migration (an empty set cannot satisfy the test vacuously), not exactly 29 folders. Assert actual inclusion in parallel and absence from the serial selection; preserve protected timed/shared-resource placement. A source regex or an unchanged “parallel enabled” flag is insufficient.
2. Reuse the original moved `.test.ts` files and their independently adopted helpers unchanged. At runtime, execute only these moved files by adding their positional selectors to the **real parallel command**, retaining its exclusions/configuration. Run that command through `runLanes` in disposable clean/wrong source copies. This is a focused correctness proof, not the full AC4 workload. It must not supply a handcrafted command that would select the files even if the real plan excluded them.
3. Build clean binaries and the test-owned wrong source variants from their respective copies. Use the runner's real binary mechanism, never a shell-supplied foreign executable or a stub returning desired report text. For the present eight files, the retained independent recipes demonstrate feasibility: #374 parent-span/stroke-scale/rank; #375 padding/row/grid/widest plus the Cargo binary-owner variant. `scope.test.ts` reads real Cargo metadata, so a wrong executable alone cannot refute all five #375 files.
4. Require every original moved file to execute; clean checks must pass. On the wrong program, require each file's relevant behavior assertion, not merely nonzero exit, compilation failure, hook timeout or “some test failed.” For #375's fast-check property, retain/inspect the wrapped assertion cause, not just “Property failed.” Add observation-only reporters to the real command: Vitest JSON for per-file intervals, and a test-owned reporter if necessary to retain the actual error/cause objects that `runLanes`' temporary proof report otherwise discards. Do not mock the runner or change result interpretation. Establish real overlap. Missing intervals or setup-only failures leave the experiment unproven.
5. Establish an **outer** wrong-program failure: the runnable pre-migration/no-move plan must fail the test's migration assertion; if that base is not the relevant negative control, use a registered runner twin that retains a claimed moved folder in `alone` or excludes it from parallel. Verify that the same outer tagged test fails at the intended assertion. Do not infer outer proof credit from step 4's expected inner failures.
6. Keep the original before-removal records bound to their source/build/test/plan and adoption/scheduling history. New live results prove current behavior, not historical order. Preserve existing raw evidence rather than replace it with a new assertion about the past.

One outer Node test can orchestrate the eight existing files without creating duplicate active copies or editing their tags. Cold build duration/admission must be established before asserting that it fits the unchanged 20-minute outer entry; this audit makes no such execution claim. No extra full suite is required for this correctness check.

## 5. AC4: what is feasible, and the exact interface gap

### Faithful collection job, once the stall has an actual correction

Use **one** frozen common source/test commit and identical approved test/helper bytes on both sides. Vary only the recorded pre-/post-T4 mechanism/routing. Re-freeze: the old before workspace was reused for the unproven benchmark candidate and is not an unchanged timing input anymore.

Execute each side's complete real unit plan once on the Mac. Keep the normal build/lease/throttle behavior and genuine timed admission for contained timed work. Preserve every runner outcome, including failures and skips. There is no requirement that all tests pass to retain an observed completed invocation duration, but an abort/truncated block is not the required completed reading.

A collection observer can use the existing runner entry and real Vitest reporters without replacing checks. Save, per side:

- common source commit, exact overlay recipe/tree and test/helper digests;
- actual command and selected-file sets, binary build provenance, toolchain/platform and load;
- identified serial-block runner interval, with the same disclosed boundary convention on both sides;
- completion/end evidence, complete per-test outcomes, exit/signal, and the other unit commands' outcomes.

A runner-reported Duration is a runner interval, not silently a whole process lifetime. Whole-lane elapsed, buffered log timestamps, summed test times, the historical 557 s and the completed **parallel** duration are not the alone reading. The existing external `measure-pair.mjs` correctly calls its unlabelled extracted durations only candidates awaiting reconciliation; those alone are not a complete verifier.

### A substantive live test is conceptually possible

A new independent test could perform that collection and verify its completeness, with a registered production-runner twin that omits the alone command. On that twin, the test must reject the missing actual serial execution/reading. It must not demand a speedup, compare to an invented duration, or use AC1's failure as a surrogate for AC4's negative case. Thus a non-budget reading can have machine-verifiable integrity without turning performance into a pass condition.

**Why that is not a practical existing-entry solution here:**

- The known unchanged workload already exceeds `proof-runs.mjs`'s 1,200-second cap before alone starts. Raising the inner test timeout cannot help.
- `prepareRuns` repeats a tagged live experiment on the merge base and change, and possibly its twin. A full pair inside it duplicates the full suite; nesting `scripts/checks.mjs` would also recurse into proof. A Node acceptance wrapper avoids automatic unit discovery, but not the cap/repetition.
- If the independent test itself creates/times both runs successfully on the base, its base pass is expected, not wrong-program proof. It needs an actual registered runner twin. Merely co-tagging an AC1 test and failing only its migration assertion does not independently validate AC4's reading requirement.
- Neither `proof.mjs` nor the lane record supplies a current-run pair dependency/receipt. There is no supported command to adopt a prior collector's result into `runs.head/base/twins`; calling `before` with a manufactured result map would fabricate proof.

### Exact missing contract, if automatic closure is required

The missing interface is a **current-preflight measurement dependency with verified paired-execution evidence**, available to an independently drafted tagged check without rerunning the full workload inside its 20-minute process. It must bind the checked tree and explicit before recipe, actual full command/file sets, admitted execution, serial boundaries/end records and all statuses, and reject missing, stale, truncated or misbound evidence. The verifier must itself fail on the relevant wrong execution/record producer, not on a deliberately deleted static fixture or an irrelevant AC1 failure. A freeform `writeRecord(..., more)` field is not that contract: trace does not consume it and it establishes no provenance by itself.

**The decision needed is narrow:** may this observational criterion be discharged by such a verified current-run measurement dependency, with an independently wrong-tested integrity check, instead of performing the multi-hour pair inside `before`'s capped test process? If yes, approve the precise producer/consumer and provenance contract and its protected tooling change. If not, keep AC4/closure open under the present entry. This audit does not choose or implement the policy, and does not recommend exempting observational criteria wholesale.

This stays within the owner's single PR; it is not a recommendation for a second PR, a criterion rewrite, a timeout special case, or a “report exists” tag.

## 6. Human-only versus agent work

**Genuinely human/authority blocked**

- Establishing the presence-requiring `.deepbuild/approvers` trust root on main and exact protected-commit approval signatures. Read-only tree inspection found no list at the merge base or local `origin/main`; `proof-change` reads the merge-base list, not a replacement from a feature branch, home folder or environment. Conversation approval is not a signature.
- The narrow evidence-contract decision above, if used, and any actual change to timing proof scope/checks. No such change is assumed.
- Unlock/access/permission actions only the person can perform, if the environment demonstrably requires them. Do not disable security or change another session's processes to create capacity.

**Agent-addressable, subject to normal authorization and admission**

- Independent additive AC1 test/twins; additive AC3 twin registration; preserving raw historical interval/recipe evidence; targeted unchanged validation and honest affected attribution.
- Diagnosing and fixing the demonstrated benchmark liveness defect with expected-red/unchanged-green proof. The current watchdog candidate has no established green regression. An environment symptom or unknown cause does not make the entire software investigation a human decision.
- Collecting the actual complete Mac pair once corrected/admitted; precise recipe/report retention; disclosing every failed or unrun check. Capacity is a prerequisite, not permission to bypass throttle or poll until green.

**Not original requirements / do not ask again**

- Spark is already optional; one PR is already decided. Do not reopen either question.
- No exact-29 migration requirement, speedup percentage, 557-second target, extra sample count, or budget-window measurement for this observational AC4.
- Repository-wide old lint debt is not a new #1123 acceptance criterion. It must remain honestly classified, and runner-induced regressions/check-selection changes still require proof. Signing does not turn failures into passes.

## 7. Audit limits and compliance

Only the requested findings file was intentionally written. No repository file was edited, no evidence was regenerated, and no process was stopped. Initial/final status showed the same pre-existing dirty benchmark source and untracked benchmark tests. Live GitHub reads returned #1123 OPEN and #2321 OPEN/Part of, with no comments/reviews supplying an additional waiver.

No `affected`, test, build, preflight, trace or measurement was run; therefore this audit has no fresh WIDE/INCONCLUSIVE verification output and certifies no acceptance criterion. Source inspection and retained reports support feasibility conclusions only. Tooling deviation: an oversized early read-only command output was automatically spilled by the harness to an external temporary log; it was not a work/evidence write by this audit and was not used as a new check result.
