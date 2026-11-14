# #2066 — implementation proved by blind redraft; adoption pending

**Part of #2066. Not ready to close or merge.** The production guard is implemented, builds, and passes the independent blind redraft. The original acceptance drafts remain unchanged and retain their failures. Per AGENTS.md / design Dogfooding, the differing drafts and results are presented for the owner's approval, not silently substituted.

Base: `bfe8c8a5e5713c03733e50376ea9680d34f86efa`. The PR uses a separate worktree; no unrelated changes from the original shared checkout are included. Production changes are confined to `core.ts`, `session-memory.ts`, and the internal memory port. An extension cannot stop the core's existing prompt-to-base writes.

## Requirement → change → evidence

| Requirement | Change | Check result |
|---|---|---|
| AC1 scheduled rule saves nothing and does not reach a second open session | Require the prompt's recorded `person` origin before `saveTyped`; keep delivery separate | Redraft fails on base with target `rule:typeda9cfcd2f96c8` and unwanted delivery; passes after. |
| AC2 session/subagent/continuation/unknown save nothing | Same origin guard, no text-based origin inference | Redraft explicitly verifies recorded origins, fails on base for every origin naming its target, passes after. |
| AC3 same line typed by a person saves once and propagates at next prompt | Parsing, deduplication, scope and rule delivery unchanged | Redraft's typed twin passes after; #344 AC1 also passes. |
| AC4 scheduled rejection saves no decision or guard; same words typed save both | Require `person` before `captureRejected` / `syncRejected` | Base shows unwanted decision and guard; redraft checks the same rejection in its person twin and passes after. |
| Once-only refusal naming origin | One `session.reading` per session/origin, deduplicated from the record | Two identical non-person prompts leave one reading for every origin in the passing redraft. |
| Prompt-specific origin; absent/unknown origin grants no authority | Reuse status's prompt-ID/splice lookup; share its result with base writes | Original socket draft's prompt-specific case passes after. Redraft verifies recorded origins and an unjoined prompt. The absent-event branch and an exactly interleaved race remain untested. |
| #344 behavior otherwise unchanged | Ordinary prompts perform no origin query; existing rules still delivered at automatic prompts | Redraft automatic delivery passes. #344 AC1 and AC5 (compaction/resume) pass in final run. AC9 scoped notices fail identically on base and after. |

## Saved checks

Commands ran in the repository's fixed-path proof bays via `scripts/bays.mjs` / `claimPair`, with an intact seal recorded in their logs. Each run rebuilt the workspace; the base regression run also built `deep-hook --locked`. No copied stale workspace build was used for these final runs. Dependencies came from the bay's sealed installation. No model/provider request is part of the tests.

- **Base original socket draft:** `npm run build --workspaces && node scripts/affected.mjs tests/acceptance/2066/recorded-origin.test.ts`. `base-recorded-origin.txt`: all five origins save rules and propagate them, naming actual targets; scheduled rejection saves a decision/guard. The test's broad `SELECT *` also throws a JavaScript-number `RangeError` reading the 64-bit hook sequence.
- **Initial after:** `after-affected.txt`, `after-acceptance.txt`: core behavior assertions pass, but the draft still throws that `RangeError`, and original helper cleanup reports `ENOTEMPTY`. `after-status-regression.txt`: all four #83 status tests pass. Compaction delivery missed in this loaded run; ordinary prompts were then restored to the original query-free path.
- **Blind redraft before:** `redraft-base.txt` / `.jsonl`: every non-person origin fails the named assertions, with its target and propagated rule. The person's control assertions hold; its test has a separate `ENOTEMPTY` cleanup error. `redraft-base-affected.txt` includes the complete runner result.
- **Blind redraft after final correction:** `final-acceptance.txt` / `.jsonl`: **2 tests passed**, covering all four issue criteria plus repeated readings, missing transcript origin and automatic delivery. Tests are byte-identical to the blind job's output.
- **Regression:** `base-rules.txt` and `final-rules.txt`: #344 **AC1 and AC5 pass on both**, **AC9 fails on both with the same four booleans**. No retry to green, skip, fixture change or baseline edit.
- **Build:** all TypeScript workspace builds (including the hub typecheck) succeeded in the before/after logs. `git diff --check` passed. The core remains within its existing 2,638-line ceiling.

## Overall verification is not PASS

`final-affected.txt`: **FAIL affected: 154 new, 45 already failing on main, 0 inconclusive or blocked, 0 listed skips, 4 passed**. Its only failing test is the unchanged #344 AC9 failure also observed on the base. The remaining findings are repository lint failures also observed in the base run (dependency inventory, carried vendor patches, canvas closure/catalog entries, stale known-failure entries, etc.). The runner calls these NEW because main's baseline does not list them; this PR did not change that baseline. A formatting difference combines the canvas-closure error with its command warning in the after log. No new core-size finding remains.

The targeted `affected.mjs` runs name acceptance/regression paths; they are **not** a full run over every source dependency. `full-selection.txt` records the full source selection: 340 parallel Vitest files, 14 node files, 645 alone Vitest files, 67 timed files, 30 slow files and deep-app. No **WIDE** line was emitted. **INCONCLUSIVE (unrun): the remainder of that selection, including all timed/slow files and deep-app, was not executed.** Full preflight, a final complete-suite run and acceptance-test typechecking remain unrun. Loads during checks exceeded 18 cores, so timings are readings, not budget proof.

## Approval / remaining gaps

1. **Owner decision required:** approve adoption of `tests/acceptance/2066/redraft/recorded-origin.test.ts` in place of the earlier drafts. Both earlier files are still present, unedited; their failing output is here. The redraft passes the implementation, so Dogfooding requires presenting this once to the owner. No adoption or deletion has been presumed.
2. The drafts omitted hashed criterion tags; automated `proof.mjs trace` cannot certify `Closes #2066`. Adding those tags is a check edit and belongs to the approved adoption, not a silent implementer edit.
3. Preserve or resolve existing check failures and finish the unrun checks before calling this merge-ready. The original acceptance helper's `ENOTEMPTY` teardown is not fixed here; the first draft also has an unused helper that acceptance-only typecheck has not validated.
4. Exact concurrent origins, an origin event that never lands, and deduplication across restart are reviewed in code but not separately exercised. All required non-person save branches share the tested `from === 'person'` condition.

Handwritten changes exceed the usual 400-line target only because both immutable earlier drafts and the independent redraft are retained for the required review. Production diff is 26 added / 27 removed lines. Splitting the authority fix from its evidence would not resolve the pending test-adoption decision; separate commits keep test drafting, implementation, redraft and this evidence reviewable.
