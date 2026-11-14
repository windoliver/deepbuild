# #2066 — approved acceptance adoption; all four criteria traced

**Issue acceptance: proven. Overall repository verification: not PASS.** The owner approved the blind redraft and criterion tags. Both adopted tests pass, and `node scripts/proof.mjs before trace` reports that each of the issue's four criteria has a tagged test that ran, passed and failed on a wrong program. PR #2519 can say **Closes #2066** on this evidence, without claiming unrelated checks passed or authorizing a merge.

Base: `bfe8c8a5e5713c03733e50376ea9680d34f86efa`. The PR uses a separate worktree; unrelated edits from the shared checkout are excluded. Production changes are confined to `core.ts`, `session-memory.ts`, and the internal memory port. An extension cannot stop the core's existing prompt-to-base writes.

## Requirement → change → proof

| Requirement | Change | Evidence |
|---|---|---|
| AC1 `#2066.be686212`: scheduled rule saves nothing and does not propagate | Require this prompt's recorded `person` origin before `saveTyped`; keep delivery separate | Adopted matrix fails on the merge base at its assertions and passes the fix. Earlier detailed base output names target `rule:typeda9cfcd2f96c8` and unwanted delivery. |
| AC2 `#2066.0f5e890b`: session/subagent/continuation/unknown save nothing | Same origin guard, no text-based origin inference | Matrix asserts each recorded origin; base failures name every saved target; passes after. |
| AC3 `#2066.6caf3df8`: same line typed by a person saves once and reaches a second open session | Parsing, deduplication, scope and delivery unchanged | Typed twin passes the fix and fails the one-comparison `person-origin-reversed` wrong program at its assertion. |
| AC4 `#2066.99a5e19f`: scheduled rejection saves no decision/guard; person saves both | Require `person` before `captureRejected` and `syncRejected` | Both adopted tests cover scheduled/person rejection twins; base wrongly saves a decision and guard, fix passes. |
| One origin-naming refusal per session | Record-deduplicated `session.reading` | Two identical non-person prompts leave one reading for every origin. |
| Prompt-specific origin; missing origin cannot authorize | Reuse status's prompt-ID/splice lookup | Adopted suite checks recorded origins and an unjoined prompt. The earlier socket draft's later-entry test passed after. Exact concurrent race and absent-event fault are not separately exercised. |
| #344 otherwise unchanged | Ordinary prompts remain query-free; automatic prompts still receive existing rules | Typed propagation, compaction/resume and automatic delivery pass. Scoped notices (#344 AC9) fail identically on base and after. |

## Approved adoption

See [adoption.md](adoption.md). The owner explicitly approved replacing the two earlier drafts and adding hashed criterion tags. The adopted redraft's assertions, expected values and flow are unchanged; only the two test names gained tags. Superseded drafts were retired by that approval, not weakened to pass. Exact earlier bytes remain in commit `47aba2b4d`, the independent redraft in `3e7f97070`, and all failure output remains here. Approval is not a cryptographic tag and does not waive any machine guard that requires one.

The typed control is existing behavior and should pass the base. Its wrong program reverses only `from === 'person'` in a copy of `session-memory.ts`; the before lane builds and runs it separately. The copied twin preserves the source verbatim apart from that comparison. Acceptance typechecking excludes this intentionally relocated copy, which is typechecked when laid over the real module in the twin build.

## Latest checks

- [adopted-proof.txt](adopted-proof.txt): **PASS before** for both tests; the denial matrix fails the merge base, the typed twin fails `person-origin-reversed`. **PASS trace: each of 4 criteria has a tagged test that ran, passed and failed on a wrong program.** The run's commit still said `Part of`; changing the PR's closing keyword changes no tested code.
- [adopted-acceptance.txt](adopted-acceptance.txt) / [.jsonl](adopted-acceptance.jsonl): **2 passed**, no skips. Run through `node scripts/affected.mjs tests/acceptance/2066/redraft/recorded-origin.test.ts` after the workspace build and acceptance-only typecheck.
- Workspace TypeScript builds, including hub typecheck, passed in the proof and affected runs. `tsc -p tests/acceptance/2066/tsconfig.json` passed before the affected command ran. `git diff --check` passed. Core stays within its existing 2,638-line ceiling.
- [base-rules.txt](base-rules.txt) and [final-rules.txt](final-rules.txt): #344 **AC1 and AC5 pass on both**, **AC9 fails on both with the same four booleans**. [after-status-regression.txt](after-status-regression.txt): all four #83 status tests passed.

Runs used the repo's fixed-path proof bays, with intact seals and source/tree/overlay hashes recorded. Each side rebuilt its workspace; hook binaries came from that bay's own builds. Loads exceeded the core count, so timings are readings, not budget proof.

## Still not a clean repository verdict

[adopted-affected.txt](adopted-affected.txt): **FAIL affected: 153 new, 45 already failing on main, 0 inconclusive or blocked, 0 listed skips, 2 passed.** No acceptance test failed. The remaining findings are repository lint failures also observed on the base (dependency inventory, carried vendor patches, canvas closure/catalog entries, stale known-failure entries, etc.). “New” means absent from main's known-failure list, not introduced by this patch; that list was not changed. Earlier `final-affected.txt` additionally includes the unchanged #344 AC9 failure.

The targeted affected runs are **not** every source dependency. [full-selection.txt](full-selection.txt) records the source selection before adoption: 340 parallel Vitest files, 14 node files, 645 alone Vitest files, 67 timed files, 30 slow files and deep-app. No **WIDE** line was emitted. **INCONCLUSIVE (unrun): the rest of that selection, timed/slow files and deep-app, and full preflight.** Exact simultaneous prompts, an origin event that never lands, and deduplication across restart remain unexercised edge cases, not acceptance passes asserted here. No failed check or baseline was edited to turn green.

## Historical attempts retained

`base-recorded-origin.txt` caught all unwanted saves but its `SELECT *` also raised a 64-bit-sequence `RangeError`. `after-acceptance.txt` records that infrastructure failure and existing `ENOTEMPTY` cleanup races. `redraft-base.txt` records the blind redraft's detailed base failures and a separate control cleanup error. `final-acceptance.txt` records the passing untagged redraft before adoption; `adopted-proof.txt` is the later full before/after/twin result. Nothing in these saved outputs was re-recorded or reclassified as a pass.

Production diff is 26 added / 27 removed lines. The extra source-sized twin is a machine copy needed to prove the existing typed-rule criterion against a wrong program; saved output is evidence, not handwritten implementation.
