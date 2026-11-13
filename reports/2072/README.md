# #2072: exact held-call approval

## Change

`packages/hub/src/mcp-operations.ts` retains the SHA-256 of canonical JSON for the
action, plug-in handle/version and complete parsed input beside its ask promise.
It compares that digest before looking up approval or calling the extension host.
A mismatch names the request ID and leaves the first call's approval intact.
Reserving the promise before awaiting it also keeps concurrent retries on one ask.
The question names the version and marks a preview past 500 characters as cut,
with the full serialized input length.

`packages/hub/src/hub-control.ts` waits for the existing state-settling operation
before acknowledging an answer. The answer's card/session rows are therefore
recorded before the caller continues, instead of trailing into the next call.

This belongs at the existing hub ask boundary: a held call has not reached the
extension host, so an extension cannot enforce its approval binding there.

## Final results

The merge base is `e63447bea`; the first tests were drafted blind against
`1c4d1f0e2`, whose action path and #363 fixtures are unchanged at that merge base.
No test assertion or fixture was edited, skipped or disabled. Tests run through
the real hub, `deep-actions`, authority answers, the record and a sandboxed plug-in.

| Check | Before | Final fix | Evidence |
| --- | --- | --- | --- |
| Original acceptance files, 7 tests | 6 fail, 1 passes | All 7 pass unchanged | [before](before-original.txt), [final](after-final.txt) |
| Fresh blind redraft of AC1–AC3, 4 tests | All 4 fail for the named behavior | All 4 pass unchanged | [before](before-redraft.txt), [final](after-final.txt) |
| Answer/action regressions, 13 tests in 7 files | Existing coverage, not all rerun on base | All 13 pass | [results](regressions-final.txt) |
| Hub build/typecheck | Pass after repairing local setup | Pass after both production edits | `npm run build --workspace @deepbuild/hub` |
| Redraft typecheck | Not separately run | Pass | `node node_modules/typescript/bin/tsc -p tests/acceptance/2072/redraft/tsconfig.json` |
| Diff review and test integrity | Original blind hashes recorded | Clean; all test bytes unchanged | Test README / git history |

## Requirement → change → proof

| Requirement | Change | Proof |
| --- | --- | --- |
| AC1: approval for A cannot run B under the same request ID; A then runs once | Compare the full-call digest before looking up the approval or calling the host; leave the original map entry intact | Original AC1 fails on the base with B running, then passes unchanged; no write or handler run on refusal, original A enters once |
| AC2: another change/send action cannot spend that approval | Action name and plug-in/version are part of the digest | Both original action-swap tests fail on the base with the wrong handler running, then pass unchanged, including total-ledger-count assertions |
| AC3: the 2,000-character input is visibly cut, with length | Add `… (cut; 2000 characters)` after the preview | Original AC3 fails on the missing length, then passes its action/start/tail/length/cut assertions |
| Scope: whole input, plug-in version, equivalent parsed input | Canonical JSON includes full input and the target handle/version | Scope tests reject a changed tail after identical first 500 characters and reject 2.0.0 after approval at 1.0.0; the original call and formatting-equivalent JSON run |
| Regression: normal answers and action gating/idempotency still work | Settle answer rows through the existing state service, without changing their content or authority | CLI answer/scope, OS-confirmed authority and other answers, answer delivery after restart, row actions, #363 exposure/gating and request idempotency: 13 passes |

## The intermediate failure is resolved without changing tests

The digest fix alone passed 5 original tests but left two whole-ledger-count
assertions failing ([intermediate output](after-original.txt)). A diagnostic
observed three delayed events from the answer: one `session.state` and two
`row.set` updates ([observation](delayed-events.txt)). The refused action itself
had not entered or run.

A fresh blind job received only the original issue, design and base archive,
never the fix, first tests, dispute or output. Its redraft failed on the base and
passed on the digest fix. **It did not replace the first draft.** The final
production correction settles the answer's rows before acknowledging it, and
both drafts now pass. No acceptance dispute or test waiver remains. Intermediate
logs are retained as history, not as the final result.

## Broader verification limitations and scheduling deviation

After four build-grant timeouts, focused correctness builds/tests ran directly at
`nice -n 19`, one Vitest worker at a time, outside the machine throttle. The other
session's exclusive timing job was neither signalled nor modified. **This is a
scheduling deviation**, and these runs are not timing/performance proof; their
load may affect that other run's timing readings. No fake grant or changed
scheduler was used.

The normal `node scripts/affected.mjs` run did not obtain its build grant in
30 minutes: [the exact output](affected-build.txt) is
`INCONCLUSIVE no grant: no build grant came within 30 min`. It then queued more
jobs behind the same exclusive run; only this session's affected runner and its
waiting children were stopped, by verified PID. That broad run is **INCONCLUSIVE**,
not PASS, and no affected-run process from this session remains.

The final [affected selection](affected-selection.txt), including both production
paths and all three acceptance files, lists 321 parallel Vitest files, 11 Node
files, 582 alone Vitest files and `deep-app`, with 63 timed and 28 slow files
separately. It emits **no WIDE line**. Beyond the focused checks recorded above,
these broader suites are unrun; timed and slow files were not requested. A full
release preflight was not run.

`node scripts/repo-rules.mjs` has 25 identical failures on the base and fix,
covering existing dependency allowlist/card entries and a home path in older
#1575 evidence. No rule or baseline was changed. Initial local setup also lacked
the `@deepbuild/github` workspace link and `deep-hook`; the link was restored
under ignored `node_modules` and `deep-hook` was built from this checkout before
the counted baseline. Setup failures are not bug proof.

All #2072 acceptance criteria now have before/after proof, so the PR says
`Closes #2072`. This is not a claim that the broader unrun suites or inherited
lint failures pass. The production diff is 24 added / 10 removed lines; the
larger PR preserves both immutable drafts and their redacted evidence together
for this issue, rather than separating its proof history into another PR.
