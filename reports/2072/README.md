# #2072: exact held-call approval

## Change

`packages/hub/src/mcp-operations.ts` retains the SHA-256 of canonical JSON for the
action, plug-in handle/version and complete parsed input beside its ask promise.
It compares that digest before looking up approval or calling the extension host.
A mismatch names the request ID and leaves the first call's approval intact.
Reserving the promise before awaiting it also keeps concurrent retries on one ask.
The question names the version and marks a preview past 500 characters as cut,
with the full serialized input length.

This belongs at the existing hub ask boundary: a held call has not reached the
extension host, so an extension cannot enforce its approval binding there.

## Observed proof

The merge base is `e63447bea`; the first tests were drafted blind against
`1c4d1f0e2`, whose action path and #363 fixtures are unchanged at that merge base.
No test assertion or fixture was edited. Tests run through the real hub,
`deep-actions`, authority answers, the record and a sandboxed plug-in.

| Check | Before | After | Evidence |
| --- | --- | --- | --- |
| Original acceptance files, 7 tests | 6 fail, 1 passes | 5 pass, 2 fail | [before](before-original.txt), [after](after-original.txt) |
| Fresh blind redraft of AC1–AC3, 4 tests | All 4 fail for the named behavior | All 4 pass unchanged | [before](before-redraft.txt), [after](after-redraft.txt) |
| Existing #363 action exposure/gating and request idempotency, 6 tests | Not rerun on base; regression coverage | All 6 pass | [results](regression-363.txt) |
| Hub build/typecheck | Pass after repairing a missing local workspace link | Pass | `npm run build --workspace @deepbuild/hub` |
| Redraft typecheck | Not separately run | Pass | `node node_modules/typescript/bin/tsc -p tests/acceptance/2072/redraft/tsconfig.json` |

The base logs show the changed input actually running and the swapped change
action writing `ext.stocks.alert:NVDA`, as well as the version swap and missing
2,000-character label. The fixed original suite passes input binding, whole-input
binding, version binding, equivalent JSON and truncation; both action-swap cases
refuse before `action.entered`, a handler run or a store write.

## Open acceptance dispute

Two original assertions compare the **whole ledger's row count** across the call
and a 500 ms wait. They fail with three additional events despite no refused
action entering or running. A separate diagnostic observed exactly those events:
one `session.state` and two `row.set` updates from answering the ask, not a write
by the refused action ([observation](delayed-events.txt)).

The fresh job received only the original issue, design and base archive, never the
fix, original tests, dispute or output. Its tests observe the request's action
entries and handler counts, fail on the base and pass on the fix. Both drafts are
kept unchanged and enabled. Under the design's Dogfooding rule, accepting this
redraft in place of the first draft's global-count assertions requires the owner's
call. No failing test has been removed, skipped or weakened, and this report does
not declare the original suite passing.

## Scheduling deviation and remaining checks

After four build-grant timeouts, focused correctness builds/tests ran directly at
`nice -n 19`, one Vitest worker at a time, outside the machine throttle. The other
session's exclusive timing job was neither signalled nor modified. **This is a
scheduling deviation**, and these runs are not timing/performance proof; their
load may affect that other run's timing readings. No fake grant or changed
scheduler was used.

`node scripts/affected.mjs packages/hub/src/mcp-operations.ts
 tests/acceptance/2072/held-action.test.ts
 tests/acceptance/2072/digest-binding.test.ts` was also started through its normal
scheduler. Its selection is 320 parallel Vitest files, 11 Node files, 582 alone
Vitest files and `deep-app`; it separately lists 63 timed and 28 slow files. No
WIDE line was emitted. At this report's update it is still waiting for the build
grant: **INCONCLUSIVE / unrun**, not a broad regression pass. Timed and slow files
were not requested and remain unrun. The redraft, created after selection, was run
separately as recorded above.

`node scripts/repo-rules.mjs` fails with 25 findings; the exact same failure list
was observed on the merge base (existing dependency allowlist/card findings and a
home path in older #1575 evidence). No rule or baseline was changed. The initial
local setup also lacked the `@deepbuild/github` workspace link and `deep-hook`;
the link was restored under ignored `node_modules` and `deep-hook` was built from
this checkout before the counted baseline. Their setup failures are not bug proof.

The production change is 18 added / 9 removed lines. The larger PR keeps both
immutable acceptance drafts and their evidence for this one issue; splitting them
would separate the disputed criterion from its proof. `Part of #2072` remains
until the acceptance dispute is settled and the remaining verification is
reported; no known failure or unrun check is represented as PASS.
