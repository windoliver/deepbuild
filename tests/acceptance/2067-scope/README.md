# #2067 supplementary blind scope acceptance

Inputs: issue #2067, AGENTS.md, technical design (`How runs become one of five
verdicts`, `What done means, fixed at the start`, Dogfooding), unchanged base
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, and base tests, including `../2067/`.
No other worktree, implementation changes or review was read. No existing file
was changed and no commit was made. The four original ACs are not duplicated.

## Requirement → assertion → base proof

| Requirement | Test and assertions | Unchanged-base result |
|---|---|---|
| Scope: nothing fetched; unavailable mainline data is BLOCKED | `promisor.test.ts`: local main commit resolves, but its tree is missing in a promisor repository. A separate twin proves real `merge-tree` lazily fetches that exact missing input from a local bare origin and completes. A transparent OS-Git wrapper enables Git trace2; it does not replace Git, intercept answers or change arguments. Assert zero internal fetches, BLOCKED, missing preflight with mainline-read cause and owner you, Closes refused. | FAIL at intended assertions: one internal fetch, real merge-tree, PASS, preflight passed, Closes allowed. |
| Scope: every release name remains a check, including `review` | `review-name.test.ts`: `release.checks: [review]`, no `checks.review`, and an automatic external reviewer returning no findings. Assert the automatic review completed, but a missing release review remains on the receipt, verdict BLOCKED with undefined-check cause and owner you, and Closes refused naming review. No required ID prefix or numbering. | FAIL at intended assertions: automatic review passed; claim PASS with no missing release check/cause/owner. Closes refusal already holds on base. |
| Design inheritance + AC4 reuse | `inherited-reuse.test.ts`: one real node:test assertion fails on both merged head and base. First claim BLOCKED as inherited; second distinct claim with identical head/check stays BLOCKED naming inherited preflight and reuses the same run IDs. | PASS guard: already correct on this base; two total release runs (one merged, one base), no extra runs on second claim. Not claimed as a newly reproduced defect. |

Existing `../2067/twins.test.ts` proves successful release reuse, `../325/` proves
merge failure, and `../28/rules.test.ts` proves inheritance in the verdict engine.
None proves inherited release reuse through two real PR claims; the small guard
fills that integration gap without duplicating their cases.

Surfaces: real `deep hub run`, real `deep-hook` Claude Code hooks, approved fixture
`.deepbuild/done.yaml`, `events.read` and `changes.read`, and PreToolUse for
`gh pr create`. Helpers reuse `../16/`, `../325/` and the fake external reviewer
from `../1537/`. Only external model/forge/OS-Git boundaries are controlled;
record, runner, merge and test execution are real. All remotes are local fixture
paths. No actual model call or GitHub write. A no-op hub cannot produce the
required locked definition, ordinary PASS, fresh claim, receipt or real runs.

## Verification and limitations

One run, no harness corrections or retries:

```sh
node scripts/affected.mjs tests/acceptance/2067-scope/promisor.test.ts tests/acceptance/2067-scope/review-name.test.ts tests/acceptance/2067-scope/inherited-reuse.test.ts
```

Node 24.22.0; Rust 1.99.1; Git 2.56.0. Same-base existing deps/dist/deep-hook.
Three tests completed: **2 expected failures, 1 passing guard**; no setup,
loader or timeout failures. No broad suites, implementation run or mutant run.
The guard's passing base result is regression protection, not mutant-kill proof.

Normal affected throttle/lease entry was used, with no bypass. The lease wrapper
reported no hub token and ran unleased: a real environment limitation, not a
leased-run claim. Overall affected exits 1: 174 new failures (2 tests and 172
unrelated base lint findings), 11 known lint findings, 0 inconclusive/blocked,
1 passed. No WIDE or INCONCLUSIVE lines were emitted. The host load was 203;
these are behavioral assertions, not timing measurements. No unrelated lint
finding was changed. Fixture cleanup stops only its owned PIDs.

`BASE-FAILURE.txt` summarizes the evidence. `evidence/` preserves the full affected
output, Vitest output and structured reporter, with home/base/temp paths scrubbed.
`SHA256SUMS` pins the additions for byte-for-byte transfer.
